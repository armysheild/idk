from datetime import datetime, timezone
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app.schemas import DocumentRead


def test_document_read_includes_attached_vehicle_identity():
    document = SimpleNamespace(
        id=7,
        organization_id=3,
        vehicle_id=11,
        name="Insurance certificate",
        document_type="INSURANCE",
        issued_by="Insurer",
        expires_on="2027-01-15",
        file_key="documents/7.pdf",
        status="Valid",
        created_at=datetime.now(timezone.utc),
        vehicle=SimpleNamespace(
            id=11,
            registration_number="MH 12 AB 1001",
            vin="MA3EJKD1S00A10001",
        ),
    )

    result = DocumentRead.model_validate(document)

    assert result.vehicle is not None
    assert result.vehicle.registration_number == "MH 12 AB 1001"
    assert result.vehicle.vin == "MA3EJKD1S00A10001"
