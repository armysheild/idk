"""add queryable component service records

Revision ID: x005
Revises: x004
"""

from alembic import op
import sqlalchemy as sa


revision = "x005"
down_revision = "x004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "component_service_records" in inspector.get_table_names():
        return
    op.create_table(
        "component_service_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("component_id", sa.Integer(), nullable=False),
        sa.Column("vehicle_id", sa.Integer(), nullable=False),
        sa.Column("odometer_km", sa.Integer(), nullable=False),
        sa.Column("service_type", sa.String(length=40), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("performed_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["component_id"], ["vehicle_components.id"]),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"]),
        sa.ForeignKeyConstraint(["performed_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, column in (
        ("ix_component_service_records_organization_id", "organization_id"),
        ("ix_component_service_records_component_id", "component_id"),
        ("ix_component_service_records_vehicle_id", "vehicle_id"),
        ("ix_component_service_records_performed_by", "performed_by"),
        ("ix_component_service_records_created_at", "created_at"),
    ):
        op.create_index(name, "component_service_records", [column])


def downgrade() -> None:
    op.drop_table("component_service_records")
