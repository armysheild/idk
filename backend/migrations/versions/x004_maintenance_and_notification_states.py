"""add maintenance work-order links and notification escalation state

Revision ID: x004
Revises: x003
"""

from alembic import op
import sqlalchemy as sa


revision = "x004"
down_revision = "x003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    work_order_columns = {column["name"] for column in inspector.get_columns("work_orders")}
    if "maintenance_plan_id" not in work_order_columns:
        op.add_column("work_orders", sa.Column("maintenance_plan_id", sa.Integer(), nullable=True))
        if op.get_bind().dialect.name != "sqlite":
            op.create_foreign_key(
                "fk_work_orders_maintenance_plan_id",
                "work_orders",
                "maintenance_plans",
                ["maintenance_plan_id"],
                ["id"],
            )
        op.create_index("ix_work_orders_maintenance_plan_id", "work_orders", ["maintenance_plan_id"])
    notification_columns = {column["name"] for column in inspector.get_columns("operational_notifications")}
    if "escalation_level" not in notification_columns:
        op.add_column(
            "operational_notifications",
            sa.Column("escalation_level", sa.Integer(), nullable=False, server_default="0"),
        )
    if "escalated_at" not in notification_columns:
        op.add_column(
            "operational_notifications",
            sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("operational_notifications", "escalated_at")
    op.drop_column("operational_notifications", "escalation_level")
    op.drop_index("ix_work_orders_maintenance_plan_id", table_name="work_orders")
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint("fk_work_orders_maintenance_plan_id", "work_orders", type_="foreignkey")
    op.drop_column("work_orders", "maintenance_plan_id")
