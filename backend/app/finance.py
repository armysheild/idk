from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import Select, select, func
from sqlalchemy.orm import Session

from .models import Expense, FuelTransaction, OdometerLog, Organization, WorkOrder


def capture_labor_rate(database: Session, work_order: WorkOrder) -> None:
    if work_order.labor_rate_paise is None:
        organization = database.get(Organization, work_order.organization_id)
        work_order.labor_rate_paise = (organization.labor_rate_per_hour if organization else 0) * 100


def expense_statement(
    organization_id: int,
    vehicle_id: int | None = None,
    transaction_type: Literal["REVENUE", "EXPENSE"] | None = None,
    category: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> Select[tuple[Expense]]:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="Start date must not follow end date")
    statement = select(Expense).where(Expense.organization_id == organization_id)
    if vehicle_id is not None:
        statement = statement.where(Expense.vehicle_id == vehicle_id)
    if transaction_type is not None:
        revenue = func.upper(Expense.category).endswith("_REVENUE", autoescape=True)
        statement = statement.where(revenue if transaction_type == "REVENUE" else ~revenue)
    if category:
        statement = statement.where(func.upper(Expense.category).in_((category.upper(), f"{category.upper()}_REVENUE")))
    if start_date:
        statement = statement.where(Expense.incurred_on >= start_date.isoformat())
    if end_date:
        statement = statement.where(Expense.incurred_on <= end_date.isoformat())
    return statement


def period_distance(
    database: Session, organization_id: int, vehicle_ids: list[int], start_date: date, end_date: date,
) -> dict[int, int | None]:
    start = datetime.combine(start_date, time.min)
    end = datetime.combine(end_date + timedelta(days=1), time.min)
    readings: dict[int, list[tuple[datetime, int]]] = {vehicle_id: [] for vehicle_id in vehicle_ids}
    logs = database.scalars(select(OdometerLog).where(
        OdometerLog.organization_id == organization_id,
        OdometerLog.vehicle_id.in_(vehicle_ids),
        OdometerLog.is_flagged.is_(False),
        OdometerLog.created_at >= start,
        OdometerLog.created_at < end,
    )).all()
    for log in logs:
        recorded_at = log.created_at.astimezone(timezone.utc).replace(tzinfo=None) if log.created_at.tzinfo else log.created_at
        readings[log.vehicle_id].append((recorded_at, log.reading_km))
    fuel_readings: dict[int, list[tuple[date, int]]] = {vehicle_id: [] for vehicle_id in vehicle_ids}
    fuels = database.scalars(select(FuelTransaction).where(
        FuelTransaction.organization_id == organization_id,
        FuelTransaction.vehicle_id.in_(vehicle_ids),
        FuelTransaction.incurred_on >= start_date.isoformat(),
        FuelTransaction.incurred_on <= end_date.isoformat(),
    )).all()
    for fuel in fuels:
        fuel_readings[fuel.vehicle_id].append((date.fromisoformat(fuel.incurred_on), fuel.odometer_km))
    distances: dict[int, int | None] = {}
    for vehicle_id, samples in readings.items():
        samples.sort(key=lambda sample: sample[0])
        if any(right[1] < left[1] for left, right in zip(samples, samples[1:])):
            distances[vehicle_id] = None
            continue
        days: dict[date, list[int]] = {}
        for recorded_at, reading in samples:
            days.setdefault(recorded_at.date(), []).append(reading)
        for incurred_on, reading in fuel_readings[vehicle_id]:
            days.setdefault(incurred_on, []).append(reading)
        bounds = [(min(days[day]), max(days[day])) for day in sorted(days)]
        if (
            not bounds
            or (len(bounds) == 1 and len(samples) < 2)
            or any(right[0] < left[1] for left, right in zip(bounds, bounds[1:]))
        ):
            distances[vehicle_id] = None
        else:
            distances[vehicle_id] = bounds[-1][1] - bounds[0][0]
    return distances
