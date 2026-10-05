"""session revocation, vehicle template fk, org-scoped uniques

Revision ID: x014
Revises: x013
Create Date: 2026-10-04 08:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'x014'
down_revision: Union[str, None] = 'x013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("session_revoked_at", sa.DateTime(timezone=True), nullable=True))

    op.execute("ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_registration_number_key")
    op.execute("DROP INDEX IF EXISTS ix_vehicles_registration_number")
    with op.batch_alter_table("vehicles") as batch:
        batch.create_unique_constraint("uq_vehicles_org_registration", ["organization_id", "registration_number"])
        batch.create_index("ix_vehicles_registration_number", ["registration_number"])
        batch.add_column(sa.Column("maintenance_template_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_vehicles_maintenance_template", "maintenance_templates", ["maintenance_template_id"], ["id"])

    connection = op.get_bind()
    connection.execute(sa.text(
        "UPDATE vehicles SET maintenance_template_id = ("
        "SELECT id FROM maintenance_templates"
        " WHERE maintenance_templates.organization_id = vehicles.organization_id"
        " AND lower(maintenance_templates.name) = lower(vehicles.maintenance_template)"
        " LIMIT 1) WHERE maintenance_template IS NOT NULL"
    ))

    with op.batch_alter_table("parts") as batch:
        batch.create_unique_constraint("uq_parts_org_sku", ["organization_id", "sku"])


def downgrade() -> None:
    with op.batch_alter_table("parts") as batch:
        batch.drop_constraint("uq_parts_org_sku", type_="unique")
    with op.batch_alter_table("vehicles") as batch:
        batch.drop_constraint("fk_vehicles_maintenance_template", type_="foreignkey")
        batch.drop_column("maintenance_template_id")
        batch.drop_constraint("uq_vehicles_org_registration", type_="unique")
        batch.drop_index("ix_vehicles_registration_number")
        batch.create_index("ix_vehicles_registration_number", ["registration_number"], unique=True)
    with op.batch_alter_table("users") as batch:
        batch.drop_column("session_revoked_at")
