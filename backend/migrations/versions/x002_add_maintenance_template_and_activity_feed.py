"""add_maintenance_template_and_activity_feed_tables

Revision ID: x002
Revises: x001
Create Date: 2026-09-18

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'x002'
down_revision = 'x001'
branch_labels = None
depends_on = None


def upgrade():
    # Create maintenance_templates table
    op.create_table(
        'maintenance_templates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('vehicle_type', sa.String(length=80), nullable=True),
        sa.Column('interval_km', sa.Integer(), nullable=True),
        sa.Column('interval_days', sa.Integer(), nullable=True),
        sa.Column('tasks', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_maintenance_templates_organization_id'), 'maintenance_templates', ['organization_id'], unique=False)
    op.create_index(op.f('ix_maintenance_templates_vehicle_type'), 'maintenance_templates', ['vehicle_type'], unique=False)

    # Create activity_feed_entries table
    op.create_table(
        'activity_feed_entries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('actor_user_id', sa.Integer(), nullable=False),
        sa.Column('activity_type', sa.String(length=40), nullable=False),
        sa.Column('entity_type', sa.String(length=80), nullable=False),
        sa.Column('entity_id', sa.String(length=80), nullable=False),
        sa.Column('title', sa.String(length=240), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('metadata', sa.Text(), nullable=True),
        sa.Column('actor_full_name', sa.String(length=160), nullable=True),
        sa.Column('actor_role', sa.String(length=48), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
        sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_activity_feed_entries_organization_id'), 'activity_feed_entries', ['organization_id'], unique=False)
    op.create_index(op.f('ix_activity_feed_entries_actor_user_id'), 'activity_feed_entries', ['actor_user_id'], unique=False)
    op.create_index(op.f('ix_activity_feed_entries_created_at'), 'activity_feed_entries', ['created_at'], unique=False)
    op.create_index(op.f('ix_activity_feed_entries_activity_type'), 'activity_feed_entries', ['activity_type'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_activity_feed_entries_activity_type'), table_name='activity_feed_entries')
    op.drop_index(op.f('ix_activity_feed_entries_created_at'), table_name='activity_feed_entries')
    op.drop_index(op.f('ix_activity_feed_entries_actor_user_id'), table_name='activity_feed_entries')
    op.drop_index(op.f('ix_activity_feed_entries_organization_id'), table_name='activity_feed_entries')
    op.drop_table('activity_feed_entries')

    op.drop_index(op.f('ix_maintenance_templates_vehicle_type'), table_name='maintenance_templates')
    op.drop_index(op.f('ix_maintenance_templates_organization_id'), table_name='maintenance_templates')
    op.drop_table('maintenance_templates')
