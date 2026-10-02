from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
from unittest.mock import Mock

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
from backend.app.models import (
    Organization, User, Vehicle, TelematicsDevice, TelematicsIntegration,
    TelemetryReading,
    AuditLog, Expense, WorkOrder, OdometerLog,
    InventoryTransaction, Part, PurchaseOrder, PurchaseOrderLine,
    PurchaseOrderReceipt, StockLocation, Vendor, VehicleAssignment, MaintenancePlan,
    ComplianceDocument, WorkOrderChecklistItem,
)
from backend.app.telematics import approved_provider_url


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
    monkeypatch.setattr(routes.httpx, "get", outbound)
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
        approved_provider_url("a", url, "/readings", Settings())


def test_unapproved_or_private_provider_destinations_are_blocked(monkeypatch):
    settings = Settings(telematics_provider_hosts={"a": ["telemetry.example"]})
    with pytest.raises(ValueError, match="not approved"):
        approved_provider_url("a", "https://other.example", "/readings", settings)
    monkeypatch.setattr(
        "backend.app.telematics.socket.getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("127.0.0.1", 443))],
    )
    with pytest.raises(ValueError, match="public"):
        approved_provider_url("a", "https://telemetry.example", "/readings", settings)


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
    assert outbound.call_args.kwargs["follow_redirects"] is False


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
