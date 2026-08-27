from __future__ import annotations

from enum import StrEnum


class EmploymentStatus(StrEnum):
    ACTIVE = "Active"
    PROBATION = "Probation"
    NOTICE_PERIOD = "Notice Period"
    RESIGNED = "Resigned"
    TERMINATED = "Terminated"
    INACTIVE = "Inactive"


class AccountStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    DEACTIVATED = "deactivated"


class UserTypeStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class MasterStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class VisibilityScope(StrEnum):
    COMPANY = "company"
    OFFICE = "office"
    TEAM = "team"
    OWN = "own"


class TokenPurpose(StrEnum):
    SETUP = "setup"
    RESET = "reset"


class AssignmentField(StrEnum):
    OFFICE = "office"
    DEPARTMENT = "department"
    TEAM = "team"
    DESIGNATION = "designation"
    REPORTING_MANAGER = "reporting_manager"
    EMPLOYMENT_STATUS = "employment_status"
    EMPLOYEE_CODE = "employee_code"


SYSTEM_USER_TYPE_CODES: tuple[str, ...] = (
    "OWNER",
    "GM",
    "BDM",
    "SM",
    "COD",
    "TL",
    "SE",
    "OM",
    "ITM",
    "HR",
    "PRO",
    "AUDITOR",
)

SYSTEM_USER_TYPE_NAMES: dict[str, str] = {
    "OWNER": "Owner",
    "GM": "General Manager",
    "BDM": "Business Development Manager",
    "SM": "Sales Manager",
    "COD": "Chief Operating Director",
    "TL": "Team Leader",
    "SE": "Sales Executive",
    "OM": "Operations Manager",
    "ITM": "IT Manager",
    "HR": "Human Resources",
    "PRO": "Public Relations Officer",
    "AUDITOR": "Auditor",
}

DEFAULT_REPORTING_MANAGER_CODES: frozenset[str] = frozenset(
    {"OWNER", "GM", "BDM", "SM", "OM", "TL"}
)

OWNER_FORBIDDEN_EMPLOYMENT: frozenset[EmploymentStatus] = frozenset(
    {
        EmploymentStatus.RESIGNED,
        EmploymentStatus.TERMINATED,
        EmploymentStatus.INACTIVE,
    }
)

AUTO_DEACTIVATE_EMPLOYMENT: frozenset[EmploymentStatus] = frozenset(
    {
        EmploymentStatus.RESIGNED,
        EmploymentStatus.TERMINATED,
        EmploymentStatus.INACTIVE,
    }
)

REQUIRE_LAST_WORKING: frozenset[EmploymentStatus] = frozenset(
    {EmploymentStatus.RESIGNED, EmploymentStatus.TERMINATED}
)

INITIAL_OFFICES: tuple[tuple[str, str], ...] = (
    ("DXB", "Dubai"),
    ("AUH", "Abu Dhabi"),
)
