from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from nexa_bos_api.identity.enums import CustomerType


class CustomerCreateRequest(BaseModel):
    customer_type: CustomerType
    full_name: str | None = Field(default=None, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)
    contact_person: str | None = Field(default=None, max_length=200)
    mobile: str = Field(min_length=5, max_length=32)
    email: EmailStr | None = None
    emirates_id: str | None = Field(default=None, max_length=64)
    passport: str | None = Field(default=None, max_length=64)
    employer: str | None = Field(default=None, max_length=200)
    trade_license: str | None = Field(default=None, max_length=64)
    create_anyway: bool = False


class CustomerUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    company_name: str | None = Field(default=None, min_length=1, max_length=200)
    contact_person: str | None = Field(default=None, min_length=1, max_length=200)
    mobile: str | None = Field(default=None, min_length=5, max_length=32)
    email: EmailStr | None = None
    emirates_id: str | None = Field(default=None, max_length=64)
    passport: str | None = Field(default=None, max_length=64)
    employer: str | None = Field(default=None, max_length=200)
    trade_license: str | None = Field(default=None, max_length=64)


class CustomerMergeRequest(BaseModel):
    primary_customer_id: UUID
