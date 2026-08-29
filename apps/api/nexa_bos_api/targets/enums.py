from __future__ import annotations

from enum import StrEnum

CURRENCY = "AED"

TARGET_LEVEL_EMPLOYEE = "employee"
TARGET_LEVEL_TEAM = "team"
TARGET_LEVEL_OFFICE = "office"
TARGET_LEVELS = (TARGET_LEVEL_EMPLOYEE, TARGET_LEVEL_TEAM, TARGET_LEVEL_OFFICE)

MILESTONE_SUBMITTED = "submitted"
MILESTONE_APPROVED = "approved"
MILESTONE_BOOKED = "booked"
MILESTONE_FUNDED = "funded"
TARGET_MILESTONES = (
    MILESTONE_SUBMITTED,
    MILESTONE_APPROVED,
    MILESTONE_BOOKED,
    MILESTONE_FUNDED,
)

MEASUREMENT_COUNT = "count"
MEASUREMENT_AMOUNT = "amount"
MEASUREMENTS = (MEASUREMENT_COUNT, MEASUREMENT_AMOUNT)

STATUS_ACTIVE = "active"
STATUS_INACTIVE = "inactive"

PERIOD_MONTH = "month"
PERIOD_QTD = "qtd"
PERIOD_HALF_YEAR = "half_year"
PERIOD_YTD = "ytd"
TARGET_PERIODS = (PERIOD_MONTH, PERIOD_QTD, PERIOD_HALF_YEAR, PERIOD_YTD)

DIRECTION_HIGHER = "higher_is_better"
DIRECTION_LOWER = "lower_is_better"
KPI_DIRECTIONS = (DIRECTION_HIGHER, DIRECTION_LOWER)

KPI_STATUS_DRAFT = "draft"
KPI_STATUS_ACTIVE = "active"
KPI_STATUS_INACTIVE = "inactive"

MILESTONE_ATTR = {
    MILESTONE_SUBMITTED: ("submitted", "submitted_at"),
    MILESTONE_APPROVED: ("approved", "approved_at"),
    MILESTONE_BOOKED: ("booked", "booked_at"),
    MILESTONE_FUNDED: ("funded", "funded_at"),
}

MILESTONE_AMOUNT_FIELD = {
    MILESTONE_SUBMITTED: "requested_amount",
    MILESTONE_APPROVED: "approved_amount",
    MILESTONE_BOOKED: "booked_amount",
    MILESTONE_FUNDED: "funded_amount",
}

BLOCKED_EMPLOYMENT = frozenset({"Inactive", "Resigned", "Terminated"})


class TargetLevel(StrEnum):
    EMPLOYEE = TARGET_LEVEL_EMPLOYEE
    TEAM = TARGET_LEVEL_TEAM
    OFFICE = TARGET_LEVEL_OFFICE


class TargetMilestone(StrEnum):
    SUBMITTED = MILESTONE_SUBMITTED
    APPROVED = MILESTONE_APPROVED
    BOOKED = MILESTONE_BOOKED
    FUNDED = MILESTONE_FUNDED


class MeasurementMode(StrEnum):
    COUNT = MEASUREMENT_COUNT
    AMOUNT = MEASUREMENT_AMOUNT


class KpiDirection(StrEnum):
    HIGHER_IS_BETTER = DIRECTION_HIGHER
    LOWER_IS_BETTER = DIRECTION_LOWER


KPI_METRIC_CATALOG: tuple[tuple[str, str, str], ...] = (
    ("submitted_count", "Submitted count", DIRECTION_HIGHER),
    ("submitted_value", "Submitted value", DIRECTION_HIGHER),
    ("approved_count", "Approved count", DIRECTION_HIGHER),
    ("approved_value", "Approved value", DIRECTION_HIGHER),
    ("booked_count", "Booked count", DIRECTION_HIGHER),
    ("booked_value", "Booked value", DIRECTION_HIGHER),
    ("funded_count", "Funded count", DIRECTION_HIGHER),
    ("funded_value", "Funded value", DIRECTION_HIGHER),
    ("target_achievement", "Target achievement %", DIRECTION_HIGHER),
    ("submitted_to_approved", "Submitted to approved conversion", DIRECTION_HIGHER),
    ("approved_to_booked", "Approved to booked conversion", DIRECTION_HIGHER),
    ("booked_to_funded", "Booked to funded conversion", DIRECTION_HIGHER),
    ("submitted_to_final_rejected", "Submitted to final rejected conversion", DIRECTION_LOWER),
    (
        "submitted_to_cancelled_withdrawn",
        "Submitted to cancelled/withdrawn conversion",
        DIRECTION_LOWER,
    ),
    ("attendance_score", "Attendance score", DIRECTION_HIGHER),
)

KPI_METRIC_CODES: frozenset[str] = frozenset(
    code for code, _label, _direction in KPI_METRIC_CATALOG
)
