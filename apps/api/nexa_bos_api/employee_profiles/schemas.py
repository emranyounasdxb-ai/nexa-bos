from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from nexa_bos_api.identity.enums import EmploymentStatus
from nexa_bos_api.identity.schemas import AccountEmail

DocumentKind = Literal[
    "passport", "visa", "emirates_id", "work_permit", "medical", "insurance", "other"
]


class BasicProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    personal_email: AccountEmail | None = None
    personal_mobile: str | None = Field(default=None, min_length=5, max_length=32)

    @field_validator("full_name", "first_name", "middle_name", "last_name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> object:
        if isinstance(value, str):
            return " ".join(value.split()) or None
        return value

    @model_validator(mode="after")
    def name_required(self) -> BasicProfileUpdate:
        if not self.full_name and not (self.first_name and self.last_name):
            raise ValueError("Full Name is required")
        return self


class HRProfileUpdate(BaseModel):
    employee_code: str | None = Field(default=None, min_length=1, max_length=64)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=40)
    nationality: str | None = Field(default=None, max_length=100)
    marital_status: str | None = Field(default=None, max_length=40)
    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_relationship: str | None = Field(default=None, max_length=100)
    emergency_contact_mobile: str | None = Field(default=None, max_length=32)
    employee_status: EmploymentStatus | None = None
    employee_type: str | None = Field(default=None, max_length=80)
    employment_type: str | None = Field(default=None, max_length=80)
    joining_date: date | None = None
    probation_end_date: date | None = None
    job_title: str | None = Field(default=None, max_length=160)
    department_id: UUID | None = None
    business_unit: str | None = Field(default=None, max_length=160)
    location: str | None = Field(default=None, max_length=160)
    reporting_manager_id: UUID | None = None
    work_email: AccountEmail | None = None
    work_mobile: str | None = Field(default=None, max_length=32)
    employee_grade: str | None = Field(default=None, max_length=80)
    basic_salary: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    housing_allowance: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    transport_allowance: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    other_allowances: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    payment_method: str | None = Field(default=None, max_length=80)
    bank_name: str | None = Field(default=None, max_length=160)
    bank_account_name: str | None = Field(default=None, max_length=200)
    iban: str | None = Field(default=None, max_length=34)
    bank_account_number: str | None = Field(default=None, max_length=80)
    hr_notes: str | None = Field(default=None, max_length=4000)
    lock_version: int | None = Field(default=None, ge=1)

    @field_validator(
        "gender",
        "nationality",
        "marital_status",
        "emergency_contact_name",
        "emergency_contact_relationship",
        "emergency_contact_mobile",
        "employee_status",
        "employee_type",
        "employment_type",
        "job_title",
        "business_unit",
        "location",
        "work_mobile",
        "employee_grade",
        "payment_method",
        "bank_name",
        "bank_account_name",
        "iban",
        "bank_account_number",
        "hr_notes",
        mode="before",
    )
    @classmethod
    def blank_to_none(cls, value: object) -> object:
        return value.strip() or None if isinstance(value, str) else value

    @field_validator("date_of_birth")
    @classmethod
    def birth_date_not_future(cls, value: date | None) -> date | None:
        if value and value >= date.today():
            raise ValueError("Date of birth must be before today")
        return value

    @field_validator("iban")
    @classmethod
    def normalize_iban(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = "".join(value.split()).upper()
        if len(normalized) < 15 or not normalized.isalnum():
            raise ValueError("IBAN must contain 15 to 34 letters or digits")
        return normalized

    @model_validator(mode="after")
    def valid_probation_window(self) -> HRProfileUpdate:
        if self.joining_date and self.probation_end_date:
            if self.probation_end_date < self.joining_date:
                raise ValueError("Probation end date cannot be before joining date")
        return self


class EmployeeDocumentCreate(BaseModel):
    kind: DocumentKind
    name: str | None = Field(default=None, max_length=160)
    document_number: str | None = Field(default=None, max_length=120)
    visa_type: str | None = Field(default=None, max_length=100)
    medical_status: str | None = Field(default=None, max_length=80)
    insurance_provider: str | None = Field(default=None, max_length=160)
    expiry_date: date | None = None
    declared_status: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator(
        "name",
        "document_number",
        "visa_type",
        "medical_status",
        "insurance_provider",
        "declared_status",
        "notes",
        mode="before",
    )
    @classmethod
    def blank_to_none(cls, value: object) -> object:
        return value.strip() or None if isinstance(value, str) else value

    @model_validator(mode="after")
    def kind_fields(self) -> EmployeeDocumentCreate:
        if self.kind == "other" and not self.name:
            raise ValueError("Other documents require a name")
        if self.kind == "visa" and not self.visa_type:
            raise ValueError("Visa / Residence records require a type")
        if self.kind == "medical" and not self.medical_status:
            raise ValueError("Medical / Fitness records require a medical status")
        if self.kind == "insurance" and not self.insurance_provider:
            raise ValueError("Health Insurance records require a provider")
        return self


class EmployeeDocumentUpdate(EmployeeDocumentCreate):
    replacement_reason: str = Field(min_length=3, max_length=500)


class DocumentActionRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
