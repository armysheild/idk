"""worker specialties: users.specialty and organization_invitations.specialty

Revision ID: x017
Revises: x016
Create Date: 2026-10-04 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'x017'
down_revision: Union[str, None] = 'x016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("specialty", sa.String(48), nullable=True))
    with op.batch_alter_table("organization_invitations") as batch:
        batch.add_column(sa.Column("specialty", sa.String(48), nullable=True))
    # Existing mechanics/technicians default to the lead trade.
    op.execute("UPDATE users SET specialty = 'lead' WHERE role IN ('mechanic', 'technician')")


def downgrade() -> None:
    with op.batch_alter_table("organization_invitations") as batch:
        batch.drop_column("specialty")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("specialty")
