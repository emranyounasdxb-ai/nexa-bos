from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProposedAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    office_id: UUID | None
    department_id: UUID | None
    business_unit_id: UUID | None = None
    team_id: UUID | None
    designation_id: UUID
    reporting_manager_id: UUID | None


class TransferCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    employee_id: UUID
    proposed: ProposedAssignment
    reason: str = Field(min_length=1, max_length=2000)
    effective_date: date
    notes: str | None = Field(default=None, max_length=4000)
    backdate_reason: str | None = Field(default=None, min_length=1, max_length=2000)
    supersedes_id: UUID | None = None


class TransferUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    proposed: ProposedAssignment
    reason: str = Field(min_length=1, max_length=2000)
    effective_date: date
    notes: str | None = Field(default=None, max_length=4000)
    backdate_reason: str | None = Field(default=None, min_length=1, max_length=2000)
    lock_version: int = Field(ge=1)


class TransferAction(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    lock_version: int = Field(ge=1)
    action: Literal["submit", "review", "approve", "apply", "return", "reject", "cancel"]
    comment: str = Field(min_length=1, max_length=2000)
