from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from nexa_bos_api.assets.enums import AssetCondition, AssetReport, AssetStatus


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CategoryFieldInput(StrictRequest):
    key: str = Field(min_length=1, max_length=40, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=120)
    required: bool = False


class AssetCategoryCreateRequest(StrictRequest):
    code: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    fields: list[CategoryFieldInput] = Field(default_factory=list, max_length=50)


class AssetCategoryUpdateRequest(StrictRequest):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    fields: list[CategoryFieldInput] | None = Field(default=None, max_length=50)


class AssetCreateRequest(StrictRequest):
    category_id: UUID
    office_id: UUID
    condition: AssetCondition
    brand: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    serial_number: str | None = Field(default=None, max_length=160)
    imei: str | None = Field(default=None, max_length=32)
    iccid: str | None = Field(default=None, max_length=64)
    mobile_number: str | None = Field(default=None, max_length=32)
    operator: str | None = Field(default=None, max_length=120)
    attributes: dict[str, str] = Field(default_factory=dict)
    description: str | None = Field(default=None, max_length=4000)

    @field_validator("attributes")
    @classmethod
    def validate_attributes(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 50:
            raise ValueError("No more than 50 additional attributes are allowed")
        for key, item in value.items():
            if (
                not key
                or len(key) > 40
                or key != key.lower()
                or not key.replace("_", "a").isalnum()
            ):
                raise ValueError(
                    "Attribute keys must use lowercase letters, numbers, and underscores"
                )
            if len(item) > 500:
                raise ValueError("Attribute values must be 500 characters or fewer")
        return value


class AssetMasterUpdateRequest(StrictRequest):
    category_id: UUID | None = None
    brand: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    mobile_number: str | None = Field(default=None, max_length=32)
    operator: str | None = Field(default=None, max_length=120)
    attributes: dict[str, str] | None = None
    description: str | None = Field(default=None, max_length=4000)

    @field_validator("attributes")
    @classmethod
    def validate_attributes(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is None:
            return None
        return AssetCreateRequest.validate_attributes(value)


class IdentifierCorrectionRequest(StrictRequest):
    serial_number: str | None = Field(default=None, max_length=160)
    imei: str | None = Field(default=None, max_length=32)
    iccid: str | None = Field(default=None, max_length=64)
    reason: str = Field(min_length=1, max_length=2000)


class AssetConditionCorrectionRequest(StrictRequest):
    condition: AssetCondition
    reason: str = Field(min_length=1, max_length=2000)


class AssetAllocationRequest(StrictRequest):
    employee_id: UUID
    issue_date: date
    condition_at_issue: AssetCondition
    remarks: str | None = Field(default=None, max_length=4000)


class AssetReturnRequest(StrictRequest):
    return_date: date
    return_condition: AssetCondition
    remarks: str | None = Field(default=None, max_length=4000)


class EmployeeTransferRequest(StrictRequest):
    employee_id: UUID
    transfer_date: date
    condition: AssetCondition
    remarks: str | None = Field(default=None, max_length=4000)


class OfficeTransferRequest(StrictRequest):
    office_id: UUID
    transfer_date: date
    remarks: str | None = Field(default=None, max_length=4000)


class AssetStatusRequest(StrictRequest):
    status: AssetStatus
    reason: str = Field(min_length=1, max_length=2000)


class AssetReportExportRequest(StrictRequest):
    format: str = Field(pattern=r"^(xlsx|pdf|print)$")
    report: AssetReport
    office_id: UUID | None = None
    employee_id: UUID | None = None
    category_id: UUID | None = None
