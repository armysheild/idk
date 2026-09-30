import os
from pathlib import Path
import sys
from uuid import uuid4

os.environ["VAHANA_DATABASE_URL"] = "sqlite:///./test-production-contracts.db"
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi.testclient import TestClient

from backend.app.database import Base, engine
from backend.app.main import app
from backend.app import security
from backend.app.config import get_settings


def _invite(client: TestClient, owner_headers: dict[str, str], role: str) -> dict:
    invitation = client.post("/api/v1/invitations", headers=owner_headers, json={
        "email": f"{role}-{uuid4().hex[:8]}@contracts.example",
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


def test_technical_workstream_and_read_aliases(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    with TestClient(app) as client:
        signup = client.post("/api/v1/auth/signup", json={
            "organization_name": "Contract Fleet",
            "full_name": "Owner",
            "email": f"owner-{uuid4().hex[:8]}@contracts.example",
            "password": "OwnerPassword!123",
        })
        assert signup.status_code == 201
        owner_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
        fleet_headers = _invite(client, owner_headers, "fleet_manager")
        technician_headers = _invite(client, owner_headers, "technician")
        technician_id = client.get("/api/v1/auth/me", headers=technician_headers).json()["id"]

        vehicle = client.post("/api/v1/vehicles", headers=fleet_headers, json={
            "registration_number": f"CN {uuid4().hex[:6].upper()}",
            "model": "Diagnostic Truck",
            "vehicle_type": "Truck",
            "depot": "Contract depot",
        })
        assert vehicle.status_code == 201
        vehicle_id = vehicle.json()["id"]

        technical = client.post("/api/v1/work-orders", headers=fleet_headers, json={
            "vehicle_id": vehicle_id,
            "title": "Diagnostic fault investigation",
            "workstream": "technical_diagnostics",
        })
        assert technical.status_code == 201
        assert technical.json()["workstream"] == "technical_diagnostics"

        assignment = client.post(
            f"/api/v1/work-orders/{technical.json()['id']}/assign",
            headers=fleet_headers,
            json={"mechanic_id": technician_id},
        )
        assert assignment.status_code == 200
        assert assignment.json()["assigned_mechanic_id"] == technician_id

        detail = client.get(f"/api/v1/vehicles/{vehicle_id}", headers=fleet_headers)
        assert detail.status_code == 200
        assert detail.json()["id"] == vehicle_id

        audit = client.get("/api/v1/audit", headers=owner_headers)
        assert audit.status_code == 200
        assert any(item["action"] == "work_order.created" for item in audit.json())


def test_supabase_session_exchange_returns_provider_token(monkeypatch):
    monkeypatch.setenv("VAHANA_SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("VAHANA_SUPABASE_ANON_KEY", "anon-key")
    get_settings.cache_clear()

    class Response:
        status_code = 200

        def json(self):
            return {"access_token": "supabase-access-token"}

    calls: list[dict] = []

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return Response()

    monkeypatch.setattr(security.httpx, "post", fake_post)
    assert security.sign_in_supabase_user("owner@example.com", "password") == "supabase-access-token"
    assert calls[0]["url"] == "https://example.supabase.co/auth/v1/token?grant_type=password"
    assert calls[0]["json"] == {"email": "owner@example.com", "password": "password"}
    get_settings.cache_clear()
