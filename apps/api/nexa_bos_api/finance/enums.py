from __future__ import annotations

from enum import StrEnum


class EligibilityMilestone(StrEnum):
    BOOKED = "booked"
    FUNDED = "funded"


class CalculationMethod(StrEnum):
    FIXED = "fixed"
    PERCENTAGE = "percentage"
    SLAB = "slab"
    FLAT_PERCENTAGE = "flat_percentage"


class RecipientPayoutMode(StrEnum):
    PERCENTAGE_SPLIT = "percentage_split"
    INDEPENDENT_ROLE_RATE = "independent_role_rate"


class RecipientSource(StrEnum):
    CASE_OWNER = "case_owner"
    REPORTING_MANAGER = "reporting_manager"


class ConfigurationStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    INACTIVE = "inactive"


class FinanceComponentType(StrEnum):
    COMMISSION = "commission"
    INCENTIVE = "incentive"
    CLAWBACK = "clawback"
    ADJUSTMENT = "adjustment"


class PayoutPeriodStatus(StrEnum):
    DRAFT = "draft"
    REVIEW = "review"
    FINALIZED = "finalized"
