from datetime import date, datetime, timedelta
import json
import ssl
from pathlib import Path
from unittest.mock import Mock

import httpcore
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.index import app as forwarded_app
from backend.app import main, routes
from backend.app.config import Settings
from backend.app.database import Base, get_db
from backend.app.dependencies import get_current_user
from backend.app.finance import period_distance
from backend.app.models import (
    Organization, User, Vehicle, TelematicsDevice, TelematicsIntegration,
    TelemetryReading,
    AuditLog, Expense, FuelTransaction, WorkOrder, OdometerLog,
    InventoryMovement, InventoryTransaction, Part, PurchaseOrder, PurchaseOrderLine,
    PurchaseOrderReceipt, StockLocation, Vendor, VehicleAssignment, MaintenancePlan,
    ComplianceDocument, WorkOrderChecklistItem, OperationalNotification,
    NotificationDelivery, VehicleComponent, VehicleIssue,
)
from backend.app.telematics import approved_provider_request


@pytest.fixture
def audit_api(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as database:
        users = {
            role: User(
                organization_id=1, email=f"{role}@audit.example", full_name=role,
                password_hash="unused", role=role,
            )
            for role in ("owner", "fleet_manager", "accountant", "inventory_manager", "driver", "mechanic")
        }
        vehicles = [
            Vehicle(
                organization_id=1, registration_number=f"AUDIT-{index}",
                model="Truck", vehicle_type="Truck", depot="Main", odometer_km=1000 * index,
            )
            for index in (1, 2)
        ]
        database.add(Organization(id=1, name="Synthetic fleet", slug="audit", labor_rate_per_hour=500))
        database.add_all([*users.values(), *vehicles])
        database.commit()
        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[get_db] = lambda: database
        app.dependency_overrides[get_current_user] = lambda: users["fleet_manager"]
        monkeypatch.setattr(routes, "queue_role_notification", lambda *args, **kwargs: None)
        with TestClient(app) as client:
            yield client, database, users, vehicles
    engine.dispose()


def configure_sync(monkeypatch, readings):
    settings = Settings(
        telematics_provider_hosts={"a": ["telemetry.example"], "b": ["telemetry.example"]},
        telematics_credentials={"1": {"token": "synthetic-token"}},
    )
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    monkeypatch.setattr(
        "backend.app.telematics.socket.getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("8.8.8.8", 443))],
    )
    response = httpx.Response(200, json={"readings": readings}, request=httpx.Request("GET", "https://telemetry.example/readings"))
    outbound = Mock(return_value=response)
    monkeypatch.setattr(routes.httpx.Client, "send", outbound)
    return outbound


def test_credentials_are_scoped_and_do_not_resolve_process_environment(monkeypatch):
    settings = Settings(telematics_credentials={"1": {"provider": "tenant-one"}, "2": {"provider": "tenant-two"}})
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    monkeypatch.setenv("UNRELATED_PROCESS_SECRET", "must-not-be-forwarded")
    integration = TelematicsIntegration(organization_id=1, provider="a", credential_ref="UNRELATED_PROCESS_SECRET")
    assert routes.integration_credential(integration) is None
    integration.credential_ref = "provider"
    assert routes.integration_credential(integration) == "tenant-one"


@pytest.mark.parametrize("url", ["http://telemetry.example", "https://user:pass@telemetry.example", "https://telemetry.example:8080"])
def test_provider_destination_requires_https_without_userinfo_or_other_ports(url):
    with pytest.raises(ValueError):
        approved_provider_request("a", url, "/readings", Settings())


def test_unapproved_or_private_provider_destinations_are_blocked(monkeypatch):
    settings = Settings(telematics_provider_hosts={"a": ["telemetry.example"]})
    with pytest.raises(ValueError, match="not approved"):
        approved_provider_request("a", "https://other.example", "/readings", settings)
    monkeypatch.setattr(
        "backend.app.telematics.socket.getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("127.0.0.1", 443))],
    )
    with pytest.raises(ValueError, match="public"):
        approved_provider_request("a", "https://telemetry.example", "/readings", settings)


@pytest.mark.parametrize("address", ["8.8.8.8", "2606:4700:4700::1111"])
def test_telematics_connects_to_validated_ip_with_original_tls_identity(audit_api, monkeypatch, address):
    _, database, _, _ = audit_api
    settings = Settings(
        telematics_provider_hosts={"a": ["telemetry.example"]},
        telematics_credentials={"1": {"token": "synthetic-token"}},
    )
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    resolver = Mock(side_effect=[
        [(2, 1, 6, "", (address, 443))],
        [(2, 1, 6, "", ("127.0.0.1", 443))],
    ])
    monkeypatch.setattr("backend.app.telematics.socket.getaddrinfo", resolver)
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:9999")
    body = b'{"readings":[]}'
    stream = Mock(spec=httpcore.NetworkStream)
    stream.start_tls.return_value = stream
    stream.get_extra_info.return_value = None
    stream.read.side_effect = [
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
        + str(len(body)).encode() + b"\r\n\r\n" + body,
        b"",
    ]
    connect = Mock(return_value=stream)
    monkeypatch.setattr("httpcore._backends.sync.SyncBackend.connect_tcp", connect)
    integration = TelematicsIntegration(organization_id=1, provider="a", base_url="https://telemetry.example", credential_ref="token")
    database.add(integration)
    database.commit()
    assert routes.sync_telematics_integration(integration, database)["status"] == "success"
    assert resolver.call_count == connect.call_count == 1
    assert connect.call_args.kwargs["host"] == address
    assert connect.call_args.kwargs["port"] == 443
    tls = stream.start_tls.call_args.kwargs
    assert tls["server_hostname"] == "telemetry.example"
    assert tls["ssl_context"].check_hostname
    assert tls["ssl_context"].verify_mode == ssl.CERT_REQUIRED
    assert any(b"Host: telemetry.example\r\n" in call.args[0] for call in stream.write.call_args_list)


def test_telematics_does_not_follow_provider_redirects(audit_api, monkeypatch):
    _, database, _, _ = audit_api
    settings = Settings(
        telematics_provider_hosts={"a": ["telemetry.example"]},
        telematics_credentials={"1": {"token": "synthetic-token"}},
    )
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    monkeypatch.setattr("backend.app.telematics.socket.getaddrinfo", lambda *args, **kwargs: [(2, 1, 6, "", ("8.8.8.8", 443))])
    stream = Mock(spec=httpcore.NetworkStream)
    stream.start_tls.return_value = stream
    stream.get_extra_info.return_value = None
    stream.read.side_effect = [b"HTTP/1.1 302 Found\r\nLocation: https://127.0.0.1/readings\r\nContent-Length: 0\r\n\r\n", b""]
    connect = Mock(return_value=stream)
    monkeypatch.setattr("httpcore._backends.sync.SyncBackend.connect_tcp", connect)
    integration = TelematicsIntegration(organization_id=1, provider="a", base_url="https://telemetry.example", credential_ref="token")
    database.add(integration)
    database.commit()
    assert routes.sync_telematics_integration(integration, database)["status"] == "failed"
    assert connect.call_count == 1


def test_provider_matching_does_not_update_another_providers_vehicle(audit_api, monkeypatch):
    _, database, _, vehicles = audit_api
    integration = TelematicsIntegration(organization_id=1, provider="b", base_url="https://telemetry.example", credential_ref="token")
    devices = [
        TelematicsDevice(organization_id=1, vehicle_id=vehicle.id, provider=provider, device_identifier="shared")
        for vehicle, provider in zip(vehicles, ("a", "b"))
    ]
    database.add_all([integration, *devices])
    database.commit()
    outbound = configure_sync(monkeypatch, [{"device_identifier": "shared", "recorded_at": "2026-10-02T00:00:00Z", "odometer_km": 9000}])
    result = routes.sync_telematics_integration(integration, database)
    assert result["status"] == "success"
    assert [vehicle.odometer_km for vehicle in vehicles] == [1000, 9000]
    assert database.scalar(select(TelemetryReading.device_id)) == devices[1].id
    request = outbound.call_args.args[0]
    assert request.url.host == "8.8.8.8"
    assert request.headers["Host"] == "telemetry.example"
    assert request.extensions["sni_hostname"] == "telemetry.example"


def test_invalid_sync_batch_rolls_back_all_readings_and_odometer_updates(audit_api, monkeypatch):
    _, database, _, vehicles = audit_api
    integration = TelematicsIntegration(organization_id=1, provider="a", base_url="https://telemetry.example", credential_ref="token")
    database.add_all([integration, TelematicsDevice(organization_id=1, vehicle_id=vehicles[0].id, provider="a", device_identifier="device")])
    database.commit()
    configure_sync(monkeypatch, [
        {"device_identifier": "device", "recorded_at": "2026-10-02T00:00:00Z", "odometer_km": 9000},
        {"device_identifier": "device", "recorded_at": "invalid-date", "odometer_km": 9500},
    ])
    result = routes.sync_telematics_integration(integration, database)
    assert result["status"] == "failed"
    assert database.scalar(select(func.count(TelemetryReading.id))) == 0
    assert vehicles[0].odometer_km == 1000


def expense_for(user, vehicle, amount=1000, **overrides):
    values = {
        "organization_id": user.organization_id, "vehicle_id": vehicle.id,
        "category": "OTHER", "description": "Synthetic expense", "amount_paise": amount,
        "incurred_on": "2026-01-15", "created_by": user.id, "status": "Pending",
    }
    values.update(overrides)
    return Expense(**values)


def test_bulk_approval_preserves_self_created_and_rejected_expenses_and_audits_success(audit_api):
    client, database, users, vehicles = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["owner"]
    expenses = [
        expense_for(users["owner"], vehicles[0]),
        expense_for(users["fleet_manager"], vehicles[0], status="Rejected"),
        expense_for(users["fleet_manager"], vehicles[0]),
    ]
    database.add_all(expenses)
    database.commit()
    response = client.post("/api/v1/financials/bulk-approve", json={"expense_ids": [expense.id for expense in expenses]})
    assert response.status_code == 200
    assert response.json()["total_approved"] == 1
    assert [expense.status for expense in expenses] == ["Pending", "Rejected", "Approved"]
    assert database.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "expense.approved")) == 1


@pytest.mark.parametrize("actor", ["owner", "accountant"])
def test_pending_expense_rejection_persists_audited_reason(audit_api, actor):
    client, database, users, vehicles = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users[actor]
    expense = expense_for(users["fleet_manager"], vehicles[0])
    database.add(expense)
    database.commit()
    path = f"/api/v1/financials/expenses/{expense.id}/reject"
    assert client.post(path, json={"reason": "x"}).status_code == 422
    response = client.post(path, json={"reason": "Invoice mismatch"})
    assert response.status_code == 200
    assert response.json()["rejected"]
    database.refresh(expense)
    assert expense.status == "Rejected"
    audit = database.scalar(select(AuditLog).where(AuditLog.action == "expense.rejected"))
    assert audit.actor_user_id == users[actor].id
    assert json.loads(audit.changes)["reason"] == "Invoice mismatch"
    assert client.post(path, json={"reason": "Repeated decision"}).status_code == 409
    metrics = client.get("/api/v1/financials/metrics").json()
    assert metrics["totals"]["expenses"] == 0


def test_expense_rejection_rejects_approved_records_other_roles_and_tenants(audit_api):
    client, database, users, vehicles = audit_api
    expense = expense_for(users["fleet_manager"], vehicles[0], status="Approved")
    database.add(expense)
    database.commit()
    path = f"/api/v1/financials/expenses/{expense.id}/reject"
    client.app.dependency_overrides[get_current_user] = lambda: users["owner"]
    assert client.post(path, json={"reason": "Must use reversal"}).status_code == 409
    client.app.dependency_overrides[get_current_user] = lambda: users["fleet_manager"]
    assert client.post(path, json={"reason": "Forbidden role"}).status_code == 403
    database.add(Organization(id=2, name="Other finance", slug="other-finance"))
    users["accountant"].organization_id = 2
    database.commit()
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    assert client.post(path, json={"reason": "Other tenant"}).status_code == 404
    database.refresh(expense)
    assert expense.status == "Approved"
    assert database.scalar(select(func.count(AuditLog.id))) == 0


def test_approved_maintenance_cost_is_immutable_on_reads_and_operational_sync(audit_api):
    client, database, users, vehicles = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    work_order = WorkOrder(organization_id=1, vehicle_id=vehicles[0].id, title="Repair", status="Completed", labor_hours=2)
    database.add(work_order)
    database.flush()
    expense = expense_for(users["mechanic"], vehicles[0], amount=100000, category="MAINTENANCE", status="Approved", cost_center=f"work_order:{work_order.id}")
    database.add(expense)
    database.commit()
    database.get(Organization, 1).labor_rate_per_hour = 2000
    work_order.labor_hours = 9
    database.commit()
    assert client.get("/api/v1/expenses").status_code == 200
    routes._sync_work_order_expense(database, work_order, users["accountant"])
    database.commit()
    assert expense.amount_paise == 100000
    assert expense.status == "Approved"


def test_maintenance_cost_basis_survives_later_labor_rate_changes(audit_api):
    _, database, users, vehicles = audit_api
    work_order = WorkOrder(organization_id=1, vehicle_id=vehicles[0].id, title="Repair", status="Completed", labor_hours=2)
    database.add(work_order)
    database.flush()
    expense = routes._sync_work_order_expense(database, work_order, users["mechanic"])
    database.commit()
    database.get(Organization, 1).labor_rate_per_hour = 2000
    routes._sync_work_order_expense(database, work_order, users["mechanic"])
    database.commit()
    assert work_order.labor_rate_paise == 50000
    assert expense.amount_paise == 100000


def test_finance_reads_refresh_pending_maintenance_expenses(audit_api):
    client, database, users, vehicles = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    work_order = WorkOrder(
        organization_id=1, vehicle_id=vehicles[0].id, title="Repair", status="Completed",
        labor_hours=2, completed_at=datetime(2026, 1, 5),
    )
    database.add(work_order)
    database.flush()
    expense = routes._sync_work_order_expense(database, work_order, users["mechanic"])
    database.commit()
    expense_id = expense.id
    work_order.title = "Final repair"
    work_order.vehicle_id = vehicles[1].id
    work_order.labor_hours = 3
    work_order.completed_at = datetime(2026, 1, 6)
    database.get(Organization, 1).labor_rate_per_hour = 2000
    database.commit()
    for _ in range(2):
        assert client.get("/api/v1/financials/ledger").status_code == 200
        database.refresh(expense)
        assert expense.amount_paise == 150000
        assert expense.vehicle_id == vehicles[1].id
        assert expense.incurred_on == "2026-01-06"
        assert expense.description == f"Work order #{work_order.id}: Final repair"
        assert expense.cost_center == f"work_order:{work_order.id}"
        assert expense.status == "Pending"
        assert expense.created_by == users["mechanic"].id
        assert database.scalars(select(Expense.id)).all() == [expense_id]


@pytest.mark.parametrize("expense_status,amount", [("Approved", 100000), ("Rejected", 100000), ("Rejected", 0)])
def test_maintenance_sync_preserves_accounting_decisions(audit_api, expense_status, amount):
    client, database, users, vehicles = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    work_order = WorkOrder(organization_id=1, vehicle_id=vehicles[0].id, title="Repair", status="Completed", labor_hours=5)
    database.add(work_order)
    database.flush()
    expense = expense_for(
        users["mechanic"], vehicles[0], amount=amount, category="MAINTENANCE",
        status=expense_status, cost_center=f"work_order:{work_order.id}",
    )
    database.add(expense)
    database.commit()
    assert client.get("/api/v1/financials/ledger").status_code == 200
    routes._sync_work_order_expense(database, work_order, users["accountant"])
    database.commit()
    database.refresh(expense)
    assert expense.status == expense_status
    assert expense.amount_paise == amount
    assert expense.incurred_on == "2026-01-15"
    assert expense.description == "Synthetic expense"


def test_finance_period_filters_business_dates_and_uses_period_distance(audit_api):
    client, database, users, vehicles = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    database.add_all([
        expense_for(users["fleet_manager"], vehicles[0], category="FUEL", amount=1000),
        expense_for(users["fleet_manager"], vehicles[0], category="MAINTENANCE", amount=500),
        expense_for(users["fleet_manager"], vehicles[0], category="OTHER", amount=200),
        expense_for(users["fleet_manager"], vehicles[1], category="FUEL", amount=9900),
        OdometerLog(organization_id=1, vehicle_id=vehicles[0].id, reading_km=5000, source="driver", created_at=datetime(2026, 1, 1)),
        OdometerLog(organization_id=1, vehicle_id=vehicles[0].id, reading_km=5500, source="driver", created_at=datetime(2026, 1, 31)),
    ])
    database.commit()
    params = {"start_date": "2026-01-01", "end_date": "2026-01-31", "vehicle_id": vehicles[0].id}
    response = client.get("/api/v1/financials/metrics", params=params)
    assert response.status_code == 200, response.text
    metrics = response.json()
    assert metrics["totals"]["expenses"] == 17
    assert metrics["totals"]["cpk"] == pytest.approx(17 / 500)
    assert metrics["breakdown"]["other_expenses"] == 2
    params["category"] = "FUEL"
    ledger = client.get("/api/v1/financials/ledger", params=params).json()
    exported = client.get("/api/v1/export/expenses", params=params).json()
    filtered_metrics = client.get("/api/v1/financials/metrics", params=params).json()
    assert ledger["total"] == 1
    assert exported["row_count"] == 1
    assert filtered_metrics["totals"]["expenses"] == 10
    assert client.get("/api/v1/financials/metrics", params={"start_date": "2026-02-01", "end_date": "2026-01-01"}).status_code == 422


def test_missing_distance_is_unavailable_instead_of_absolute_odometer_cpk(audit_api):
    client, _, users, _ = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    metrics = client.get("/api/v1/financials/metrics").json()
    assert metrics["totals"]["cpk"] is None
    assert all(row["cpk"] is None for row in metrics["rows"])


def test_period_distance_does_not_attribute_old_readings_to_current_costs(audit_api):
    client, database, users, vehicles = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    database.add_all([
        expense_for(users["fleet_manager"], vehicles[0], category="FUEL", amount=1000),
        OdometerLog(organization_id=1, vehicle_id=vehicles[0].id, reading_km=1000, source="driver", created_at=datetime(2025, 11, 1)),
        OdometerLog(organization_id=1, vehicle_id=vehicles[0].id, reading_km=5500, source="driver", created_at=datetime(2026, 1, 31)),
    ])
    database.commit()
    metrics = client.get("/api/v1/financials/metrics", params={
        "vehicle_id": vehicles[0].id, "start_date": "2026-01-01", "end_date": "2026-01-31",
    }).json()
    assert metrics["totals"]["expenses"] == 10
    assert metrics["totals"]["cpk"] is None
    assert metrics["rows"][0]["distance_km"] is None


@pytest.mark.parametrize("logs,fuels,expected", [
    ([("2026-01-01T10:00:00", 1100), ("2026-01-02T10:00:00", 1300)], [("2026-01-01", 1200)], 200),
    ([("2026-01-01T09:00:00", 1000), ("2026-01-01T18:00:00", 1100)], [("2026-01-01", 1200)], 200),
    ([("2026-01-01T09:00:00", 1100), ("2026-01-01T18:00:00", 1000)], [("2026-01-01", 1200)], None),
    ([("2026-01-02T10:00:00", 1100)], [("2026-01-01", 1200)], None),
    ([], [("2026-01-01", 1000), ("2026-01-02", 1300)], 300),
    ([], [("2026-01-01", 1000), ("2026-01-01", 1300)], None),
])
def test_period_distance_respects_date_only_fuel_evidence(audit_api, logs, fuels, expected):
    _, database, users, vehicles = audit_api
    vehicle = vehicles[0]
    database.add_all(
        OdometerLog(
            organization_id=1, vehicle_id=vehicle.id, reading_km=reading,
            source="driver", created_at=datetime.fromisoformat(timestamp),
        )
        for timestamp, reading in logs
    )
    database.add_all(
        FuelTransaction(
            organization_id=1, vehicle_id=vehicle.id, odometer_km=reading, incurred_on=day,
            fuel_type="Diesel", litres_milli=1000, price_per_litre_paise=10000,
            total_amount_paise=10000, created_by=users["driver"].id,
        )
        for day, reading in fuels
    )
    database.commit()
    distances = period_distance(database, 1, [vehicle.id], date(2026, 1, 1), date(2026, 1, 31))
    assert distances[vehicle.id] == expected


def test_ledger_has_count_and_second_page_and_exports_all_filtered_records(audit_api):
    client, database, users, vehicles = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    database.add_all(expense_for(users["fleet_manager"], vehicles[0]) for _ in range(23))
    database.commit()
    first = client.get("/api/v1/financials/ledger").json()
    second = client.get("/api/v1/financials/ledger?skip=20").json()
    assert first["total"] == second["total"] == 23
    assert len(first["items"]) == 20
    assert len(second["items"]) == 3
    assert not {item["id"] for item in first["items"]} & {item["id"] for item in second["items"]}
    assert client.get("/api/v1/export/expenses").json()["row_count"] == 23


def test_reconciliation_persists_evidence_and_is_idempotent(audit_api):
    client, database, users, vehicles = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    expense = expense_for(users["fleet_manager"], vehicles[0])
    database.add(expense)
    database.commit()
    path = f"/api/v1/expenses/{expense.id}/reconcile"
    response = client.post(path, json={"reconciliation_ref": "BANK-123"})
    assert response.status_code == 200
    assert response.json()["reconciliation_ref"] == "BANK-123"
    assert response.json()["reconciled_at"] is not None
    assert client.post(path, json={"reconciliation_ref": "BANK-123"}).status_code == 200
    assert client.post(path, json={"reconciliation_ref": "BANK-other"}).status_code == 409
    assert database.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "expense.reconciled")) == 1


def test_accountant_vehicle_choices_are_tenant_scoped_without_operational_writes(audit_api):
    client, database, users, vehicles = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    database.add(Organization(id=2, name="Other fleet", slug="other"))
    database.add(Vehicle(organization_id=2, registration_number="OTHER", model="Truck", vehicle_type="Truck", depot="Main"))
    database.commit()
    choices = client.get("/api/v1/financials/vehicles").json()
    assert {item["id"] for item in choices} == {str(vehicle.id) for vehicle in vehicles}
    assert client.patch(f"/api/v1/vehicles/{vehicles[0].id}", json={"odometer_km": 9500}).status_code == 403


def test_purchase_order_receipts_validate_evidence_limits_and_inventory_accounting(audit_api):
    client, database, users, _ = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["inventory_manager"]
    vendor = Vendor(organization_id=1, name="Receipt vendor", vendor_type="Parts supplier")
    part = Part(
        organization_id=1, sku="RECEIPT-1", name="Receipt part", category="Other",
        quantity_on_hand=10, reorder_level=1, unit_cost_paise=5000,
    )
    location = StockLocation(organization_id=1, name="Main store", code="MAIN")
    database.add_all([vendor, part, location])
    database.flush()
    order = PurchaseOrder(
        organization_id=1, vendor_id=vendor.id, order_number="PO-RECEIPT",
        status="Submitted", total_paise=40000, created_by=users["inventory_manager"].id,
    )
    database.add(order)
    database.flush()
    database.add(PurchaseOrderLine(
        organization_id=1, purchase_order_id=order.id, part_id=part.id,
        quantity=4, unit_cost_paise=10000, line_total_paise=40000,
    ))
    database.commit()

    path = f"/api/v1/purchase-orders/{order.id}/receive-partial"
    invalid = client.post(path, json={"items": [{
        "part_id": part.id, "quantity": 2, "damaged_quantity": 3,
        "backordered_quantity": 0, "unit_cost_paise": 20000,
        "invoice_number": "INV-BAD", "location_id": location.id,
    }]})
    assert invalid.status_code == 422
    assert part.quantity_on_hand == 10
    assert database.scalar(select(func.count(PurchaseOrderReceipt.id))) == 0

    payload = {"items": [{
        "part_id": part.id, "quantity": 3, "damaged_quantity": 1,
        "backordered_quantity": 1, "variance_reason": "One damaged",
        "unit_cost_paise": 20000, "invoice_number": "INV-100",
        "location_id": location.id,
    }]}
    database.add(Organization(id=2, name="Other stores", slug="other-stores"))
    foreign_location = StockLocation(organization_id=2, name="Foreign store", code="FOREIGN")
    inactive_location = StockLocation(organization_id=1, name="Inactive store", code="INACTIVE", active=False)
    database.add_all([foreign_location, inactive_location])
    database.commit()
    for invalid_location in (foreign_location.id, inactive_location.id, 99999):
        invalid_payload = {"items": [{**payload["items"][0], "location_id": invalid_location}]}
        assert client.post(path, json=invalid_payload).status_code == 404
        database.refresh(part)
        assert part.quantity_on_hand == 10
        assert database.scalar(select(func.count(InventoryMovement.id))) == 0
        assert database.scalar(select(func.count(PurchaseOrderReceipt.id))) == 0
    response = client.post(path, headers={"Idempotency-Key": "receipt-1"}, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "Partially received"
    database.refresh(part)
    database.refresh(order)
    receipt = database.scalar(select(PurchaseOrderReceipt))
    assert part.quantity_on_hand == 12
    assert part.unit_cost_paise == 7500
    assert receipt.invoice_number == "INV-100"
    assert receipt.unit_cost_paise == 20000
    assert receipt.location_id == location.id
    assert database.scalar(select(func.sum(InventoryTransaction.quantity))) == 2
    movement = database.scalar(select(InventoryMovement))
    assert movement.location_id == location.id
    assert movement.part_id == part.id
    assert movement.organization_id == 1
    assert movement.quantity == 2
    assert movement.transaction_type == "receipt"
    assert movement.reference == "PO-RECEIPT:INV-100"
    assert client.get("/api/v1/inventory/movements").json()[0]["quantity"] == 2

    repeated = client.post(path, headers={"Idempotency-Key": "receipt-1"}, json=payload)
    assert repeated.status_code == 409
    database.refresh(part)
    assert part.quantity_on_hand == 12

    over_receipt = client.post(path, json={"items": [{
        "part_id": part.id, "quantity": 2, "damaged_quantity": 0,
        "backordered_quantity": 0, "unit_cost_paise": 21000,
        "invoice_number": "INV-101", "location_id": location.id,
    }]})
    assert over_receipt.status_code == 422
    database.refresh(part)
    assert part.quantity_on_hand == 12

    final = client.post(path, json={"items": [{
        "part_id": part.id, "quantity": 1, "damaged_quantity": 0,
        "backordered_quantity": 0, "unit_cost_paise": 21000,
        "invoice_number": "INV-102", "location_id": location.id,
    }]})
    assert final.status_code == 200
    assert final.json()["status"] == "Received"
    assert database.scalar(select(func.sum(InventoryMovement.quantity)).where(InventoryMovement.location_id == location.id)) == 3


def test_driver_reassignment_clears_previous_vehicle_and_repeats_without_duplicate_history(audit_api):
    client, database, users, vehicles = audit_api
    driver = users["driver"]
    first_path = f"/api/v1/vehicles/{vehicles[0].id}/assign-driver"
    first = client.post(first_path, json={"driver_id": driver.id})
    repeated = client.post(first_path, json={"driver_id": driver.id})
    assert first.status_code == repeated.status_code == 200
    assert first.json()["id"] == repeated.json()["id"]
    assert database.scalar(select(func.count(VehicleAssignment.id))) == 1
    second = client.post(
        f"/api/v1/vehicles/{vehicles[1].id}/assign-driver",
        json={"driver_id": driver.id},
    )
    assert second.status_code == 200
    database.refresh(vehicles[0])
    database.refresh(vehicles[1])
    assert vehicles[0].assigned_driver_id is None
    assert vehicles[0].driver_name is None
    assert vehicles[1].assigned_driver_id == driver.id
    active = database.scalars(select(VehicleAssignment).where(VehicleAssignment.active.is_(True))).all()
    assert len(active) == 1
    assert active[0].vehicle_id == vehicles[1].id
    ended = database.get(VehicleAssignment, first.json()["id"])
    assert not ended.active and ended.ended_at is not None

    updated = client.patch(f"/api/v1/vehicles/{vehicles[0].id}", json={"assigned_driver_id": driver.id})
    assert updated.status_code == 200
    database.refresh(vehicles[1])
    assert vehicles[1].assigned_driver_id is None and vehicles[1].driver_name is None
    assert database.scalar(select(func.count(VehicleAssignment.id)).where(VehicleAssignment.active.is_(True))) == 1


@pytest.mark.parametrize("terminal_status", ["Received", "Closed", "Cancelled"])
def test_terminal_purchase_orders_cannot_be_reopened(audit_api, terminal_status):
    client, database, users, _ = audit_api
    client.app.dependency_overrides[get_current_user] = lambda: users["inventory_manager"]
    vendor = Vendor(organization_id=1, name="Terminal vendor", vendor_type="Parts supplier")
    database.add(vendor)
    database.flush()
    order = PurchaseOrder(
        organization_id=1, vendor_id=vendor.id, order_number="PO-TERMINAL",
        status=terminal_status, total_paise=100, created_by=users["inventory_manager"].id,
    )
    database.add(order)
    database.commit()
    path = f"/api/v1/purchase-orders/{order.id}"
    assert client.patch(path, json={"status": "Submitted"}).status_code == 409
    database.refresh(order)
    assert order.status == terminal_status
    assert client.patch(path, json={"status": terminal_status}).status_code == 200
    client.app.dependency_overrides[get_current_user] = lambda: users["owner"]
    assert client.patch(path, json={"status": "Approved"}).status_code == 409
    database.refresh(order)
    assert order.status == terminal_status
    assert database.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "purchase_order.status_updated")) == 0


def test_maintenance_templates_persist_tasks_intervals_and_tenant_boundaries(audit_api):
    client, database, users, vehicles = audit_api
    payload = {
        "name": "Quarterly inspection", "vehicle_type": "All",
        "interval_km": 7000, "interval_days": 90,
        "tasks": ["Inspect brakes", "Replace filter"],
    }
    created = client.post("/api/v1/maintenance/templates", json=payload)
    assert created.status_code == 200, created.text
    template_id = created.json()["id"]
    path = f"/api/v1/maintenance/templates/{template_id}"
    assert client.get(path).json()["tasks"] == payload["tasks"]
    assert [row["id"] for row in client.get("/api/v1/maintenance/templates").json()] == [template_id]
    applied = client.post(f"{path}/apply", json={"vehicle_id": vehicles[0].id})
    assert applied.status_code == 200, applied.text
    plan = database.get(MaintenancePlan, applied.json()["maintenance_plan_id"])
    assert plan.name == payload["name"]
    assert plan.interval_km == 7000 and plan.interval_days == 90
    assert plan.next_due_km == vehicles[0].odometer_km + 7000
    assert plan.tasks == '["Inspect brakes", "Replace filter"]'
    repeated = client.post(f"{path}/apply", json={"vehicle_id": vehicles[0].id})
    assert repeated.json()["added"] == 0
    assert database.scalar(select(func.count(MaintenancePlan.id))) == 1

    database.add(Organization(id=2, name="Other organization", slug="template-other"))
    other = User(organization_id=2, email="other@template.example", full_name="Other", role="fleet_manager", password_hash="unused")
    database.add(other)
    database.commit()
    client.app.dependency_overrides[get_current_user] = lambda: other
    assert client.get("/api/v1/maintenance/templates").json() == []
    assert client.get(path).status_code == 404
    assert client.post(f"{path}/apply", json={"vehicle_id": vehicles[0].id}).status_code == 404
    assert client.delete(path).status_code == 404
    client.app.dependency_overrides[get_current_user] = lambda: users["fleet_manager"]
    payload["interval_km"] = 9000
    assert client.put(path, json=payload).json()["interval_km"] == 9000
    assert plan.interval_km == 7000
    assert client.delete(path).json()["deleted"]
    assert client.get(path).status_code == 404
    assert client.post("/api/v1/maintenance/templates/99999/apply", json={"vehicle_id": vehicles[0].id}).status_code == 404


def test_automation_uses_injected_request_and_preserves_idempotency(audit_api):
    client, _, _, vehicles = audit_api
    path = f"/api/v1/automation/evaluate-vehicle/{vehicles[0].id}"
    response = client.post(path, headers={"Idempotency-Key": "evaluate-vehicle"})
    assert response.status_code == 200, response.text
    assert client.post(path, headers={"Idempotency-Key": "evaluate-vehicle"}).status_code == 409


def test_vercel_get_cron_authenticates_and_generates_saved_template_tasks(audit_api, monkeypatch):
    client, database, _, vehicles = audit_api
    monkeypatch.setenv("CRON_SECRET", "synthetic-vercel-secret")
    settings = Settings(_env_file=None)
    assert settings.telematics_cron_secret == "synthetic-vercel-secret"
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    assert client.get("/api/v1/telematics/cron-sync").status_code == 401
    database.add(MaintenancePlan(
        organization_id=1, vehicle_id=vehicles[0].id, name="Saved inspection",
        tasks='["Check pressure", "Check tread"]', interval_days=30,
        next_due_on=(date.today() - timedelta(days=1)).isoformat(),
    ))
    database.add(ComplianceDocument(
        organization_id=1, vehicle_id=vehicles[0].id, name="Permit",
        document_type="Permit", expires_on=(date.today() - timedelta(days=1)).isoformat(),
    ))
    database.commit()
    headers = {"Authorization": "Bearer synthetic-vercel-secret"}
    response = client.get("/api/v1/telematics/cron-sync", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["maintenance_work_orders"] == 1
    assert response.json()["document_notifications"] == 1
    assert "dispatched_notifications" in response.json()
    assert database.scalars(select(WorkOrderChecklistItem.title).order_by(WorkOrderChecklistItem.sort_order)).all() == ["Check pressure", "Check tread"]
    repeated = client.get("/api/v1/telematics/cron-sync", headers=headers)
    assert repeated.json()["maintenance_work_orders"] == 0


def test_role_dashboard_reports_scoped_values_instead_of_placeholder_zeros(audit_api):
    client, database, users, vehicles = audit_api
    vehicles[0].assigned_driver_id = users["driver"].id
    vehicles[0].health = 80
    vehicles[1].health = 40
    database.add(WorkOrder(
        organization_id=1, vehicle_id=vehicles[0].id, title="Assigned repair",
        assigned_user_id=users["mechanic"].id, priority="Medium", status="In progress",
    ))
    database.add(Part(
        organization_id=1, name="Filter", sku="DASHBOARD", category="Other",
        quantity_on_hand=1, reorder_level=2, unit_cost_paise=100,
    ))
    database.commit()
    for role in ("driver", "mechanic"):
        client.app.dependency_overrides[get_current_user] = lambda role=role: users[role]
        response = client.get("/api/v1/dashboard/summary")
        assert response.status_code == 200, response.text
        summary = response.json()
        assert summary["org"]["vehicle_count"] == 2
        assert summary["fleet_overview"]["total_vehicles"] == 1
        assert summary["fleet_overview"]["active_vehicles"] == 1
        assert summary["fleet_overview"]["avg_fleet_health"] == 80
        assert summary["work_orders"]["active"] == 1
        assert summary["inventory"]["total_items"] is None
        assert summary["fuel_efficiency"]["avg_km_per_liter"] is None
    client.app.dependency_overrides[get_current_user] = lambda: users["inventory_manager"]
    summary = client.get("/api/v1/dashboard/summary").json()
    assert summary["inventory"] == {"low_stock_items": 1, "total_items": 1}
    assert summary["fleet_overview"]["avg_fleet_health"] == 60
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    assert client.get("/api/v1/dashboard/summary").json()["fleet_overview"]["total_vehicles"] == 2


def test_readiness_rewrite_reaches_backend_json(audit_api, monkeypatch):
    _, database, _, _ = audit_api
    monkeypatch.setattr(main, "engine", database.get_bind())
    config = json.loads((Path(__file__).resolve().parents[2] / "vercel.json").read_text())
    rewrite = next(rule for rule in config["rewrites"] if rule["source"] == "/ready")
    with TestClient(forwarded_app) as client:
        response = client.get(rewrite["destination"])
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {"status": "ready", "database": "ok"}


def test_dvir_submission_notifies_fleet_manager_and_owner(audit_api, monkeypatch):
    client, database, users, vehicles = audit_api
    monkeypatch.undo()
    vehicles[0].assigned_driver_id = users["driver"].id
    database.commit()
    client.app.dependency_overrides[get_current_user] = lambda: users["driver"]
    response = client.post("/api/v1/driver/inspections", json={
        "vehicle_id": vehicles[0].id,
        "inspection_type": "pre_trip",
        "status": "UNSAFE",
        "odometer_km": vehicles[0].odometer_km,
        "notes": "Brake pedal soft",
    })
    assert response.status_code == 201, response.text
    notification = database.scalar(select(OperationalNotification).where(
        OperationalNotification.notification_type == "dvir_submission",
    ))
    assert notification is not None
    assert notification.severity == "CRITICAL"
    assert "Brake pedal soft" in notification.detail
    delivered = database.scalars(select(NotificationDelivery.user_id).where(
        NotificationDelivery.notification_id == notification.id,
        NotificationDelivery.channel == "in_app",
    )).all()
    assert set(delivered) == {users["owner"].id, users["fleet_manager"].id}
    client.app.dependency_overrides[get_current_user] = lambda: users["fleet_manager"]
    listed = client.get("/api/v1/notifications").json()
    assert any(item["id"] == notification.id for item in listed)


def test_driver_issue_notification_surfaces_in_vehicle_issue_feed(audit_api, monkeypatch):
    client, database, users, vehicles = audit_api
    monkeypatch.undo()
    vehicles[0].assigned_driver_id = users["driver"].id
    database.commit()
    client.app.dependency_overrides[get_current_user] = lambda: users["driver"]
    response = client.post("/api/v1/driver/issues", json={
        "vehicle_id": vehicles[0].id,
        "title": "Brake warning light",
        "detail": "Warning light stayed on during pre-trip",
        "priority": "High",
    })
    assert response.status_code == 201, response.text
    notification = database.scalar(select(OperationalNotification).where(
        OperationalNotification.notification_type == "driver_issue",
    ))
    assert notification is not None
    assert notification.entity_type == "vehicle_issue"
    client.app.dependency_overrides[get_current_user] = lambda: users["fleet_manager"]
    filtered = client.get("/api/v1/notifications", params={"source_type": "VEHICLE_ISSUE"}).json()
    assert any(item["id"] == notification.id for item in filtered)
    detail = client.get(f"/api/v1/notifications/{notification.id}/source-detail")
    assert detail.status_code == 200, detail.text
    assert detail.json()["source_type"] == "VEHICLE_ISSUE"
    assert detail.json()["source"]["title"] == "Brake warning light"


def test_same_origin_mutations_are_not_cors_rejected():
    with TestClient(main.app) as client:
        foreign = client.post(
            "/api/v1/auth/login",
            headers={"Origin": "https://attacker.example"},
            json={"email": "someone@example.com", "password": "password123"},
        )
        assert foreign.status_code == 403
        assert foreign.json()["detail"] == "Origin is not allowed"
        same_origin = client.post(
            "/api/v1/auth/login",
            headers={"Origin": "http://testserver"},
            json={"email": "someone@example.com", "password": "password123"},
        )
        assert not (same_origin.status_code == 403 and same_origin.json()["detail"] == "Origin is not allowed")


def _insert_notification(database, user_id, severity, entity_type, entity_id, ntype="test"):
    notification = OperationalNotification(
        organization_id=1, notification_type=ntype, severity=severity,
        title="t", detail="d", entity_type=entity_type, entity_id=str(entity_id),
        dedupe_key=f"{ntype}:{entity_type}:{entity_id}",
    )
    database.add(notification)
    database.flush()
    database.add(NotificationDelivery(
        organization_id=1, notification_id=notification.id,
        user_id=user_id, channel="in_app", status="delivered",
    ))
    database.commit()
    return notification


def test_maintenance_threshold_and_inventory_filters_cover_entity_types(audit_api):
    client, database, users, vehicles = audit_api
    component = VehicleComponent(
        organization_id=1, vehicle_id=vehicles[0].id, name="Brake pads",
        component_type="wear", installed_at_km=0,
    )
    plan = MaintenancePlan(organization_id=1, vehicle_id=vehicles[0].id, name="Plan", tasks="[]")
    part = Part(organization_id=1, sku="SK1", name="Oil filter", category="Filters")
    database.add_all([component, plan, part])
    database.commit()
    n_component = _insert_notification(database, users["fleet_manager"].id, "danger", "vehicle_component", component.id, "component_threshold")
    n_plan = _insert_notification(database, users["fleet_manager"].id, "HIGH", "maintenance_plan", plan.id, "maintenance_due")
    n_part = _insert_notification(database, users["fleet_manager"].id, "HIGH", "part", part.id, "INVENTORY_LOW")
    response = client.get("/api/v1/notifications", params={"source_type": "MAINTENANCE_THRESHOLD"})
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()}
    assert {n_component.id, n_plan.id} <= ids
    assert n_part.id not in ids
    response = client.get("/api/v1/notifications", params={"source_type": "INVENTORY_LOW"})
    assert {item["id"] for item in response.json()} == {n_part.id}
    detail = client.get(f"/api/v1/notifications/{n_part.id}/source-detail")
    assert detail.status_code == 200
    assert detail.json()["source_type"] == "INVENTORY_LOW"
    assert detail.json()["source"]["sku"] == "SK1"


def test_severity_filter_matches_legacy_vocabulary(audit_api):
    client, database, users, vehicles = audit_api
    warning = _insert_notification(database, users["fleet_manager"].id, "warning", "vehicle", vehicles[0].id, "legacy_warning")
    danger = _insert_notification(database, users["fleet_manager"].id, "danger", "vehicle", vehicles[0].id, "legacy_danger")
    assert warning.id in {item["id"] for item in client.get("/api/v1/notifications", params={"severity": "HIGH"}).json()}
    assert danger.id in {item["id"] for item in client.get("/api/v1/notifications", params={"severity": "CRITICAL"}).json()}


def test_queue_notification_normalizes_legacy_severity(audit_api, monkeypatch):
    client, database, users, vehicles = audit_api
    monkeypatch.undo()
    routes.queue_role_notification(
        database, organization_id=1, notification_type="test_sev", severity="warning",
        title="t", detail="d", entity_type="vehicle", entity_id="1",
        roles={"fleet_manager"},
    )
    notification = database.scalar(select(OperationalNotification).where(
        OperationalNotification.notification_type == "test_sev"))
    assert notification.severity == "HIGH"


def test_fuel_log_notifies_finance_roles(audit_api, monkeypatch):
    client, database, users, vehicles = audit_api
    monkeypatch.undo()
    vehicles[0].assigned_driver_id = users["driver"].id
    database.commit()
    client.app.dependency_overrides[get_current_user] = lambda: users["driver"]
    response = client.post("/api/v1/fuel-transactions", json={
        "vehicle_id": vehicles[0].id, "fuel_type": "Diesel", "litres_milli": 10000,
        "price_per_litre_paise": 9000, "odometer_km": vehicles[0].odometer_km,
        "incurred_on": "2026-10-04"})
    assert response.status_code == 201, response.text
    notification = database.scalar(select(OperationalNotification).where(
        OperationalNotification.notification_type == "fuel_log"))
    assert notification is not None
    delivered = database.scalars(select(NotificationDelivery.user_id).where(
        NotificationDelivery.notification_id == notification.id,
        NotificationDelivery.channel == "in_app")).all()
    assert set(delivered) == {users["owner"].id, users["fleet_manager"].id, users["accountant"].id}


def test_expense_reject_and_approve_notify_submitter(audit_api, monkeypatch):
    client, database, users, vehicles = audit_api
    monkeypatch.undo()
    expense = Expense(
        organization_id=1, category="FUEL", description="Driver fuel", amount_paise=500000,
        incurred_on="2026-10-01", status="Pending", created_by=users["driver"].id,
    )
    database.add(expense)
    database.commit()
    client.app.dependency_overrides[get_current_user] = lambda: users["accountant"]
    response = client.post(f"/api/v1/financials/expenses/{expense.id}/reject", json={"reason": "Duplicate entry"})
    assert response.status_code == 200, response.text
    notification = database.scalar(select(OperationalNotification).where(
        OperationalNotification.notification_type == "expense_rejected"))
    assert notification is not None
    delivered = database.scalars(select(NotificationDelivery.user_id).where(
        NotificationDelivery.notification_id == notification.id)).all()
    assert delivered == [users["driver"].id]

    expense2 = Expense(
        organization_id=1, category="TOLL", description="Toll", amount_paise=30000,
        incurred_on="2026-10-01", status="Pending", created_by=users["driver"].id,
    )
    database.add(expense2)
    database.commit()
    response = client.post(f"/api/v1/financials/expenses/{expense2.id}/approve")
    assert response.status_code == 200, response.text
    notification = database.scalar(select(OperationalNotification).where(
        OperationalNotification.notification_type == "expense_approved"))
    assert notification is not None
    delivered = database.scalars(select(NotificationDelivery.user_id).where(
        NotificationDelivery.notification_id == notification.id)).all()
    assert delivered == [users["driver"].id]


def test_notification_serializer_exposes_ui_contract(audit_api):
    client, database, users, vehicles = audit_api
    notification = _insert_notification(database, users["fleet_manager"].id, "HIGH", "vehicle", vehicles[0].id, "ui_contract")
    notification.escalation_level = 2
    database.commit()
    listed = client.get("/api/v1/notifications").json()
    item = next(row for row in listed if row["id"] == notification.id)
    assert item["message"] == item["detail"]
    assert item["is_read"] is False
    assert item["escalation_level"] == 2
    assert item["reference_id"] == str(vehicles[0].id)
    read = client.patch(f"/api/v1/notifications/{notification.id}", json={"status": "read"})
    assert read.status_code == 200, read.text
    assert read.json()["is_read"] is True


def test_resolve_notification_records_submitted_note(audit_api):
    client, database, users, vehicles = audit_api
    notification = _insert_notification(database, users["fleet_manager"].id, "HIGH", "vehicle", vehicles[0].id, "resolve_note")
    response = client.post(f"/api/v1/notifications/{notification.id}/resolve", json={"note": "Fixed in the field"})
    assert response.status_code == 200, response.text
    log = database.scalar(select(AuditLog).where(
        AuditLog.action == "notification.resolved",
        AuditLog.entity_id == str(notification.id),
    ))
    assert "Fixed in the field" in (log.changes or "")
    database.refresh(notification)
    assert notification.status == "resolved"


def test_work_order_approval_notifies_assignee(audit_api, monkeypatch):
    client, database, users, vehicles = audit_api
    monkeypatch.undo()
    work_order = WorkOrder(
        organization_id=1, vehicle_id=vehicles[0].id, title="Brake service",
        status="Ready for review", priority="High", created_by=users["fleet_manager"].id,
        assigned_user_id=users["mechanic"].id,
    )
    database.add(work_order)
    database.commit()
    client.app.dependency_overrides[get_current_user] = lambda: users["owner"]
    response = client.post(f"/api/v1/work-orders/{work_order.id}/approve")
    assert response.status_code == 200, response.text
    notification = database.scalar(select(OperationalNotification).where(
        OperationalNotification.notification_type == "work_order_approved"))
    assert notification is not None
    delivered = database.scalars(select(NotificationDelivery.user_id).where(
        NotificationDelivery.notification_id == notification.id)).all()
    assert delivered == [users["mechanic"].id]


def test_unsafe_disposition_requires_a_valid_org_vehicle(audit_api, monkeypatch):
    client, database, users, vehicles = audit_api
    monkeypatch.undo()
    response = client.post(f"/api/v1/drivers/{users['driver'].id}/unsafe-disposition", json={
        "description": "Reckless driving", "severity": "high"})
    assert response.status_code == 400, response.text
    response = client.post(f"/api/v1/drivers/{users['driver'].id}/unsafe-disposition", json={
        "description": "Reckless driving", "severity": "high", "vehicle_id": 999999})
    assert response.status_code == 404, response.text
    vehicles[0].assigned_driver_id = users["driver"].id
    database.commit()
    response = client.post(f"/api/v1/drivers/{users['driver'].id}/unsafe-disposition", json={
        "description": "Reckless driving", "severity": "high"})
    assert response.status_code == 200, response.text
    issue = database.scalar(select(VehicleIssue).where(
        VehicleIssue.driver_id == users["driver"].id))
    assert issue.vehicle_id == vehicles[0].id
