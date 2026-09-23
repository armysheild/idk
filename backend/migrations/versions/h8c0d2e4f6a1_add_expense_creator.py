"""add expense creator

Revision ID: h8c0d2e4f6a1
Revises: g7b9c1d3e5f7
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "h8c0d2e4f6a1"
down_revision: Union[str, None] = "g7b9c1d3e5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("expenses", sa.Column("created_by", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_expenses_created_by_users",
        "expenses",
        "users",
        ["created_by"],
        ["id"],
    )
    op.create_index("ix_expenses_created_by", "expenses", ["created_by"])


def downgrade() -> None:
    op.drop_index("ix_expenses_created_by", table_name="expenses")
    op.drop_constraint("fk_expenses_created_by_users", "expenses", type_="foreignkey")
    op.drop_column("expenses", "created_by")
