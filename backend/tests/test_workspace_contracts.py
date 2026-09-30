from datetime import datetime, timezone
from pathlib import Path

from backend.app.dependencies import normalize_role
from backend.app.routes import normalize_audit_role, presentation_role
from backend.app.schemas import InventoryMovementRead


def test_transfer_movement_response_accepts_zero_quantity():
    movement = InventoryMovementRead.model_validate({
        "id": 1,
        "organization_id": 7,
        "part_id": 4,
        "location_id": 3,
        "transaction_type": "transfer",
        "quantity": 0,
        "reference": "Move to BIN-A",
        "created_by": 9,
        "created_at": datetime.now(timezone.utc),
    })

    assert movement.transaction_type == "transfer"
    assert movement.quantity == 0


def test_audit_role_filter_normalizes_frontend_values():
    assert normalize_audit_role("SUPERADMIN") == "owner"
    assert normalize_audit_role("FLEET_MANAGER") == "fleet_manager"
    assert normalize_audit_role(" mechanic ") == "mechanic"


def test_legacy_owner_roles_normalize_for_api_and_frontend():
    assert normalize_role("SUPER_ADMIN") == "owner"
    assert normalize_role(" owner ") == "owner"
    assert presentation_role("SUPERADMIN") == "SUPERADMIN"
    assert presentation_role("fleet_manager") == "FLEET_MANAGER"


def test_public_rls_migration_uses_postgres_format_specifiers():
    migration = Path("backend/migrations/versions/x008_enable_public_rls.py").read_text()
    assert "%I" in migration
    assert "%%I" in migration
