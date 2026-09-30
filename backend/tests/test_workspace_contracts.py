from datetime import datetime, timezone

from backend.app.routes import normalize_audit_role
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
