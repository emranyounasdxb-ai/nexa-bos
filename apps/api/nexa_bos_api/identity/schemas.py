from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from nexa_bos_api.identity.enums import EmploymentStatus, VisibilityScope


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class PasswordSetRequest(BaseModel):
    token: str
    password: str


class MfaConfirmRequest(BaseModel):
    code: str


class OwnerBootstrapRequest(BaseModel):
    secret: str = Field(min_length=1)
    full_name: str = Field(min_length=1, max_length=200)
    employee_code: str = Field(min_length=1, max_length=64)
    email: EmailStr
    mobile: str = Field(min_length=5, max_length=32)
    joining_date: date
    employment_status: EmploymentStatus
    password: str
    designation_name: str = Field(min_length=1, max_length=120)
    designation_code: str = Field(min_length=1, max_length=32)


class SecuritySettingsUpdate(BaseModel):
    setup_link_expiry_hours: int | None = Field(default=None, ge=1, le=168)
    lockout_minutes: int | None = Field(default=None, ge=1, le=1440)
    inactivity_timeout_minutes: int | None = Field(default=None, ge=1, le=1440)
    absolute_session_hours: int | None = Field(default=None, ge=1, le=168)


class UserCreateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    employee_code: str = Field(min_length=1, max_length=64)
    email: EmailStr
    mobile: str = Field(min_length=5, max_length=32)
    designation_id: UUID
    employment_status: EmploymentStatus
    joining_date: date
    last_working_date: date | None = None
    office_id: UUID | None = None
    department_id: UUID | None = None
    team_id: UUID | None = None
    reporting_manager_id: UUID | None = None
    user_type_id: UUID | None = None


class UserUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    employee_code: str | None = Field(default=None, min_length=1, max_length=64)
    email: EmailStr | None = None
    mobile: str | None = Field(default=None, min_length=5, max_length=32)
    designation_id: UUID | None = None
    employment_status: EmploymentStatus | None = None
    joining_date: date | None = None
    last_working_date: date | None = None
    office_id: UUID | None = None
    department_id: UUID | None = None
    team_id: UUID | None = None
    reporting_manager_id: UUID | None = None


class RehireRequest(BaseModel):
    joining_date: date
    employment_status: EmploymentStatus
    employee_code: str | None = Field(default=None, min_length=1, max_length=64)
    designation_id: UUID | None = None
    office_id: UUID | None = None
    department_id: UUID | None = None
    team_id: UUID | None = None
    reporting_manager_id: UUID | None = None


class SelfUpdateRequest(BaseModel):
    mobile: str | None = Field(default=None, min_length=5, max_length=32)


class AssignUserTypeRequest(BaseModel):
    user_type_id: UUID


class UserTypeCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=500)
    can_be_reporting_manager: bool = False
    can_be_case_owner: bool = False


class UserTypeUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    can_be_reporting_manager: bool | None = None
    can_be_case_owner: bool | None = None


class AssignPermissionsRequest(BaseModel):
    permissions: list[str]


class AssignScopeRequest(BaseModel):
    visibility_scope: VisibilityScope | None = None


class AssignCustomerScopeRequest(BaseModel):
    customer_visibility_scope: VisibilityScope | None = None


class AssignApplicationScopeRequest(BaseModel):
    application_visibility_scope: VisibilityScope | None = None


class AssignReportingScopeRequest(BaseModel):
    reporting_visibility_scope: VisibilityScope | None = None


class AssignCaseOwnerRequest(BaseModel):
    can_be_case_owner: bool


class MasterCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=32)


class MasterNameUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class DepartmentCreateRequest(MasterCreateRequest):
    office_id: UUID


class TeamCreateRequest(MasterCreateRequest):
    office_id: UUID
    department_id: UUID


class TeamLeaderRequest(BaseModel):
    user_id: UUID | None = None
