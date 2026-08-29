from __future__ import annotations

from datetime import timedelta, timezone
from enum import StrEnum

BUSINESS_TZ = timezone(timedelta(hours=4), name="Asia/Dubai")

# Python datetime.weekday(): Monday=0 … Sunday=6. UAE default working week Sun–Thu.
DEFAULT_WORKING_WEEKDAYS: tuple[int, ...] = (6, 0, 1, 2, 3)

WEEKDAY_NAMES: tuple[str, ...] = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)

SYSTEM_LEAVE_TYPES: tuple[tuple[str, str], ...] = (
    ("ANNUAL", "Annual Leave"),
    ("SICK", "Sick Leave"),
    ("MATERNITY", "Maternity Leave"),
    ("PATERNITY", "Paternity Leave"),
    ("COMPASSIONATE", "Compassionate Leave"),
    ("HAJJ", "Hajj Leave"),
    ("UNPAID", "Unpaid Leave"),
)


class AttendanceStatus(StrEnum):
    PRESENT = "Present"
    ABSENT = "Absent"
    LEAVE = "Leave"
    OFFICIAL_HOLIDAY = "Official Holiday"
    WEEKLY_OFF = "Weekly Off"


class ScheduleKind(StrEnum):
    NORMAL = "normal"
    RAMADAN = "ramadan"


class CalculationState(StrEnum):
    OK = "ok"
    SCHEDULE_MISSING = "schedule_missing"
    NOT_APPLICABLE = "not_applicable"


class ImpactCondition(StrEnum):
    ABSENCE = "absence"
    LATE = "late"
    EARLY_EXIT = "early_exit"
    INCOMPLETE = "incomplete"
    LEAVE = "leave"


class ImpactMethod(StrEnum):
    POINTS = "points"
    PERCENTAGE = "percentage"


class ReminderKind(StrEnum):
    AUTOMATIC = "automatic"
    URGENT = "urgent"
