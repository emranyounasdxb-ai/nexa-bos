from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

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
