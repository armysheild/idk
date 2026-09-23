"""add organisation roles subscriptions and notification preferences

Revision ID: 6b8a1e2c4d5f
Revises: 3a4f736ac02a
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "6b8a1e2c4d5f"
down_revision: Union[str, None] = "3a4f736ac02a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("subscription_plan", sa.String(length=32), server_default="starter", nullable=False))
    op.add_column("organizations", sa.Column("subscription_status", sa.String(length=24), server_default="trialing", nullable=False))
    op.add_column("organizations", sa.Column("trial_ends_on", sa.String(length=20), nullable=True))
    op.add_column("organizations", sa.Column("subscription_renews_on", sa.String(length=20), nullable=True))
    op.create_table(
        "notification_preferences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("notification_type", sa.String(length=80), nullable=False),
        sa.Column("in_app", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("email", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("sms", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("whatsapp", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("push", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notification_preferences_organization_id", "notification_preferences", ["organization_id"])
    op.create_index("ix_notification_preferences_user_id", "notification_preferences", ["user_id"])
    op.create_table(
        "notification_deliveries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("notification_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("channel", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), server_default="queued", nullable=False),
        sa.Column("provider_message_id", sa.String(length=160), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["notification_id"], ["operational_notifications.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notification_deliveries_organization_id", "notification_deliveries", ["organization_id"])
    op.create_index("ix_notification_deliveries_notification_id", "notification_deliveries", ["notification_id"])
    op.create_index("ix_notification_deliveries_user_id", "notification_deliveries", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_notification_deliveries_user_id", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_notification_id", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_organization_id", table_name="notification_deliveries")
    op.drop_table("notification_deliveries")
    op.drop_index("ix_notification_preferences_user_id", table_name="notification_preferences")
    op.drop_index("ix_notification_preferences_organization_id", table_name="notification_preferences")
    op.drop_table("notification_preferences")
    op.drop_column("organizations", "subscription_renews_on")
    op.drop_column("organizations", "trial_ends_on")
    op.drop_column("organizations", "subscription_status")
    op.drop_column("organizations", "subscription_plan")
