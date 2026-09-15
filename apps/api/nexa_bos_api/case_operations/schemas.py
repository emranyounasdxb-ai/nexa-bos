from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CardPointRuleCreateRequest(StrictRequest):
    bank_id: UUID
    product_variant_id: UUID
    points: Decimal = Field(ge=0, decimal_places=2)
    effective_from: date
    effective_to: date | None = None


class RoutingAssignmentRequest(StrictRequest):
    office_id: UUID
    product_id: UUID
    sales_manager_id: UUID
    coordinator_id: UUID


class BookCaseRequest(StrictRequest):
    expected_review_event_id: UUID


class SalesManagerDecisionRequest(StrictRequest):
    decision: Literal["approve", "return"]
    reason: str | None = Field(default=None, max_length=2000)


class BankSubmissionRequest(StrictRequest):
    bank_file_number: str = Field(min_length=1, max_length=64)


class ClawbackCreateRequest(StrictRequest):
    earning_id: UUID
    amount: Decimal = Field(gt=0, decimal_places=2)
    reason: str = Field(min_length=1, max_length=2000)


class ClawbackDecisionRequest(StrictRequest):
    decision: Literal["approve", "reject"]
    reason: str | None = Field(default=None, max_length=2000)


class StageCsvCommitRequest(StrictRequest):
    token: str = Field(min_length=20, max_length=200)
