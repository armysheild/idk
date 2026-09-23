import os
from pathlib import Path
import sys

os.environ["VAHANA_DATABASE_URL"] = "sqlite:///./test-hardening.db"
os.environ["VAHANA_SEED_ADMIN_EMAIL"] = "hardening-seed@example.com"
os.environ["VAHANA_SEED_ADMIN_PASSWORD"] = "SeedPassword!123"
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi.testclient import TestClient

from backend.app.database import Base, engine
from backend.app.main import app


def test_inventory_manager_can_update_and_archive_only_their_tenant_vendor(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as client:
        signup = client.post("/api/v1/auth/signup", json={
            "organization_name": "Vendor Boundary Fleet",
            "full_name": "Owner",
            "email": "owner@vendor-boundary.example",
            "password": "OwnerPassword!123",
        })
        assert signup.status_code == 201
        owner_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
        invitation = client.post("/api/v1/invitations", headers=owner_headers, json={
            "email": "inventory@vendor-boundary.example",
            "full_name": "Inventory Manager",
            "role": "inventory_manager",
        })
        assert invitation.status_code == 201
        accepted = client.post("/api/v1/auth/invitations/accept", json={
            "token": invitation.json()["invite_token"],
            "password": "InventoryPassword!123",
        })
        assert accepted.status_code == 200
        inventory_headers = {"Authorization": f"Bearer {accepted.json()['access_token']}"}

        created = client.post("/api/v1/vendors", headers=inventory_headers, json={
            "name": "North Parts",
            "vendor_type": "Parts supplier",
        })
        assert created.status_code == 201
        vendor_id = created.json()["id"]
        updated = client.patch(f"/api/v1/vendors/{vendor_id}", headers=inventory_headers, json={
            "name": "North Parts Updated",
        })
        assert updated.status_code == 200
        assert updated.json()["name"] == "North Parts Updated"
        archived = client.patch(f"/api/v1/vendors/{vendor_id}", headers=inventory_headers, json={
            "active": False,
        })
        assert archived.status_code == 200
        assert archived.json()["active"] is False
        denied = client.patch(f"/api/v1/vendors/{vendor_id}", headers=owner_headers, json={
            "name": "Owner must not edit procurement records",
        })
        assert denied.status_code == 403
