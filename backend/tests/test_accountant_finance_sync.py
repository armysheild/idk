import os
from pathlib import Path
import sys
from uuid import uuid4

os.environ["VAHANA_DATABASE_URL"] = "sqlite:///./test-accountant-finance-sync.db"
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi.testclient import TestClient

from backend.app.database import Base, SessionLocal, engine
from backend.app.main import app
from backend.app.models import Organization, WorkOrder


def _invite(client: TestClient, owner_headers: dict[str, str], email: str, role: str) -> dict[str, str]:
    invitation = client.post("/api/v1/invitations", headers=owner_headers, json={
        "email": email,
        "full_name": role.replace("_", " ").title(),
        "role": role,
    })
    assert invitation.status_code == 201
    accepted = client.post("/api/v1/auth/invitations/accept", json={
        "token": invitation.json()["invite_token"],
        "password": "RolePassword!123",
    })
    assert accepted.status_code == 200
    return {"Authorization": f"Bearer {accepted.json()['access_token']}"}


def test_fuel_logs_create_accountant_ledger_records(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    with TestClient(app) as client:
        signup = client.post("/api/v1/auth/signup", json={
            "organization_name": "Finance Sync Fleet",
            "full_name": "Owner",
            "email": f"owner-{uuid4().hex[:8]}@finance-sync.example",
            "password": "OwnerPassword!123",
        })
        assert signup.status_code == 201
        owner_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
        fleet_headers = _invite(
            client,
            owner_headers,
            f"fleet-{uuid4().hex[:8]}@finance-sync.example",
            "fleet_manager",
        )
        accountant_headers = _invite(
            client,
            owner_headers,
            f"accountant-{uuid4().hex[:8]}@finance-sync.example",
            "accountant",
        )

        vehicle = client.post("/api/v1/vehicles", headers=fleet_headers, json={
            "registration_number": f"FS-{uuid4().hex[:6].upper()}",
            "model": "Finance Truck",
            "vehicle_type": "Truck",
            "depot": "Finance depot",
        })
        assert vehicle.status_code == 201

        fuel = client.post("/api/v1/fuel-transactions", headers=fleet_headers, json={
            "vehicle_id": vehicle.json()["id"],
            "station": "Indian Oil",
            "fuel_type": "Diesel",
            "litres_milli": 42000,
            "price_per_litre_paise": 10000,
            "odometer_km": 100050,
            "incurred_on": "2026-10-01",
        })
        assert fuel.status_code == 201

        records = client.get("/api/v1/expenses", headers=accountant_headers)
        assert records.status_code == 200
        ledger_record = next(item for item in records.json() if item["category"] == "FUEL")
        assert ledger_record["amount_paise"] == 420000
        assert ledger_record["cost_center"] == f"fuel_transaction:{fuel.json()['id']}"

        metrics = client.get("/api/v1/financials/metrics", headers=accountant_headers)
        assert metrics.status_code == 200
        assert metrics.json()["totals"]["expenses"] == 4200
        assert metrics.json()["rows"][0]["expenses"] == 4200

        revenue = client.post("/api/v1/expenses", headers=accountant_headers, json={
            "vehicle_id": vehicle.json()["id"],
            "category": "FARE_REVENUE",
            "description": "Route fare collection",
            "amount_paise": 10000,
            "incurred_on": "2026-10-01",
        })
        assert revenue.status_code == 201
        metrics = client.get("/api/v1/financials/metrics", headers=accountant_headers)
        assert metrics.status_code == 200
        assert metrics.json()["totals"]["revenue"] == 100
        assert metrics.json()["totals"]["expenses"] == 4200
        assert metrics.json()["totals"]["profit"] == -4100
        assert metrics.json()["rows"][0]["revenue"] == 100
        assert metrics.json()["rows"][0]["profit"] == -4100

        reconciliation = client.get("/api/v1/financials/reconciliation", headers=accountant_headers)
        assert reconciliation.status_code == 200
        assert reconciliation.json()["mismatches"] == []


def test_work_order_status_update_creates_maintenance_ledger_record(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    with TestClient(app) as client:
        signup = client.post("/api/v1/auth/signup", json={
            "organization_name": "Maintenance Sync Fleet",
            "full_name": "Owner",
            "email": f"owner-{uuid4().hex[:8]}@maintenance-sync.example",
            "password": "OwnerPassword!123",
        })
        assert signup.status_code == 201
        owner_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
        mechanic_headers = _invite(
            client,
            owner_headers,
            f"mechanic-{uuid4().hex[:8]}@maintenance-sync.example",
            "mechanic",
        )
        mechanic_id = client.get("/api/v1/auth/me", headers=mechanic_headers).json()["id"]
        fleet_headers = _invite(
            client,
            owner_headers,
            f"fleet-{uuid4().hex[:8]}@maintenance-sync.example",
            "fleet_manager",
        )
        vehicle = client.post("/api/v1/vehicles", headers=fleet_headers, json={
            "registration_number": f"MS-{uuid4().hex[:6].upper()}",
            "model": "Maintenance Truck",
            "vehicle_type": "Truck",
            "depot": "Maintenance depot",
        })
        assert vehicle.status_code == 201
        work_order = client.post("/api/v1/work-orders", headers=fleet_headers, json={
            "vehicle_id": vehicle.json()["id"],
            "title": "Maintenance status handoff",
            "workstream": "physical_repair",
            "assigned_user_id": mechanic_id,
        })
        assert work_order.status_code == 201
        order_id = work_order.json()["id"]
        with SessionLocal() as database:
            organization = database.get(Organization, signup.json()["user"]["organization_id"])
            organization.labor_rate_per_hour = 500
            database.get(WorkOrder, order_id).labor_hours = 2
            database.commit()

        assert client.post(f"/api/v1/work-orders/{order_id}/start", headers=mechanic_headers).status_code == 200
        updated = client.patch(
            f"/api/v1/work-orders/{order_id}",
            headers=mechanic_headers,
            json={"status": "Ready for review"},
        )
        assert updated.status_code == 200
        expenses = client.get("/api/v1/expenses", headers=owner_headers)
        assert expenses.status_code == 200
        maintenance_expense = next(
            item for item in expenses.json()
            if item["cost_center"] == f"work_order:{order_id}"
        )
        assert maintenance_expense["amount_paise"] == 100000
