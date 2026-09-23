import os
from pathlib import Path
import sys
from uuid import uuid4

os.environ["VAHANA_DATABASE_URL"] = "sqlite:///./test-telematics-integration.db"
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


def test_provider_credentials_are_private_and_devices_share_provider_config(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as client:
        signup = client.post("/api/v1/auth/signup", json={
            "organization_name": "Telemetry Fleet",
            "full_name": "Owner",
            "email": f"owner-{uuid4().hex[:8]}@telemetry.example",
            "password": "OwnerPassword!123",
        })
        assert signup.status_code == 201
        owner_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
        fleet_headers = _invite(client, owner_headers, f"fleet-{uuid4().hex[:8]}@telemetry.example", "fleet_manager")

        first_vehicle = client.post("/api/v1/vehicles", headers=fleet_headers, json={
            "registration_number": "TM 01 AA 1001",
            "model": "Truck",
            "vehicle_type": "Truck",
            "depot": "Main depot",
        })
        second_vehicle = client.post("/api/v1/vehicles", headers=fleet_headers, json={
            "registration_number": "TM 01 AA 1002",
            "model": "Van",
            "vehicle_type": "Van",
            "depot": "Main depot",
        })
        assert first_vehicle.status_code == 201
        assert second_vehicle.status_code == 201

        integration = client.post("/api/v1/telematics/integrations", headers=fleet_headers, json={
            "provider": "Samsara",
            "base_url": "https://telemetry.example",
            "api_token": "secret-token",
            "sync_interval_minutes": 60,
        })
        assert integration.status_code == 201
        assert "api_token" not in integration.json()
        assert "credential_ciphertext" not in integration.json()

        duplicate = client.post("/api/v1/telematics/integrations", headers=fleet_headers, json={
            "provider": "samsara",
            "base_url": "https://telemetry.example",
            "api_token": "another-token",
        })
        assert duplicate.status_code == 409

        for vehicle, identifier in ((first_vehicle, "SAM-1001"), (second_vehicle, "SAM-1002")):
            mapped = client.post("/api/v1/telematics/devices", headers=fleet_headers, json={
                "vehicle_id": vehicle.json()["id"],
                "provider": "Samsara",
                "device_identifier": identifier,
            })
            assert mapped.status_code == 201

        overview = client.get("/api/v1/telematics/overview", headers=fleet_headers)
        assert overview.status_code == 200
        assert overview.json()["integrations"][0]["provider"] == "samsara"
        assert {device["device_identifier"] for device in overview.json()["devices"]} == {"SAM-1001", "SAM-1002"}
