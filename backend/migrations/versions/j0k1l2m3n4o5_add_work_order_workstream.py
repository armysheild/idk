"""add work order workstream"""

from alembic import op
import sqlalchemy as sa


revision = "j0k1l2m3n4o5"
down_revision = "i9j0k1l2m3n4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("work_orders", sa.Column("workstream", sa.String(length=20), nullable=False, server_default="shared"))


def downgrade():
    op.drop_column("work_orders", "workstream")
