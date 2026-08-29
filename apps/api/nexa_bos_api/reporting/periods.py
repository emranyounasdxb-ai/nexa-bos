from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from nexa_bos_api.core.exceptions import AppError

PERIOD_TODAY = "today"
PERIOD_MTD = "mtd"
PERIOD_PREVIOUS_MONTH = "previous_month"
PERIOD_QTD = "qtd"
PERIOD_PREVIOUS_QUARTER = "previous_quarter"
PERIOD_HALF_YEAR = "half_year"
PERIOD_YTD = "ytd"
PERIOD_SINCE_JOINING = "since_joining"
PERIOD_CUSTOM = "custom"

REPORTING_PERIODS: tuple[str, ...] = (
    PERIOD_TODAY,
    PERIOD_MTD,
    PERIOD_PREVIOUS_MONTH,
    PERIOD_QTD,
    PERIOD_PREVIOUS_QUARTER,
    PERIOD_HALF_YEAR,
    PERIOD_YTD,
    PERIOD_SINCE_JOINING,
    PERIOD_CUSTOM,
)

DEFAULT_PERIOD = PERIOD_MTD


def utcnow() -> datetime:
    return datetime.now(UTC)


def start_of_day(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=UTC)


def end_of_day(value: date) -> datetime:
    return datetime.combine(value, time.max, tzinfo=UTC)


def month_end(year: int, month: int) -> date:
    return date(year, month, monthrange(year, month)[1])


def quarter_start(value: date) -> date:
    month = ((value.month - 1) // 3) * 3 + 1
    return date(value.year, month, 1)


def previous_quarter_bounds(value: date) -> tuple[date, date]:
    start = quarter_start(value)
    last_day_prev = start - timedelta(days=1)
    prev_start = quarter_start(last_day_prev)
    return prev_start, last_day_prev


def half_year_start(value: date) -> date:
    return date(value.year, 1 if value.month <= 6 else 7, 1)


def previous_half_year_bounds(value: date) -> tuple[date, date]:
    start = half_year_start(value)
    last_day_prev = start - timedelta(days=1)
    prev_start = half_year_start(last_day_prev)
    return prev_start, last_day_prev


@dataclass(frozen=True)
class PeriodWindow:
    key: str
    label: str
    start: datetime
    end: datetime
    date_from: date
    date_to: date


def _window(key: str, label: str, start_date: date, end_date: date) -> PeriodWindow:
    if start_date > end_date:
        raise AppError(
            status_code=422,
            code="INVALID_PERIOD",
            message="Period start must be on or before the period end",
        )
    return PeriodWindow(
        key=key,
        label=label,
        start=start_of_day(start_date),
        end=end_of_day(end_date),
        date_from=start_date,
        date_to=end_date,
    )


def resolve_period(
    key: str,
    *,
    as_of: datetime | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    joining_date: date | None = None,
) -> PeriodWindow:
    now = as_of.astimezone(UTC) if as_of else utcnow()
    today = now.date()
    period = (key or DEFAULT_PERIOD).strip().lower()
    if period not in REPORTING_PERIODS:
        raise AppError(
            status_code=422,
            code="INVALID_PERIOD",
            message="Unknown reporting period",
        )
    if period == PERIOD_TODAY:
        return _window(period, "Today", today, today)
    if period == PERIOD_MTD:
        return _window(period, "MTD", date(today.year, today.month, 1), today)
    if period == PERIOD_PREVIOUS_MONTH:
        first_this = date(today.year, today.month, 1)
        last_prev = first_this - timedelta(days=1)
        return _window(
            period, "Previous Month", date(last_prev.year, last_prev.month, 1), last_prev
        )
    if period == PERIOD_QTD:
        return _window(period, "QTD", quarter_start(today), today)
    if period == PERIOD_PREVIOUS_QUARTER:
        start, end = previous_quarter_bounds(today)
        return _window(period, "Previous Quarter", start, end)
    if period == PERIOD_HALF_YEAR:
        return _window(period, "Half-Year", half_year_start(today), today)
    if period == PERIOD_YTD:
        return _window(period, "YTD", date(today.year, 1, 1), today)
    if period == PERIOD_SINCE_JOINING:
        if joining_date is None:
            raise AppError(
                status_code=422,
                code="JOINING_DATE_REQUIRED",
                message="Since Joining requires an employee joining date",
            )
        return _window(period, "Since Joining", joining_date, today)
    if date_from is None or date_to is None:
        raise AppError(
            status_code=422,
            code="CUSTOM_DATES_REQUIRED",
            message="Custom period requires From and To dates",
        )
    return _window(period, "Custom", date_from, date_to)


def comparison_windows(
    key: str,
    *,
    as_of: datetime | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    compare_from: date | None = None,
    compare_to: date | None = None,
) -> tuple[PeriodWindow, PeriodWindow]:
    now = as_of.astimezone(UTC) if as_of else utcnow()
    today = now.date()
    period = (key or "month").strip().lower()
    if period in {"month", "current_month"}:
        current = _window("month", "Current Month", date(today.year, today.month, 1), today)
        first_this = date(today.year, today.month, 1)
        last_prev = first_this - timedelta(days=1)
        previous = _window(
            "previous_month",
            "Previous Month",
            date(last_prev.year, last_prev.month, 1),
            last_prev,
        )
        return current, previous
    if period in {"quarter", "current_quarter"}:
        current = _window("quarter", "Current Quarter", quarter_start(today), today)
        start, end = previous_quarter_bounds(today)
        return current, _window("previous_quarter", "Previous Quarter", start, end)
    if period in {"half_year", "current_half_year"}:
        current = _window("half_year", "Current Half-Year", half_year_start(today), today)
        start, end = previous_half_year_bounds(today)
        return current, _window("previous_half_year", "Previous Half-Year", start, end)
    if period in {"year", "current_year"}:
        current = _window("year", "Current Year", date(today.year, 1, 1), today)
        prev_year = today.year - 1
        previous = _window(
            "previous_year",
            "Previous Year",
            date(prev_year, 1, 1),
            date(prev_year, 12, 31),
        )
        return current, previous
    if period == PERIOD_CUSTOM:
        if None in {date_from, date_to, compare_from, compare_to}:
            raise AppError(
                status_code=422,
                code="CUSTOM_DATES_REQUIRED",
                message="Custom period comparison requires both current and comparison date ranges",
            )
        return (
            _window(PERIOD_CUSTOM, "Custom", date_from, date_to),
            _window(PERIOD_CUSTOM, "Comparison Custom", compare_from, compare_to),
        )
    raise AppError(
        status_code=422,
        code="INVALID_PERIOD",
        message="Unknown comparison period",
    )


def in_window(moment: datetime | None, window: PeriodWindow) -> bool:
    if moment is None:
        return False
    value = moment if moment.tzinfo else moment.replace(tzinfo=UTC)
    return window.start <= value <= window.end
