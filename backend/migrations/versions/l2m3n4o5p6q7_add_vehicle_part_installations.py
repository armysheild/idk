"""add vehicle part installation traceability"""

from alembic import op
import sqlalchemy as sa


revision = "l2m3n4o5p6q7"
down_revision = "k1l2m3n4o5p6"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("work_order_part_usage", recreate="always") as batch:
        batch.add_column(sa.Column("issued_quantity", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("issued_to_user_id", sa.Integer()))
        batch.add_column(sa.Column("issued_at", sa.DateTime(timezone=True)))
        batch.add_column(sa.Column("inventory_transaction_id", sa.Integer()))
        batch.create_index("ix_work_order_part_usage_inventory_transaction_id", ["inventory_transaction_id"])
        batch.create_foreign_key("fk_work_order_part_usage_issued_to_user", "users", ["issued_to_user_id"], ["id"])
        batch.create_foreign_key("fk_work_order_part_usage_inventory_transaction", "inventory_transactions", ["inventory_transaction_id"], ["id"])
    op.create_table(
        "vehicle_part_installations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("part_id", sa.Integer(), nullable=False),
        sa.Column("vehicle_id", sa.Integer(), nullable=False),
        sa.Column("work_order_id", sa.Integer(), nullable=False),
        sa.Column("work_order_part_usage_id", sa.Integer(), nullable=False),
        sa.Column("serial_number", sa.String(length=120)),
        sa.Column("lot_number", sa.String(length=120)),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("installed_by", sa.Integer(), nullable=False),
        sa.Column("installed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("installed_odometer_km", sa.Integer()),
        sa.Column("removed_by", sa.Integer()),
        sa.Column("removed_at", sa.DateTime(timezone=True)),
        sa.Column("removed_odometer_km", sa.Integer()),
        sa.Column("removal_reason", sa.Text()),
        sa.Column("inventory_transaction_id", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["part_id"], ["parts.id"]),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"]),
        sa.ForeignKeyConstraint(["work_order_id"], ["work_orders.id"]),
        sa.ForeignKeyConstraint(["work_order_part_usage_id"], ["work_order_part_usage.id"]),
        sa.ForeignKeyConstraint(["installed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["removed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["inventory_transaction_id"], ["inventory_transactions.id"]),
    )
    for column in (
        "organization_id",
        "part_id",
        "vehicle_id",
        "work_order_id",
        "work_order_part_usage_id",
        "serial_number",
        "lot_number",
        "inventory_transaction_id",
    ):
        op.create_index(
            f"ix_vehicle_part_installations_{column}",
            "vehicle_part_installations",
            [column],
        )
    op.create_index(
        "uq_vehicle_part_active_serial",
        "vehicle_part_installations",
        ["organization_id", "serial_number"],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND serial_number IS NOT NULL"),
        sqlite_where=sa.text("status = 'active' AND serial_number IS NOT NULL"),
    )


def downgrade():
    op.drop_index("uq_vehicle_part_active_serial", table_name="vehicle_part_installations")
    for column in (
        "inventory_transaction_id",
        "lot_number",
        "serial_number",
        "work_order_part_usage_id",
        "work_order_id",
        "vehicle_id",
        "part_id",
        "organization_id",
    ):
        op.drop_index(f"ix_vehicle_part_installations_{column}", table_name="vehicle_part_installations")
    op.drop_table("vehicle_part_installations")
    with op.batch_alter_table("work_order_part_usage", recreate="always") as batch:
        batch.drop_constraint("fk_work_order_part_usage_inventory_transaction", type_="foreignkey")
        batch.drop_constraint("fk_work_order_part_usage_issued_to_user", type_="foreignkey")
        batch.drop_index("ix_work_order_part_usage_inventory_transaction_id")
        batch.drop_column("inventory_transaction_id")
        batch.drop_column("issued_at")
        batch.drop_column("issued_to_user_id")
        batch.drop_column("issued_quantity")
