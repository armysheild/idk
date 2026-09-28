"""add organization feature flags

Revision ID: x006
Revises: x005
"""

from alembic import op
import sqlalchemy as sa


revision = "x006"
down_revision = "x005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "organization_feature_flags" in inspector.get_table_names():
        return
    op.create_table(
        "organization_feature_flags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("feature_key", sa.String(length=80), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "feature_key", name="uq_org_feature_flag"),
    )
    op.create_index("ix_organization_feature_flags_organization_id", "organization_feature_flags", ["organization_id"])


def downgrade() -> None:
    op.drop_table("organization_feature_flags")
