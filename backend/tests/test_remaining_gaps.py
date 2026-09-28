import os
import sys
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
os.environ["VAHANA_DATABASE_URL"] = "sqlite:///./test-vahana.db"
os.environ["VAHANA_SEED_ADMIN_EMAIL"] = "test-admin@example.com"
os.environ["VAHANA_SEED_ADMIN_PASSWORD"] = "TestPassword!123"

from backend.app.database import Base, engine
from backend.app.main import app


def test_expenses_and_document_access_are_hardened(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={"email": "test-admin@example.com", "password": "TestPassword!123"},
        )
        assert login.status_code == 200
        owner_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        accountant_email = f"accountant-{uuid4().hex[:8]}@example.com"
        created_user = client.post(
            "/api/v1/users",
            headers=owner_headers,
            json={
                "email": accountant_email,
                "password": "TestPassword!123",
                "full_name": "Test Accountant",
                "role": "accountant",
            },
        )
        assert created_user.status_code == 201
        accountant_login = client.post(
            "/api/v1/auth/login",
            json={"email": accountant_email, "password": "TestPassword!123"},
        )
        assert accountant_login.status_code == 200
        accountant_headers = {"Authorization": f"Bearer {accountant_login.json()['access_token']}"}

        expense = client.post(
            "/api/v1/expenses",
            headers=accountant_headers,
            json={
                "category": "Maintenance",
                "description": "Brake inspection",
                "amount_paise": 250000,
                "incurred_on": "2027-02-01",
            },
        )
        assert expense.status_code == 201
        approved = client.patch(
            f"/api/v1/expenses/{expense.json()['id']}",
            headers=accountant_headers,
            json={"status": "Approved"},
        )
        assert approved.status_code == 403

        fleet_email = f"fleet-{uuid4().hex[:8]}@example.com"
        created_fleet = client.post(
            "/api/v1/users",
            headers=owner_headers,
            json={
                "email": fleet_email,
                "password": "TestPassword!123",
                "full_name": "Test Fleet Manager",
                "role": "fleet_manager",
            },
        )
        assert created_fleet.status_code == 201
        fleet_login = client.post(
            "/api/v1/auth/login",
            json={"email": fleet_email, "password": "TestPassword!123"},
        )
        assert fleet_login.status_code == 200
        fleet_headers = {"Authorization": f"Bearer {fleet_login.json()['access_token']}"}
        document = client.post(
            "/api/v1/documents",
            headers=fleet_headers,
            json={
                "name": f"Fitness {uuid4().hex[:6]}",
                "document_type": "Fitness",
                "expires_on": "2027-06-18",
            },
        )
        assert document.status_code == 201
        document_id = document.json()["id"]
        uploaded = client.post(
            f"/api/v1/documents/{document_id}/file",
            headers=fleet_headers,
            files={"file": ("fitness.txt", b"fitness-certificate", "text/plain")},
        )
        assert uploaded.status_code == 201
        downloaded = client.get(f"/api/v1/documents/{document_id}/file", headers=fleet_headers)
        assert downloaded.status_code == 200
        history = client.get(f"/api/v1/documents/{document_id}/access-history", headers=fleet_headers)
        assert history.status_code == 200
        assert {entry["access_type"] for entry in history.json()} >= {"download"}


def test_scheduled_processing_requires_cron_credentials(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    monkeypatch.setenv("VAHANA_TELEMATICS_CRON_SECRET", "scheduled-secret")
    os.environ["VAHANA_TELEMATICS_CRON_SECRET"] = "scheduled-secret"
    with TestClient(app) as client:
        response = client.post("/api/v1/telematics/cron-sync")
        assert response.status_code == 401
