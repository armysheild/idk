import os
from pathlib import Path
import sys

os.environ["VAHANA_DATABASE_URL"] = "sqlite:///./test-form-contracts.db"
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi.testclient import TestClient

from backend.app.database import Base, SessionLocal, engine
from backend.app.main import app
from backend.app.models import ComponentServiceRecord, User


def test_vehicle_component_and_owner_integration_fields_persist(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as client:
        signup = client.post("/api/v1/auth/signup", json={
            "organization_name": "Contract Fleet",
            "full_name": "Owner",
            "email": "owner@contract-fleet.example",
            "password": "OwnerPassword!123",
        })
        assert signup.status_code == 201
        owner_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}

        invitation = client.post("/api/v1/invitations", headers=owner_headers, json={
            "email": "fleet@contract-fleet.example",
            "full_name": "Fleet Manager",
            "role": "fleet_manager",
        })
        assert invitation.status_code == 201
        accepted = client.post("/api/v1/auth/invitations/accept", json={
            "token": invitation.json()["invite_token"],
            "password": "FleetPassword!123",
        })
        assert accepted.status_code == 200
        fleet_headers = {"Authorization": f"Bearer {accepted.json()['access_token']}"}

        vehicle = client.post("/api/v1/vehicles", headers=fleet_headers, json={
            "registration_number": "DL 01 CONTRACT",
            "vin": "1HGBH41JXMN109186",
            "chassis_number": "CHASSIS-42",
            "engine_number": "ENGINE-42",
            "make": "Tata",
            "model": "Starbus",
            "model_year": 2024,
            "vehicle_type": "Bus",
            "depot": "Main depot",
            "assigned_route": "Route 42",
            "maintenance_template": "City Bus",
            "odometer_km": 12000,
        })
        assert vehicle.status_code == 201
        assert vehicle.json()["vin"] == "1HGBH41JXMN109186"
        assert vehicle.json()["assigned_route"] == "Route 42"

        component = client.post("/api/v1/components", headers=fleet_headers, json={
            "vehicle_id": vehicle.json()["id"],
            "name": "Front brake pads",
            "component_type": "Brakes",
            "component_subtype": "Front axle",
            "brand": "Bendix",
            "part_number": "BP-42",
            "serial_number": "SERIAL-42",
            "installation_date": "2026-09-28",
            "installed_at_km": 12000,
            "service_interval_km": 10000,
            "expected_life_days": 365,
            "alert_threshold_km": 1000,
            "alert_threshold_days": 30,
            "notes": "Inspect during monthly service",
        })
        assert component.status_code == 201
        assert component.json()["component_subtype"] == "Front axle"
        assert component.json()["expected_life_days"] == 365
        assert component.json()["next_service_km"] == 22000

        second_vehicle = client.post("/api/v1/vehicles", headers=fleet_headers, json={
            "registration_number": "DL 02 CONTRACT",
            "model": "Starbus",
            "vehicle_type": "Bus",
            "depot": "Main depot",
        })
        assert second_vehicle.status_code == 201
        with SessionLocal() as database:
            database.add(ComponentServiceRecord(
                organization_id=vehicle.json()["organization_id"],
                component_id=component.json()["id"],
                vehicle_id=vehicle.json()["id"],
                odometer_km=12000,
                performed_by=database.query(User).filter(User.email == "fleet@contract-fleet.example").one().id,
            ))
            database.commit()
        moved = client.patch(f"/api/v1/components/{component.json()['id']}", headers=fleet_headers, json={
            "vehicle_id": second_vehicle.json()["id"],
        })
        assert moved.status_code == 200
        history = client.get(
            f"/api/v1/components/{component.json()['id']}/service-history",
            headers=fleet_headers,
        )
        assert history.status_code == 200
        assert history.json()[0]["vehicle_id"] == second_vehicle.json()["id"]

        integrations = client.get("/api/v1/organization/integrations", headers=owner_headers)
        assert integrations.status_code == 200
        assert {item["provider"] for item in integrations.json()} == {
            "government", "insurance", "tax", "fuel", "bank",
        }
        updated = client.put("/api/v1/organization/integrations/fuel", headers=owner_headers, json={
            "endpoint": "https://fuel.example/api",
            "account_identifier": "fleet-42",
            "active": True,
        })
        assert updated.status_code == 200
        assert updated.json()["status"] == "connected"
        assert updated.json()["account_identifier"] == "fleet-42"


def test_legacy_owner_cannot_be_deleted(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as client:
        signup = client.post("/api/v1/auth/signup", json={
            "organization_name": "Legacy Owner Fleet",
            "full_name": "Owner",
            "email": "legacy-owner@fleet.example",
            "password": "OwnerPassword!123",
        })
        owner_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
        invitation = client.post("/api/v1/invitations", headers=owner_headers, json={
            "email": "legacy-target@fleet.example",
            "full_name": "Legacy Owner",
            "role": "fleet_manager",
        })
        accepted = client.post("/api/v1/auth/invitations/accept", json={
            "token": invitation.json()["invite_token"],
            "password": "LegacyPassword!123",
        })
        target_id = accepted.json()["user"]["id"]
        with SessionLocal() as database:
            target = database.get(User, target_id)
            target.role = "SUPERADMIN"
            database.commit()
        deleted = client.delete(f"/api/v1/users/{target_id}", headers=owner_headers)
        assert deleted.status_code == 403
