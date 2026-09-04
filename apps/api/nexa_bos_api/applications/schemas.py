from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from nexa_bos_api.customers.schemas import CustomerCreateRequest
from nexa_bos_api.identity.enums import (
    DelayCorrectionAction,
    DelayType,
    TerminalOutcome,
    VisibilityScope,
)


class AssignApplicationScopeRequest(BaseModel):
    application_visibility_scope: VisibilityScope | None = None


class ApplicationCreateRequest(BaseModel):
    customer_id: UUID | None = None
    customer: CustomerCreateRequest | None = None
    bank_id: UUID
    product_id: UUID
    product_variant_id: UUID
    case_owner_id: UUID | None = None
    requested_amount: Decimal | None = None
    bank_case_number: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def exactly_one_customer_source(self) -> ApplicationCreateRequest:
        if (self.customer_id is None) == (self.customer is None):
            raise ValueError("Provide exactly one of customer_id or customer")
        return self


class ApplicationUpdateRequest(BaseModel):
    product_variant_id: UUID | None = None
    requested_amount: Decimal | None = None
    approved_amount: Decimal | None = None
    booked_amount: Decimal | None = None
    funded_amount: Decimal | None = None
    bank_case_number: str | None = Field(default=None, max_length=64)


class CaseNumberRequest(BaseModel):
    bank_case_number: str = Field(min_length=1, max_length=64)
    reason: str | None = Field(default=None, max_length=2000)


class CorrectSubmittedRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    product_variant_id: UUID | None = None
    requested_amount: Decimal | None = None
    approved_amount: Decimal | None = None
    booked_amount: Decimal | None = None
    funded_amount: Decimal | None = None


class ReassignOwnerRequest(BaseModel):
    case_owner_id: UUID
    reason: str | None = Field(default=None, max_length=2000)


class StageUpdateRequest(BaseModel):
    stage_id: UUID
    bank_stage_date: date
    stage_note: str | None = Field(default=None, max_length=4000)
    approved_amount: Decimal | None = None
    booked_amount: Decimal | None = None
    funded_amount: Decimal | None = None
    requirement_text: str | None = Field(default=None, max_length=4000)


class StageCorrectionRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    stage_id: UUID
    bank_stage_date: date
    stage_note: str | None = Field(default=None, max_length=4000)
    correction_of_event_id: UUID | None = None


class OutcomeRequest(BaseModel):
    outcome: TerminalOutcome
    reason: str = Field(min_length=1, max_length=4000)


class MigrateWorkflowRequest(BaseModel):
    workflow_id: UUID
    target_stage_id: UUID
    reason: str = Field(min_length=1, max_length=2000)


class MarkDelayRequest(BaseModel):
    delay_type: DelayType
    reason: str = Field(min_length=1, max_length=4000)
    other_explanation: str | None = Field(default=None, max_length=4000)


class CorrectDelayRequest(BaseModel):
    action: DelayCorrectionAction
    reason: str = Field(min_length=1, max_length=4000)


class WorkflowCreateRequest(BaseModel):
    bank_id: UUID
    product_id: UUID


class WorkflowStageCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=64)
    sort_order: int = Field(ge=1, le=10000)


class WorkflowStageUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = Field(default=None, ge=1, le=10000)


class WorkflowTransitionsRequest(BaseModel):
    items: list[dict]


class ProductFieldRulesUpdate(BaseModel):
    requested_amount_required: bool | None = None
    approved_amount_required: bool | None = None
    booked_amount_required: bool | None = None
    funded_amount_required: bool | None = None
