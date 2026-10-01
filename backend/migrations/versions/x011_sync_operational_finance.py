"""sync fuel and maintenance activity into the finance ledger

Revision ID: x011
Revises: x010
"""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "x011"
down_revision = "x010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    organizations = sa.Table(
        "organizations",
        metadata,
        sa.Column("id", sa.Integer),
        sa.Column("labor_rate_per_hour", sa.Integer),
    )
    fuels = sa.Table(
        "fuel_transactions",
        metadata,
        sa.Column("id", sa.Integer),
        sa.Column("organization_id", sa.Integer),
        sa.Column("vehicle_id", sa.Integer),
        sa.Column("station", sa.String),
        sa.Column("total_amount_paise", sa.Integer),
        sa.Column("incurred_on", sa.String),
        sa.Column("created_by", sa.Integer),
        sa.Column("created_at", sa.DateTime),
    )
    work_orders = sa.Table(
        "work_orders",
        metadata,
        sa.Column("id", sa.Integer),
        sa.Column("organization_id", sa.Integer),
        sa.Column("vehicle_id", sa.Integer),
        sa.Column("title", sa.String),
        sa.Column("status", sa.String),
        sa.Column("labor_hours", sa.Integer),
        sa.Column("completed_at", sa.DateTime),
        sa.Column("created_at", sa.DateTime),
        sa.Column("created_by", sa.Integer),
    )
    part_usage = sa.Table(
        "work_order_part_usage",
        metadata,
        sa.Column("work_order_id", sa.Integer),
        sa.Column("quantity", sa.Integer),
        sa.Column("unit_cost_paise", sa.Integer),
    )
    expenses = sa.Table(
        "expenses",
        metadata,
        sa.Column("organization_id", sa.Integer),
        sa.Column("vehicle_id", sa.Integer),
        sa.Column("category", sa.String),
        sa.Column("description", sa.String),
        sa.Column("amount_paise", sa.Integer),
        sa.Column("incurred_on", sa.String),
        sa.Column("vendor", sa.String),
        sa.Column("cost_center", sa.String),
        sa.Column("status", sa.String),
        sa.Column("created_by", sa.Integer),
        sa.Column("created_at", sa.DateTime),
    )

    existing = {
        row[0]
        for row in bind.execute(
            sa.select(expenses.c.cost_center).where(
                expenses.c.cost_center.is_not(None)
            )
        )
    }
    org_rates = {
        row.id: row.labor_rate_per_hour or 0
        for row in bind.execute(sa.select(organizations)).mappings()
    }
    for fuel in bind.execute(sa.select(fuels)).mappings():
        source_key = f"fuel_transaction:{fuel.id}"
        if source_key in existing or fuel.total_amount_paise <= 0:
            continue
        bind.execute(
            expenses.insert().values(
                organization_id=fuel.organization_id,
                vehicle_id=fuel.vehicle_id,
                category="FUEL",
                description=f"Fuel log #{fuel.id}",
                amount_paise=fuel.total_amount_paise,
                incurred_on=fuel.incurred_on,
                vendor=fuel.station,
                cost_center=source_key,
                status="Pending",
                created_by=fuel.created_by,
                created_at=fuel.created_at or datetime.now(timezone.utc),
            )
        )
        existing.add(source_key)

    for work_order in bind.execute(sa.select(work_orders)).mappings():
        if work_order.status not in {"Ready for review", "Completed", "Closed", "Archived"}:
            continue
        source_key = f"work_order:{work_order.id}"
        if source_key in existing:
            continue
        parts_cost = sum(
            (usage.quantity or 0) * (usage.unit_cost_paise or 0)
            for usage in bind.execute(
                sa.select(part_usage).where(
                    part_usage.c.work_order_id == work_order.id
                )
            ).mappings()
        )
        labor_cost = (
            (work_order.labor_hours or 0)
            * org_rates.get(work_order.organization_id, 0)
            * 100
        )
        amount_paise = parts_cost + labor_cost
        if amount_paise <= 0:
            continue
        occurred_at = work_order.completed_at or work_order.created_at
        bind.execute(
            expenses.insert().values(
                organization_id=work_order.organization_id,
                vehicle_id=work_order.vehicle_id,
                category="MAINTENANCE",
                description=f"Work order #{work_order.id}: {work_order.title}",
                amount_paise=amount_paise,
                incurred_on=occurred_at.date().isoformat(),
                cost_center=source_key,
                status="Pending",
                created_by=work_order.created_by,
                created_at=work_order.completed_at or work_order.created_at or datetime.now(timezone.utc),
            )
        )
        existing.add(source_key)


def downgrade() -> None:
    # Operational records may have been reconciled or edited after backfill.
    pass
