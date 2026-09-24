"""align production schema with ORM metadata

Revision ID: g7b9c1d3e5f7
Revises: f4a6b8c0d2e1
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "g7b9c1d3e5f7"
down_revision: Union[str, None] = "f4a6b8c0d2e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    is_postgresql = op.get_bind().dialect.name == "postgresql"
    op.create_index(
        "ix_billing_invoices_organization_id",
        "billing_invoices",
        ["organization_id"],
    )
    op.create_index(
        "ix_billing_payments_invoice_id",
        "billing_payments",
        ["invoice_id"],
    )
    op.create_index(
        "ix_billing_payments_organization_id",
        "billing_payments",
        ["organization_id"],
    )
    op.create_index("ix_odometer_logs_driver_id", "odometer_logs", ["driver_id"])
    if is_postgresql:
        op.create_foreign_key(
            "fk_operational_notifications_recipient_user_id",
            "operational_notifications",
            "users",
            ["recipient_user_id"],
            ["id"],
        )
        op.alter_column(
            "users",
            "role",
            existing_type=sa.String(length=32),
            type_=sa.String(length=48),
            existing_nullable=False,
        )
    else:
        with op.batch_alter_table("operational_notifications", recreate="always") as batch:
            batch.create_foreign_key(
                "fk_operational_notifications_recipient_user_id",
                "users",
                ["recipient_user_id"],
                ["id"],
            )
        with op.batch_alter_table("users", recreate="always") as batch:
            batch.alter_column(
                "role",
                existing_type=sa.String(length=32),
                type_=sa.String(length=48),
                existing_nullable=False,
            )
    op.drop_index("ix_vehicles_registration_number", table_name="vehicles")
    op.create_index(
        "ix_vehicles_registration_number",
        "vehicles",
        ["registration_number"],
        unique=True,
    )


def downgrade() -> None:
    is_postgresql = op.get_bind().dialect.name == "postgresql"
    op.drop_index("ix_vehicles_registration_number", table_name="vehicles")
    op.create_index(
        "ix_vehicles_registration_number",
        "vehicles",
        ["registration_number"],
        unique=False,
    )
    if is_postgresql:
        op.alter_column(
            "users",
            "role",
            existing_type=sa.String(length=48),
            type_=sa.String(length=32),
            existing_nullable=False,
        )
        op.drop_constraint(
            "fk_operational_notifications_recipient_user_id",
            "operational_notifications",
            type_="foreignkey",
        )
    else:
        with op.batch_alter_table("users", recreate="always") as batch:
            batch.alter_column(
                "role",
                existing_type=sa.String(length=48),
                type_=sa.String(length=32),
                existing_nullable=False,
            )
        with op.batch_alter_table("operational_notifications", recreate="always") as batch:
            batch.drop_constraint(
                "fk_operational_notifications_recipient_user_id",
                type_="foreignkey",
            )
    op.drop_index("ix_odometer_logs_driver_id", table_name="odometer_logs")
    op.drop_index("ix_billing_payments_organization_id", table_name="billing_payments")
    op.drop_index("ix_billing_payments_invoice_id", table_name="billing_payments")
    op.drop_index("ix_billing_invoices_organization_id", table_name="billing_invoices")
