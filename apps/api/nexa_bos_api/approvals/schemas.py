from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Module = Literal["Leave", "Contracts", "Transfers", "Exit"]


class QueueFilters(BaseModel):
    module: Module | None = None
    status: str | None = None
    employee: UUID | None = None
    requester: UUID | None = None
    approver: UUID | None = None
    department: UUID | None = None
    date_from: date | None = None
    date_to: date | None = None

    @model_validator(mode="after")
    def dates(self):
        if self.date_from and self.date_to and self.date_to < self.date_from:
            raise ValueError("End date must not precede start date")
        return self


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    action: Literal["approve", "reject", "return", "override"]
    lock_version: int = Field(ge=1)
    comment: str = Field(min_length=1, max_length=2000)
