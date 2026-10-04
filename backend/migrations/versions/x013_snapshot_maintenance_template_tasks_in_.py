"""snapshot maintenance template tasks in plans

Revision ID: x013
Revises: x012
Create Date: 2026-10-02 21:09:47.345050

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'x013'
down_revision: Union[str, None] = 'x012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("maintenance_plans") as batch:
        batch.add_column(sa.Column("template_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("tasks", sa.Text(), nullable=False, server_default="[]"))
        batch.create_foreign_key("fk_maintenance_plan_template", "maintenance_templates", ["template_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("maintenance_plans") as batch:
        batch.drop_constraint("fk_maintenance_plan_template", type_="foreignkey")
        batch.drop_column("tasks")
        batch.drop_column("template_id")
