"""enable row-level security for public application tables

Revision ID: x008
Revises: x007
"""

from alembic import op


revision = "x008"
down_revision = "x007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    bind.exec_driver_sql(
        """
        DO $$
        DECLARE
            tenant_table record;
            policy_name text;
        BEGIN
            FOR tenant_table IN
                SELECT DISTINCT table_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND column_name = 'organization_id'
            LOOP
                policy_name := 'tenant_isolation_' || tenant_table.table_name;
                EXECUTE format(
                    'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
                    tenant_table.table_name
                );
                EXECUTE format(
                    'DROP POLICY IF EXISTS %I ON public.%I',
                    policy_name,
                    tenant_table.table_name
                );
                EXECUTE format(
                    'CREATE POLICY %I ON public.%I FOR ALL TO public USING (organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::integer) WITH CHECK (organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::integer)',
                    policy_name,
                    tenant_table.table_name
                );
            END LOOP;

            ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
            DROP POLICY IF EXISTS tenant_isolation_organizations ON public.organizations;
            CREATE POLICY tenant_isolation_organizations
                ON public.organizations
                FOR ALL
                TO public
                USING (id = NULLIF(current_setting('app.organization_id', true), '')::integer)
                WITH CHECK (id = NULLIF(current_setting('app.organization_id', true), '')::integer);
        END
        $$;
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    bind.exec_driver_sql(
        """
        DO $$
        DECLARE
            tenant_table record;
            policy_name text;
        BEGIN
            FOR tenant_table IN
                SELECT DISTINCT table_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND column_name = 'organization_id'
            LOOP
                policy_name := 'tenant_isolation_' || tenant_table.table_name;
                EXECUTE format(
                    'DROP POLICY IF EXISTS %I ON public.%I',
                    policy_name,
                    tenant_table.table_name
                );
                EXECUTE format(
                    'ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY',
                    tenant_table.table_name
                );
            END LOOP;

            DROP POLICY IF EXISTS tenant_isolation_organizations ON public.organizations;
            ALTER TABLE public.organizations DISABLE ROW LEVEL SECURITY;
        END
        $$;
        """
    )
