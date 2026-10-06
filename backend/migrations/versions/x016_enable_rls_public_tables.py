"""enable row-level security on all public tables

Supabase exposes every table in the public schema through PostgREST with
the publishable anon key, so any table without RLS is world-readable and
world-writable. All data access in VahanSync goes through the backend API,
which connects as the database owner (bypasses RLS), so enabling RLS
without policies closes the hole without changing application behavior.

Revision ID: x016
Revises: x015
Create Date: 2026-10-07 08:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'x016'
down_revision: Union[str, None] = 'x015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EXCLUDED = {"alembic_version"}


def _public_tables() -> list[str]:
    bind = op.get_bind()
    rows = bind.exec_driver_sql(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    ).fetchall()
    return [row[0] for row in rows if row[0] not in _EXCLUDED]


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in _public_tables():
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # x010 already protects org-scoped tables with tenant_isolation_* policies;
    # only release RLS on tables that had no protection before this revision.
    protected = {
        row[0]
        for row in bind.exec_driver_sql(
            "SELECT tablename FROM pg_policies WHERE schemaname = 'public'"
        ).fetchall()
    }
    for table in _public_tables():
        if table not in protected:
            op.execute(f'ALTER TABLE public."{table}" DISABLE ROW LEVEL SECURITY')
