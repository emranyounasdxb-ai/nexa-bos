from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from nexa_bos_api.finance.enums import (
    CalculationMethod,
    EligibilityMilestone,
    RecipientPayoutMode,
    RecipientSource,
)


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CommissionSlabInput(StrictRequest):
    minimum_eligible: Decimal = Field(ge=0, decimal_places=2)
    maximum_eligible: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    payout_amount: Decimal = Field(ge=0, decimal_places=2)
    sort_order: int = Field(ge=0)


class CommissionRecipientInput(StrictRequest):
    role_code: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    role_name: str = Field(min_length=1, max_length=120)
    recipient_source: RecipientSource
    hierarchy_level: int | None = Field(default=None, ge=1, le=20)
    sort_order: int = Field(ge=0)
    split_percent: Decimal | None = Field(default=None, gt=0, le=100, decimal_places=4)
    calculation_method: CalculationMethod | None = None
    fixed_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    percentage_rate: Decimal | None = Field(default=None, ge=0, decimal_places=6)
    flat_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    slabs: list[CommissionSlabInput] = Field(default_factory=list)


class CommissionRuleCreateRequest(StrictRequest):
    bank_id: UUID
    product_id: UUID
    eligibility_milestone: EligibilityMilestone
    effective_from: date
    effective_to: date | None = None
    payout_mode: RecipientPayoutMode
    calculation_method: CalculationMethod | None = None
    fixed_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    percentage_rate: Decimal | None = Field(default=None, ge=0, decimal_places=6)
    flat_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    recipients: list[CommissionRecipientInput] = Field(min_length=1)
    slabs: list[CommissionSlabInput] = Field(default_factory=list)


class IncentiveSlabInput(StrictRequest):
    minimum_production: Decimal = Field(ge=0, decimal_places=2)
    maximum_production: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    payout_amount: Decimal = Field(ge=0, decimal_places=2)
    sort_order: int = Field(ge=0)


class IncentivePlanCreateRequest(StrictRequest):
    name: str = Field(min_length=1, max_length=160)
    effective_from: date
    effective_to: date | None = None
    slabs: list[IncentiveSlabInput] = Field(min_length=1)


class AdjustmentCreateRequest(StrictRequest):
    application_id: UUID
    recipient_id: UUID
    amount: Decimal
    reason: str = Field(min_length=1, max_length=2000)


class ClawbackCreateRequest(StrictRequest):
    original_component_id: UUID
    amount: Decimal = Field(gt=0)
    reason: str = Field(min_length=1, max_length=2000)


class PeriodReopenRequest(StrictRequest):
    reason: str = Field(min_length=1, max_length=2000)


class FinanceExportRequest(StrictRequest):
    format: str = Field(pattern=r"^(xlsx|pdf|print)$")
    period_month: date
    recipient_id: UUID | None = None
