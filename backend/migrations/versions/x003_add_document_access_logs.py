"""add document access audit logs

Revision ID: x003
Revises: x002
"""

from alembic import op
import sqlalchemy as sa


revision = "x003"
down_revision = "n4o5p6q7r8s9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "document_access_logs" not in inspector.get_table_names():
        op.create_table(
            "document_access_logs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("organization_id", sa.Integer(), nullable=False),
            sa.Column("document_id", sa.Integer(), nullable=False),
            sa.Column("asset_id", sa.Integer(), nullable=True),
            sa.Column("actor_user_id", sa.Integer(), nullable=False),
            sa.Column("access_type", sa.String(length=32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
            sa.ForeignKeyConstraint(["document_id"], ["compliance_documents.id"]),
            sa.ForeignKeyConstraint(["asset_id"], ["document_assets.id"]),
            sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    existing_indexes = {index["name"] for index in inspector.get_indexes("document_access_logs")}
    for index_name, column_name in (
        ("ix_document_access_logs_organization_id", "organization_id"),
        ("ix_document_access_logs_document_id", "document_id"),
        ("ix_document_access_logs_asset_id", "asset_id"),
        ("ix_document_access_logs_actor_user_id", "actor_user_id"),
    ):
        if index_name not in existing_indexes:
            op.create_index(index_name, "document_access_logs", [column_name])


def downgrade() -> None:
    op.drop_index("ix_document_access_logs_actor_user_id", table_name="document_access_logs")
    op.drop_index("ix_document_access_logs_asset_id", table_name="document_access_logs")
    op.drop_index("ix_document_access_logs_document_id", table_name="document_access_logs")
    op.drop_index("ix_document_access_logs_organization_id", table_name="document_access_logs")
    op.drop_table("document_access_logs")
