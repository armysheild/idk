import os
from pathlib import Path
import sys
from uuid import uuid4

os.environ["VAHANA_DATABASE_URL"] = "sqlite:///./test-part-traceability.db"
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


def test_part_custody_is_distinct_from_vehicle_installation(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as client:
        signup = client.post("/api/v1/auth/signup", json={
            "organization_name": "Traceable Fleet",
            "full_name": "Owner",
            "email": f"owner-{uuid4().hex[:8]}@traceable.example",
            "password": "OwnerPassword!123",
        })
        assert signup.status_code == 201
        owner_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
        fleet_headers = _invite(client, owner_headers, f"fleet-{uuid4().hex[:8]}@traceable.example", "fleet_manager")
        inventory_headers = _invite(client, owner_headers, f"inventory-{uuid4().hex[:8]}@traceable.example", "inventory_manager")
        mechanic_headers = _invite(client, owner_headers, f"mechanic-{uuid4().hex[:8]}@traceable.example", "mechanic")

        vehicle = client.post("/api/v1/vehicles", headers=fleet_headers, json={
            "registration_number": f"TR {uuid4().hex[:6].upper()}",
            "model": "Fleet Truck",
            "vehicle_type": "Truck",
            "depot": "Main depot",
        })
        assert vehicle.status_code == 201
        part = client.post("/api/v1/parts", headers=inventory_headers, json={
            "sku": f"BAT-{uuid4().hex[:8].upper()}",
            "name": "Starter battery",
            "category": "Electrical",
            "quantity_on_hand": 3,
            "unit_cost_paise": 50000,
        })
        assert part.status_code == 201
        work_order = client.post("/api/v1/work-orders", headers=fleet_headers, json={
            "vehicle_id": vehicle.json()["id"],
            "title": "Replace starter battery",
            "workstream": "physical_repair",
        })
        assert work_order.status_code == 201
        mechanic_id = client.get("/api/v1/auth/me", headers=mechanic_headers).json()["id"]
        assigned = client.post(
            f"/api/v1/work-orders/{work_order.json()['id']}/assign",
            headers=fleet_headers,
            json={"mechanic_id": mechanic_id},
        )
        assert assigned.status_code == 200
        started = client.post(f"/api/v1/work-orders/{work_order.json()['id']}/start", headers=mechanic_headers)
        assert started.status_code == 200

        reserved = client.post(
            f"/api/v1/work-orders/{work_order.json()['id']}/reserve-part",
            headers=mechanic_headers,
            json={"part_id": part.json()["id"], "quantity": 1},
        )
        assert reserved.status_code == 200
        usage_id = reserved.json()["usage_id"]
        assert client.get(f"/api/v1/work-orders/{work_order.json()['id']}/part-installations", headers=mechanic_headers).json() == []
        issued = client.post(
            f"/api/v1/work-orders/{work_order.json()['id']}/issue-part",
            headers=inventory_headers,
            json={"work_order_part_usage_id": usage_id, "quantity": 1},
        )
        assert issued.status_code == 200
        assert issued.json()["issued_to_user_id"] == mechanic_id

        installed = client.post(
            f"/api/v1/work-orders/{work_order.json()['id']}/part-installations",
            headers=mechanic_headers,
            json={
                "work_order_part_usage_id": usage_id,
                "serial_number": "BAT-SERIAL-001",
                "installed_odometer_km": 12000,
            },
        )
        assert installed.status_code == 201
        assert installed.json()["status"] == "active"
        vehicle_history = client.get(
            f"/api/v1/vehicles/{vehicle.json()['id']}/part-installations",
            headers=fleet_headers,
        )
        assert vehicle_history.status_code == 200
        assert vehicle_history.json()[0]["serial_number"] == "BAT-SERIAL-001"

        second_reservation = client.post(
            f"/api/v1/work-orders/{work_order.json()['id']}/reserve-part",
            headers=mechanic_headers,
            json={"part_id": part.json()["id"], "quantity": 1},
        )
        assert second_reservation.status_code == 200
        duplicate = client.post(
            f"/api/v1/work-orders/{work_order.json()['id']}/part-installations",
            headers=mechanic_headers,
            json={
                "work_order_part_usage_id": second_reservation.json()["usage_id"],
                "serial_number": "BAT-SERIAL-001",
            },
        )
        assert duplicate.status_code == 409

        removed = client.post(
            f"/api/v1/vehicle-part-installations/{installed.json()['id']}/remove",
            headers=fleet_headers,
            json={"removal_reason": "Battery replaced under warranty", "removed_odometer_km": 15000},
        )
        assert removed.status_code == 200, removed.text
        assert removed.json()["status"] == "removed"
