"""complete vehicle, component, driver, and integration form contracts

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
"""

from alembic import op
import sqlalchemy as sa


revision = "n4o5p6q7r8s9"
down_revision = "m3n4o5p6q7r8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organization_integrations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("endpoint", sa.String(length=500), nullable=True),
        sa.Column("account_identifier", sa.String(length=160), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="not_configured"),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "provider", name="uq_organization_integrations_provider"),
    )
    op.create_index("ix_organization_integrations_organization_id", "organization_integrations", ["organization_id"], unique=False)

    vehicle_columns = (
        sa.Column("vin", sa.String(length=32), nullable=True),
        sa.Column("chassis_number", sa.String(length=120), nullable=True),
        sa.Column("engine_number", sa.String(length=120), nullable=True),
        sa.Column("make", sa.String(length=80), nullable=True),
        sa.Column("model_year", sa.Integer(), nullable=True),
        sa.Column("assigned_route", sa.String(length=160), nullable=True),
        sa.Column("maintenance_template", sa.String(length=80), nullable=True),
    )
    component_columns = (
        sa.Column("component_subtype", sa.String(length=120), nullable=True),
        sa.Column("inventory_part_id", sa.Integer(), nullable=True),
        sa.Column("brand", sa.String(length=120), nullable=True),
        sa.Column("part_number", sa.String(length=120), nullable=True),
        sa.Column("installation_date", sa.String(length=20), nullable=True),
        sa.Column("expected_life_days", sa.Integer(), nullable=True),
        sa.Column("alert_threshold_days", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("vehicles", recreate="always") as batch:
            for column in vehicle_columns:
                batch.add_column(column)
            batch.create_index("ix_vehicles_vin", ["vin"], unique=False)
        with op.batch_alter_table("vehicle_components", recreate="always") as batch:
            for column in component_columns:
                batch.add_column(column)
            batch.create_foreign_key("fk_vehicle_components_inventory_part", "parts", ["inventory_part_id"], ["id"])
            batch.create_index("ix_vehicle_components_inventory_part_id", ["inventory_part_id"], unique=False)
    else:
        for column in vehicle_columns:
            op.add_column("vehicles", column)
        op.create_index("ix_vehicles_vin", "vehicles", ["vin"], unique=False)
        for column in component_columns:
            op.add_column("vehicle_components", column)
        op.create_foreign_key("fk_vehicle_components_inventory_part", "vehicle_components", "parts", ["inventory_part_id"], ["id"])
        op.create_index("ix_vehicle_components_inventory_part_id", "vehicle_components", ["inventory_part_id"], unique=False)

    op.add_column("driver_inspections", sa.Column("photo_data", sa.Text(), nullable=True))
    op.add_column("vehicle_issues", sa.Column("photo_data", sa.Text(), nullable=True))
    op.add_column("vehicle_issues", sa.Column("photo_content_type", sa.String(length=120), nullable=True))
    op.add_column("fuel_transactions", sa.Column("receipt_data", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("fuel_transactions", "receipt_data")
    op.drop_column("vehicle_issues", "photo_content_type")
    op.drop_column("vehicle_issues", "photo_data")
    op.drop_column("driver_inspections", "photo_data")
    op.drop_index("ix_vehicle_components_inventory_part_id", table_name="vehicle_components")
    op.drop_constraint("fk_vehicle_components_inventory_part", "vehicle_components", type_="foreignkey")
    for column in (
        "notes",
        "alert_threshold_days",
        "expected_life_days",
        "installation_date",
        "part_number",
        "brand",
        "inventory_part_id",
        "component_subtype",
    ):
        op.drop_column("vehicle_components", column)
    op.drop_index("ix_vehicles_vin", table_name="vehicles")
    for column in (
        "maintenance_template",
        "assigned_route",
        "model_year",
        "make",
        "engine_number",
        "chassis_number",
        "vin",
    ):
        op.drop_column("vehicles", column)
    op.drop_index("ix_organization_integrations_organization_id", table_name="organization_integrations")
    op.drop_table("organization_integrations")
