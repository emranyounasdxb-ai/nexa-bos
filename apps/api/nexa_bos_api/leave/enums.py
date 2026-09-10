from __future__ import annotations

from enum import StrEnum


class LeaveAccrualMethod(StrEnum):
    NONE = "none"
    MONTHLY = "monthly"


class LeavePortion(StrEnum):
    FULL_DAY = "full_day"
    FIRST_HALF = "first_half"
    SECOND_HALF = "second_half"


class LeaveStatus(StrEnum):
    DRAFT = "Draft"
    SUBMITTED = "Submitted"
    MANAGER_APPROVED = "Manager Approved"
    HR_APPROVED = "HR Approved"
    RETURNED = "Returned"
    REJECTED = "Rejected"
    CANCELLATION_PENDING = "Cancellation Pending"
    CANCELLED = "Cancelled"
    COMPLETED = "Completed"


ACTIVE_BALANCE_STATUSES = {
    LeaveStatus.SUBMITTED,
    LeaveStatus.MANAGER_APPROVED,
    LeaveStatus.HR_APPROVED,
    LeaveStatus.CANCELLATION_PENDING,
    LeaveStatus.COMPLETED,
}

APPROVED_STATUSES = {
    LeaveStatus.HR_APPROVED,
    LeaveStatus.CANCELLATION_PENDING,
    LeaveStatus.COMPLETED,
}
