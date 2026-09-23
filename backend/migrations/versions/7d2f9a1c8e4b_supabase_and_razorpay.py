"""add Supabase identity and Razorpay subscription references

Revision ID: 7d2f9a1c8e4b
Revises: 6b8a1e2c4d5f
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7d2f9a1c8e4b"
down_revision: Union[str, None] = "6b8a1e2c4d5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("supabase_user_id", sa.String(length=80), nullable=True))
    op.create_index("ix_users_supabase_user_id", "users", ["supabase_user_id"], unique=True)
    op.add_column("organizations", sa.Column("razorpay_subscription_id", sa.String(length=120), nullable=True))
    op.add_column("organizations", sa.Column("razorpay_last_order_id", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "razorpay_last_order_id")
    op.drop_column("organizations", "razorpay_subscription_id")
    op.drop_index("ix_users_supabase_user_id", table_name="users")
    op.drop_column("users", "supabase_user_id")
