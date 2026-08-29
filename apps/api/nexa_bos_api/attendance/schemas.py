from __future__ import annotations

from datetime import date, time
from uuid import UUID

from pydantic import BaseModel, Field

from nexa_bos_api.attendance.enums import (
    AttendanceStatus,
    ImpactCondition,
    ImpactMethod,
    ScheduleKind,
)


class WorkingDaysUpdate(BaseModel):
    weekdays: list[int] = Field(min_length=0, max_length=7)


class ScheduleCreateRequest(BaseModel):
    office_id: UUID
    department_id: UUID | None = None
    kind: ScheduleKind = ScheduleKind.NORMAL
    start_time: time
    end_time: time
    grace_minutes: int = Field(default=0, ge=0, le=240)
    ramadan_from: date | None = None
    ramadan_to: date | None = None


class ScheduleUpdateRequest(BaseModel):
    start_time: time | None = None
    end_time: time | None = None
    grace_minutes: int | None = Field(default=None, ge=0, le=240)
    ramadan_from: date | None = None
    ramadan_to: date | None = None


class LeaveTypeCreateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=120)


class LeaveTypeUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    status: str | None = None


class HolidayCreateRequest(BaseModel):
    holiday_date: date
    name: str = Field(min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=4000)


class HolidayUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=4000)


class ImpactRuleRequest(BaseModel):
    condition: ImpactCondition
    leave_type_id: UUID | None = None
    method: ImpactMethod
    value: float = Field(ge=0, le=1000)


class AttendanceEntry(BaseModel):
    employee_id: UUID
    status: AttendanceStatus
    time_in: time | None = None
    time_out: time | None = None
    notes: str | None = Field(default=None, max_length=4000)
    leave_type_id: UUID | None = None


class AttendanceBulkRequest(BaseModel):
    attendance_date: date
    entries: list[AttendanceEntry] = Field(min_length=1, max_length=500)


class AttendanceCorrectionRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    status: AttendanceStatus | None = None
    time_in: time | None = None
    time_out: time | None = None
    notes: str | None = Field(default=None, max_length=4000)
    leave_type_id: UUID | None = None
    clear_time_in: bool = False
    clear_time_out: bool = False
