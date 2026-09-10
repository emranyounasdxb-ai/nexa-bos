from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class ContractTypeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)


class ContractTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool | None = None


class ContractCreate(BaseModel):
    employee_id: UUID
    contract_type_id: UUID
    contract_number: str = Field(min_length=1, max_length=80)
    start_date: date
    end_date: date | None = None
    job_title_snapshot: str = Field(min_length=1, max_length=160)
    currency: str = Field(default="AED", pattern=r"^[A-Z]{3}$")
    basic_salary: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    allowances_total: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=2)
    notes: str | None = Field(default=None, max_length=4000)
    parent_contract_id: UUID | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> ContractCreate:
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("End date cannot be before start date")
        return self


class ContractUpdate(BaseModel):
    contract_type_id: UUID | None = None
    start_date: date | None = None
    end_date: date | None = None
    job_title_snapshot: str | None = Field(default=None, min_length=1, max_length=160)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    basic_salary: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    allowances_total: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    notes: str | None = Field(default=None, max_length=4000)
    lock_version: int = Field(ge=1)


class ContractAction(BaseModel):
    lock_version: int = Field(ge=1)
    comment: str | None = Field(default=None, max_length=2000)


class ContractDecision(BaseModel):
    lock_version: int = Field(ge=1)
    decision: str = Field(pattern="^(return|reject)$")
    comment: str = Field(min_length=1, max_length=2000)


class ContractCancel(BaseModel):
    lock_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=2000)
