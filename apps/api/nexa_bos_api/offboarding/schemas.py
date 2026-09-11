from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ExitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    employee_id: UUID
    exit_type: Literal["Resignation", "Termination", "End of Contract", "Other"]
    notice_date: date
    last_working_date: date
    reason: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def dates(self):
        if self.last_working_date < self.notice_date:
            raise ValueError("Last working date must not precede notice date")
        return self


class ExitUpdate(ExitCreate):
    lock_version: int = Field(ge=1)


class ExitAction(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    action: Literal[
        "submit", "notice", "clearance", "ready", "complete", "cancel", "return", "reject", "reopen"
    ]
    lock_version: int = Field(ge=1)
    comment: str = Field(min_length=1, max_length=2000)


class ClearanceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    lock_version: int = Field(ge=1)
    assignee_id: UUID | None = None
    status: Literal["Pending", "In progress", "Cleared", "Not applicable"] | None = None
    note: str = Field(min_length=1, max_length=2000)


class SettlementUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    lock_version: int = Field(ge=1)
    status: Literal["Not recorded", "Pending", "Cleared"]
    reference: str | None = Field(default=None, max_length=200)
    comment: str = Field(min_length=1, max_length=2000)
