from __future__ import annotations

from calendar import monthrange
from collections.abc import Iterable
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from nexa_bos_api.targets.enums import (
    DIRECTION_HIGHER,
    DIRECTION_LOWER,
    MEASUREMENT_AMOUNT,
    MEASUREMENT_COUNT,
)

ZERO = Decimal("0.00")
HUNDRED = Decimal("100.00")
TWOPLACES = Decimal("0.01")


def month_start(value: date) -> date:
    return date(value.year, value.month, 1)


def month_end(year: int, month: int) -> date:
    return date(year, month, monthrange(year, month)[1])


def months_in_range(start: date, end: date) -> list[date]:
    months: list[date] = []
    cursor = month_start(start)
    last = month_start(end)
    while cursor <= last:
        months.append(cursor)
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return months


def quantize(value: Decimal | int | float | None) -> Decimal:
    amount = ZERO if value is None else Decimal(str(value))
    return amount.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def money(value: Decimal | int | float | None) -> str:
    return f"{quantize(value):.2f}"


def working_dates(
    start: date,
    end: date,
    weekdays: Iterable[int],
    holidays: Iterable[date],
) -> list[date]:
    days = set(weekdays)
    blocked = set(holidays)
    if start > end or not days:
        return []
    found: list[date] = []
    cursor = start
    while cursor <= end:
        if cursor.weekday() in days and cursor not in blocked:
            found.append(cursor)
        cursor += timedelta(days=1)
    return found


def achievement_pct(actual: Decimal, target: Decimal) -> float | None:
    if target == 0:
        return None
    return float((actual / target * HUNDRED).quantize(TWOPLACES, rounding=ROUND_HALF_UP))


def gap_value(actual: Decimal, target: Decimal) -> Decimal:
    return quantize(target - actual)


def daily_run_rate(remaining: Decimal, remaining_working_days: int) -> Decimal | None:
    if remaining_working_days <= 0:
        return None
    if remaining <= 0:
        return ZERO
    return quantize(remaining / Decimal(remaining_working_days))


def prorate_target(
    configured: Decimal,
    *,
    prorate: bool,
    elapsed_working_days: int,
    month_working_days: int,
) -> Decimal:
    if not prorate:
        return quantize(configured)
    if month_working_days <= 0:
        return quantize(configured)
    ratio = Decimal(elapsed_working_days) / Decimal(month_working_days)
    return quantize(configured * ratio)


def directed_achievement(
    actual: Decimal,
    baseline: Decimal | None,
    direction: str,
) -> float | None:
    if direction == DIRECTION_LOWER:
        if baseline is None:
            return None
        if baseline == 0:
            return 100.0 if actual == 0 else 0.0
        if actual == 0:
            return 100.0
        ratio = (baseline / actual) * HUNDRED
        return float(quantize(ratio))
    if direction != DIRECTION_HIGHER:
        return None
    if baseline is None:
        return None
    return achievement_pct(actual, baseline)


def weighted_contribution(achievement: float | None, weight: Decimal) -> Decimal:
    if achievement is None:
        return ZERO
    capped = min(Decimal(str(achievement)), HUNDRED)
    return quantize(capped * weight / HUNDRED)


def default_measurement(product: object) -> str:
    measurement = getattr(product, "target_measurement", None)
    if measurement in {MEASUREMENT_AMOUNT, MEASUREMENT_COUNT}:
        return str(measurement)
    return MEASUREMENT_COUNT
