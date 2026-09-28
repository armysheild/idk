"""add normalized business dates and composite query indexes

Revision ID: x007
Revises: x006
"""

from alembic import op
import sqlalchemy as sa


revision = "x007"
down_revision = "x006"
branch_labels = None
depends_on = None


def _add_column_if_missing(inspector, table, column, definition):
    if column not in {item["name"] for item in inspector.get_columns(table)}:
        op.add_column(table, sa.Column(column, definition, nullable=True))


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    bind = op.get_bind()
    for table, column in (
        ("organizations", "trial_ends_at"),
        ("organizations", "subscription_renews_at"),
        ("vehicle_components", "installation_at"),
        ("work_orders", "due_at"),
        ("maintenance_plans", "next_due_at"),
        ("document_versions", "expires_at"),
        ("purchase_orders", "expected_at"),
        ("billing_invoices", "period_start_at"),
        ("billing_invoices", "period_end_at"),
    ):
        _add_column_if_missing(inspector, table, column, sa.DateTime(timezone=True))
    for table, old_column, new_column in (
        ("organizations", "trial_ends_on", "trial_ends_at"),
        ("organizations", "subscription_renews_on", "subscription_renews_at"),
        ("vehicle_components", "installation_date", "installation_at"),
        ("work_orders", "due_date", "due_at"),
        ("maintenance_plans", "next_due_on", "next_due_at"),
        ("document_versions", "expires_on", "expires_at"),
        ("purchase_orders", "expected_on", "expected_at"),
        ("billing_invoices", "period_start", "period_start_at"),
        ("billing_invoices", "period_end", "period_end_at"),
    ):
        if bind.dialect.name == "postgresql":
            bind.execute(sa.text(
                f"UPDATE {table} SET {new_column} = NULLIF({old_column}, '')::timestamptz "
                f"WHERE {new_column} IS NULL AND {old_column} IS NOT NULL"
            ))
        else:
            bind.execute(sa.text(
                f"UPDATE {table} SET {new_column} = {old_column} "
                f"WHERE {new_column} IS NULL AND {old_column} IS NOT NULL"
            ))

    existing = {index["name"] for index in inspector.get_indexes("work_orders")}
    if "ix_work_orders_org_status_created" not in existing:
        op.create_index("ix_work_orders_org_status_created", "work_orders", ["organization_id", "status", "created_at"])
    existing = {index["name"] for index in inspector.get_indexes("operational_notifications")}
    if "ix_notifications_org_status_created" not in existing:
        op.create_index("ix_notifications_org_status_created", "operational_notifications", ["organization_id", "status", "created_at"])
    existing = {index["name"] for index in inspector.get_indexes("audit_logs")}
    if "ix_audit_logs_org_created" not in existing:
        op.create_index("ix_audit_logs_org_created", "audit_logs", ["organization_id", "created_at"])
    existing = {index["name"] for index in inspector.get_indexes("odometer_logs")}
    if "ix_odometer_logs_vehicle_created" not in existing:
        op.create_index("ix_odometer_logs_vehicle_created", "odometer_logs", ["vehicle_id", "created_at"])
    existing = {index["name"] for index in inspector.get_indexes("inventory_transactions")}
    if "ix_inventory_transactions_org_created" not in existing:
        op.create_index("ix_inventory_transactions_org_created", "inventory_transactions", ["organization_id", "created_at"])


def downgrade() -> None:
    for name, table in (
        ("ix_inventory_transactions_org_created", "inventory_transactions"),
        ("ix_odometer_logs_vehicle_created", "odometer_logs"),
        ("ix_audit_logs_org_created", "audit_logs"),
        ("ix_notifications_org_status_created", "operational_notifications"),
        ("ix_work_orders_org_status_created", "work_orders"),
    ):
        op.drop_index(name, table_name=table)
    for table, column in (
        ("billing_invoices", "period_end_at"),
        ("billing_invoices", "period_start_at"),
        ("purchase_orders", "expected_at"),
        ("document_versions", "expires_at"),
        ("maintenance_plans", "next_due_at"),
        ("work_orders", "due_at"),
        ("vehicle_components", "installation_at"),
        ("organizations", "subscription_renews_at"),
        ("organizations", "trial_ends_at"),
    ):
        op.drop_column(table, column)
