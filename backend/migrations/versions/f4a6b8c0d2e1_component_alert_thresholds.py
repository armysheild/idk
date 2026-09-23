"""add component alert thresholds

Revision ID: f4a6b8c0d2e1
Revises: c9d0e1f2a3b4, x002
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4a6b8c0d2e1"
down_revision: Union[str, tuple[str, ...], None] = ("c9d0e1f2a3b4", "x002")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("vehicle_components", recreate="always") as batch:
        batch.add_column(sa.Column("alert_threshold_km", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("next_alert_km", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("vehicle_components", recreate="always") as batch:
        batch.drop_column("next_alert_km")
        batch.drop_column("alert_threshold_km")
