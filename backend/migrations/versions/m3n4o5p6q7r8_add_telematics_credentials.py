"""Store organization telematics credentials encrypted at rest."""

from alembic import op
import sqlalchemy as sa

revision = "m3n4o5p6q7r8"
down_revision = "l2m3n4o5p6q7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("telematics_integrations", sa.Column("credential_ciphertext", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("telematics_integrations", "credential_ciphertext")
