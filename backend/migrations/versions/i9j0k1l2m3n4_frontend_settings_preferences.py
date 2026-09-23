"""persist FleetOps organization settings and user alert preferences

Revision ID: i9j0k1l2m3n4
Revises: h8c0d2e4f6a1
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "i9j0k1l2m3n4"
down_revision: Union[str, None] = "h8c0d2e4f6a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Asia/Kolkata"),
    )
    op.add_column(
        "organizations",
        sa.Column("odometer_max_daily_km", sa.Integer(), nullable=False, server_default="1000"),
    )
    op.add_column(
        "organizations",
        sa.Column("labor_rate_per_hour", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("organizations", sa.Column("safety_contact_name", sa.String(length=160), nullable=True))
    op.add_column("organizations", sa.Column("safety_contact_phone", sa.String(length=32), nullable=True))
    op.add_column(
        "users",
        sa.Column("sms_alerts_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("whatsapp_alerts_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "whatsapp_alerts_enabled")
    op.drop_column("users", "sms_alerts_enabled")
    op.drop_column("organizations", "safety_contact_phone")
    op.drop_column("organizations", "safety_contact_name")
    op.drop_column("organizations", "labor_rate_per_hour")
    op.drop_column("organizations", "odometer_max_daily_km")
    op.drop_column("organizations", "timezone")
