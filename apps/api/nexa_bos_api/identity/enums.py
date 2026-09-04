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
    MFA_LOGIN = "mfa_login"


class AssignmentField(StrEnum):
    OFFICE = "office"
    DEPARTMENT = "department"
    TEAM = "team"
    DESIGNATION = "designation"
    REPORTING_MANAGER = "reporting_manager"
    EMPLOYMENT_STATUS = "employment_status"
    EMPLOYEE_CODE = "employee_code"


SYSTEM_USER_TYPE_CODES: tuple[str, ...] = (
    "PENDING",
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
    "PENDING": "Pending Assignment",
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
    {"OWNER", "GM", "BDM", "SM", "COD", "TL"}
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


class CustomerType(StrEnum):
    INDIVIDUAL = "individual"
    COMPANY = "company"


class CustomerStatus(StrEnum):
    ACTIVE = "Active"
    INACTIVE = "Inactive"
    MERGED = "Merged"


class CustomerIdentifierKind(StrEnum):
    EMIRATES_ID = "emirates_id"
    PASSPORT = "passport"
    TRADE_LICENSE = "trade_license"


class CustomerField(StrEnum):
    FULL_NAME = "full_name"
    COMPANY_NAME = "company_name"
    CONTACT_PERSON = "contact_person"
    EMPLOYER = "employer"
    MOBILE = "mobile"
    EMAIL = "email"


INITIAL_BANKS: tuple[tuple[str, str], ...] = (
    ("DIB", "DIB"),
    ("EIB", "EIB"),
    ("SIB", "SIB"),
)

INITIAL_PRODUCTS: tuple[tuple[str, str], ...] = (
    ("PF", "Personal Finance"),
    ("CC", "Credit Card"),
)

INITIAL_PRODUCT_TARGET_MEASUREMENT: dict[str, str] = {
    "PF": "amount",
    "CC": "count",
}

# Bank code → product codes. Additional combinations remain configurable.
INITIAL_BANK_PRODUCTS: tuple[tuple[str, str], ...] = (
    ("DIB", "PF"),
    ("DIB", "CC"),
    ("EIB", "PF"),
    ("EIB", "CC"),
    ("SIB", "PF"),
)


class StageSystemKey(StrEnum):
    APPLICATION_CREATED = "application_created"
    SUBMITTED = "submitted"
    RETURNED = "returned_requirement_pending"
    RESUBMITTED = "resubmitted"
    APPROVED = "approved"
    BOOKED = "booked"
    FUND_RELEASED = "fund_released"


class StageKind(StrEnum):
    ENTRY = "entry"
    NORMAL = "normal"


class TerminalOutcome(StrEnum):
    COMPLETED = "Completed"
    FINAL_REJECTED = "Final Rejected"
    CANCELLED = "Cancelled"
    WITHDRAWN = "Withdrawn"


class ApplicationEventType(StrEnum):
    CREATED = "application_created"
    SUBMISSION = "submission"
    STAGE_MOVED = "stage_moved"
    STAGE_CORRECTED = "stage_corrected"
    RETURNED = "returned_requirement_pending"
    RESUBMISSION = "resubmission"
    APPROVAL = "approval"
    BOOKING = "booking"
    FUND_RELEASE = "fund_release"
    COMPLETED = "completed"
    FINAL_REJECTED = "final_rejected"
    CANCELLED = "cancelled"
    WITHDRAWN = "withdrawn"
    CASE_OWNER_REASSIGNED = "case_owner_reassigned"
    SUBMITTED_DATA_CORRECTED = "submitted_data_corrected"
    CASE_NUMBER_CORRECTED = "case_number_corrected"
    WORKFLOW_MIGRATED = "workflow_migrated"
    CUSTOMER_RELINKED = "customer_relinked"
    DELAY_MARKED = "delay_marked"
    DELAY_CLOSED = "delay_closed"
    DELAY_CORRECTED = "delay_corrected"
    DELAY_CANCELLED = "delay_cancelled"


class DelayType(StrEnum):
    BANK = "Bank"
    CUSTOMER = "Customer"
    INTERNAL = "Internal"
    OTHER = "Other"


class DelayCorrectionAction(StrEnum):
    CORRECT = "correct"
    CANCEL = "cancel"
