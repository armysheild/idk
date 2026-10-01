import os
from pathlib import Path
import sys
from uuid import uuid4

os.environ["VAHANA_DATABASE_URL"] = "sqlite:///./test-accountant-finance-sync.db"
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi.testclient import TestClient

from backend.app.database import Base, engine
from backend.app.main import app


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

        reconciliation = client.get("/api/v1/financials/reconciliation", headers=accountant_headers)
        assert reconciliation.status_code == 200
        assert reconciliation.json()["mismatches"] == []
