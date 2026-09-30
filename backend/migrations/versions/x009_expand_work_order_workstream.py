"""expand work order workstream length

Revision ID: x009
Revises: x008
"""

from alembic import op
import sqlalchemy as sa


revision = "x009"
down_revision = "x008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.alter_column(
            "work_orders",
            "workstream",
            existing_type=sa.String(length=20),
            type_=sa.String(length=32),
            existing_nullable=False,
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.alter_column(
            "work_orders",
            "workstream",
            existing_type=sa.String(length=32),
            type_=sa.String(length=20),
            existing_nullable=False,
        )
