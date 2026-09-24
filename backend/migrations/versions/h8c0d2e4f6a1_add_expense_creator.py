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
    with op.batch_alter_table("expenses", recreate="always") as batch:
        batch.add_column(sa.Column("created_by", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_expenses_created_by_users", "users", ["created_by"], ["id"])
        batch.create_index("ix_expenses_created_by", ["created_by"])


def downgrade() -> None:
    with op.batch_alter_table("expenses", recreate="always") as batch:
        batch.drop_index("ix_expenses_created_by")
        batch.drop_constraint("fk_expenses_created_by_users", type_="foreignkey")
        batch.drop_column("created_by")
