"""inventory receipt details: received_on, bill_number, vendor_name, unit_cost, reason

Revision ID: x015
Revises: x014
Create Date: 2026-10-06 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'x015'
down_revision: Union[str, None] = 'x014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("inventory_transactions") as batch:
        batch.add_column(sa.Column("received_on", sa.Date(), nullable=True))
        batch.add_column(sa.Column("bill_number", sa.String(80), nullable=True))
        batch.add_column(sa.Column("vendor_name", sa.String(160), nullable=True))
        batch.add_column(sa.Column("unit_cost_paise", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("reason", sa.String(300), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("inventory_transactions") as batch:
        batch.drop_column("received_on")
        batch.drop_column("bill_number")
        batch.drop_column("vendor_name")
        batch.drop_column("unit_cost_paise")
        batch.drop_column("reason")
