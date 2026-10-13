"""flat-rate billing: organizations.vehicle_cap and organizations.billing_peak_vehicles

Revision ID: x018
Revises: x017
Create Date: 2026-10-13 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'x018'
down_revision: Union[str, None] = 'x017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("organizations") as batch:
        batch.add_column(sa.Column("vehicle_cap", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("billing_peak_vehicles", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("billing_invoices") as batch:
        batch.add_column(sa.Column("billable_vehicles", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("organizations") as batch:
        batch.drop_column("billing_peak_vehicles")
        batch.drop_column("vehicle_cap")
    with op.batch_alter_table("billing_invoices") as batch:
        batch.drop_column("billable_vehicles")
