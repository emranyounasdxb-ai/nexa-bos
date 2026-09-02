from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from nexa_bos_api.identity.schemas import MasterCreateRequest, MasterNameUpdateRequest


class BankCreateRequest(MasterCreateRequest):
    pass


class BankNameUpdateRequest(MasterNameUpdateRequest):
    pass


class ProductCreateRequest(MasterCreateRequest):
    pass


class ProductNameUpdateRequest(MasterNameUpdateRequest):
    pass


class BankProductCreateRequest(BaseModel):
    bank_id: UUID
    product_id: UUID


class ProductFieldRulesUpdate(BaseModel):
    requested_amount_required: bool | None = None
    approved_amount_required: bool | None = None
    booked_amount_required: bool | None = None
    funded_amount_required: bool | None = None
    target_measurement: str | None = None


class ProductVariantCreateRequest(BaseModel):
    bank_product_id: UUID
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=32)
    description: str | None = Field(default=None, max_length=500)


class ProductVariantUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
