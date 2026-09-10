from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from nexa_bos_api.leave.enums import LeaveAccrualMethod, LeavePortion, LeaveStatus


class LeaveTypeConfig(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    status: str | None = None
    is_paid: bool | None = None
    eligibility: str | None = Field(default=None, max_length=1000)
    yearly_entitlement: float | None = Field(default=None, ge=0, le=366)
    accrual_method: LeaveAccrualMethod | None = None
    monthly_accrual: float | None = Field(default=None, ge=0, le=31)
    carry_forward_limit: float | None = Field(default=None, ge=0, le=366)
    carry_forward_expiry_months: int | None = Field(default=None, ge=1, le=24)
    half_day_allowed: bool | None = None
    attachment_required: bool | None = None


class LeaveRequestCreate(BaseModel):
    employee_id: UUID | None = None
    leave_type_id: UUID
    start_date: date
    end_date: date
    portion: LeavePortion = LeavePortion.FULL_DAY
    reason: str = Field(min_length=1, max_length=4000)
    submit: bool = False
    exception_reason: str | None = Field(default=None, min_length=1, max_length=2000)

    @model_validator(mode="after")
    def validate_dates(self) -> LeaveRequestCreate:
        if self.end_date < self.start_date:
            raise ValueError("End date cannot be before start date")
        if self.portion is not LeavePortion.FULL_DAY and self.end_date != self.start_date:
            raise ValueError("Half-day leave must start and end on the same date")
        return self


class LeaveRequestUpdate(BaseModel):
    leave_type_id: UUID | None = None
    start_date: date | None = None
    end_date: date | None = None
    portion: LeavePortion | None = None
    reason: str | None = Field(default=None, min_length=1, max_length=4000)
    lock_version: int = Field(ge=1)


class LeaveAction(BaseModel):
    lock_version: int = Field(ge=1)
    comment: str | None = Field(default=None, max_length=2000)
    exception_reason: str | None = Field(default=None, min_length=1, max_length=2000)


class LeaveDecision(BaseModel):
    lock_version: int = Field(ge=1)
    decision: str
    comment: str = Field(min_length=1, max_length=2000)


class LeaveCancellation(BaseModel):
    lock_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=2000)


class LeaveCancellationDecision(BaseModel):
    lock_version: int = Field(ge=1)
    approve: bool
    comment: str = Field(min_length=1, max_length=2000)


class LeaveBalanceAdjustmentCreate(BaseModel):
    employee_id: UUID
    leave_type_id: UUID
    year: int = Field(ge=2000, le=2200)
    amount: float = Field(ge=-366, le=366)
    kind: str = Field(pattern="^(adjustment|carry_forward)$")
    expires_on: date | None = None
    reason: str = Field(min_length=1, max_length=2000)


class LeaveListFilters(BaseModel):
    status: LeaveStatus | None = None
    employee_id: UUID | None = None
