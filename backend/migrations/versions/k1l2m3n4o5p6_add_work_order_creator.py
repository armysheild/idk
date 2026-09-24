"""add work order creator"""

from alembic import op
import sqlalchemy as sa


revision = "k1l2m3n4o5p6"
down_revision = "j0k1l2m3n4o5"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.add_column("work_orders", sa.Column("created_by", sa.Integer(), nullable=True))
        op.create_index(op.f("ix_work_orders_created_by"), "work_orders", ["created_by"], unique=False)
        op.create_foreign_key(
            "fk_work_orders_created_by_users",
            "work_orders",
            "users",
            ["created_by"],
            ["id"],
        )
    else:
        with op.batch_alter_table("work_orders", recreate="always") as batch:
            batch.add_column(sa.Column("created_by", sa.Integer(), nullable=True))
            batch.create_index(op.f("ix_work_orders_created_by"), ["created_by"], unique=False)
            batch.create_foreign_key("fk_work_orders_created_by_users", "users", ["created_by"], ["id"])


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint("fk_work_orders_created_by_users", "work_orders", type_="foreignkey")
        op.drop_index(op.f("ix_work_orders_created_by"), table_name="work_orders")
        op.drop_column("work_orders", "created_by")
    else:
        with op.batch_alter_table("work_orders", recreate="always") as batch:
            batch.drop_constraint("fk_work_orders_created_by_users", type_="foreignkey")
            batch.drop_index(op.f("ix_work_orders_created_by"))
            batch.drop_column("created_by")
