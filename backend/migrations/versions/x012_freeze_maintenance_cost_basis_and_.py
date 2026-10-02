"""freeze maintenance cost basis and retain reconciliation evidence

Revision ID: x012
Revises: x011
Create Date: 2026-10-02 20:53:14.033950

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'x012'
down_revision: Union[str, None] = 'x011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("work_orders", sa.Column("labor_rate_paise", sa.Integer(), nullable=True))
    op.add_column("expenses", sa.Column("reconciled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("expenses", sa.Column("reconciliation_ref", sa.String(160), nullable=True))
    bind = op.get_bind()
    metadata = sa.MetaData()
    organizations = sa.Table("organizations", metadata, sa.Column("id", sa.Integer), sa.Column("labor_rate_per_hour", sa.Integer))
    work_orders = sa.Table(
        "work_orders", metadata,
        sa.Column("organization_id", sa.Integer),
        sa.Column("status", sa.String),
        sa.Column("started_at", sa.DateTime),
        sa.Column("labor_rate_paise", sa.Integer),
    )
    rate = sa.select(organizations.c.labor_rate_per_hour * 100).where(
        organizations.c.id == work_orders.c.organization_id
    ).scalar_subquery()
    bind.execute(
        work_orders.update()
        .where(sa.or_(
            work_orders.c.started_at.is_not(None),
            work_orders.c.status.in_(("Ready for review", "Completed", "Closed")),
        ))
        .values(labor_rate_paise=sa.func.coalesce(rate, 0))
    )


def downgrade() -> None:
    op.drop_column("expenses", "reconciliation_ref")
    op.drop_column("expenses", "reconciled_at")
    op.drop_column("work_orders", "labor_rate_paise")
