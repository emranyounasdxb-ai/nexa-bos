from __future__ import annotations

from datetime import date, datetime, time
from typing import NamedTuple

from nexa_bos_api.attendance.enums import (
    BUSINESS_TZ,
    AttendanceStatus,
    CalculationState,
    ScheduleKind,
)
from nexa_bos_api.attendance.models import AttendanceSchedule


def business_today(as_of: datetime | None = None) -> date:
    moment = as_of.astimezone(BUSINESS_TZ) if as_of else datetime.now(BUSINESS_TZ)
    return moment.date()


def _as_minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def add_minutes(value: time, minutes: int) -> time:
    total = _as_minutes(value) + minutes
    total = max(0, min(total, 24 * 60 - 1))
    return time(hour=total // 60, minute=total % 60)


class CalculationResult(NamedTuple):
    is_late: bool
    late_minutes: int
    is_early_exit: bool
    early_exit_minutes: int
    is_incomplete: bool
    calculation_state: str
    schedule_id: object | None
    worked_on_holiday: bool


def calculate_attendance(
    *,
    status: AttendanceStatus,
    time_in: time | None,
    time_out: time | None,
    schedule: AttendanceSchedule | None,
    is_official_holiday: bool,
) -> CalculationResult:
    worked_on_holiday = is_official_holiday and status is AttendanceStatus.PRESENT
    if status is not AttendanceStatus.PRESENT:
        return CalculationResult(
            False,
            0,
            False,
            0,
            False,
            CalculationState.NOT_APPLICABLE,
            None,
            worked_on_holiday,
        )
    incomplete = time_in is not None and time_out is None
    if time_in is None:
        return CalculationResult(
            False,
            0,
            False,
            0,
            False,
            CalculationState.NOT_APPLICABLE,
            schedule.id if schedule else None,
            worked_on_holiday,
        )
    if worked_on_holiday:
        return CalculationResult(
            False,
            0,
            False,
            0,
            incomplete,
            CalculationState.NOT_APPLICABLE,
            schedule.id if schedule else None,
            True,
        )
    if schedule is None:
        return CalculationResult(
            False,
            0,
            False,
            0,
            incomplete,
            CalculationState.SCHEDULE_MISSING,
            None,
            False,
        )
    late_after = add_minutes(schedule.start_time, schedule.grace_minutes)
    late_minutes = max(0, _as_minutes(time_in) - _as_minutes(late_after))
    is_late = late_minutes > 0
    early_minutes = 0
    is_early = False
    if time_out is not None:
        early_minutes = max(0, _as_minutes(schedule.end_time) - _as_minutes(time_out))
        is_early = early_minutes > 0
    return CalculationResult(
        is_late,
        late_minutes,
        is_early,
        early_minutes,
        incomplete,
        CalculationState.OK,
        schedule.id,
        False,
    )


def schedule_covers_ramadan(schedule: AttendanceSchedule, on_date: date) -> bool:
    if schedule.kind != ScheduleKind.RAMADAN:
        return False
    if schedule.ramadan_from is None or schedule.ramadan_to is None:
        return False
    return schedule.ramadan_from <= on_date <= schedule.ramadan_to


def select_schedule(
    schedules: list[AttendanceSchedule],
    *,
    office_id: object | None,
    department_id: object | None,
    on_date: date,
) -> AttendanceSchedule | None:
    if office_id is None:
        return None
    office_rows = [row for row in schedules if row.office_id == office_id]
    dept_rows = [row for row in office_rows if row.department_id == department_id]
    office_only = [row for row in office_rows if row.department_id is None]
    for pool in (dept_rows, office_only):
        ramadan = [row for row in pool if schedule_covers_ramadan(row, on_date)]
        if ramadan:
            return sorted(ramadan, key=lambda row: row.ramadan_from or on_date, reverse=True)[0]
    for pool in (dept_rows, office_only):
        normal = [row for row in pool if row.kind == ScheduleKind.NORMAL]
        if normal:
            return normal[0]
    return None
