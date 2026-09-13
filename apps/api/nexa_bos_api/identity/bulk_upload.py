from __future__ import annotations

import csv
import io
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.employee_profiles.models import EmployeeDocument, HRProfile
from nexa_bos_api.identity.access import is_owner
from nexa_bos_api.identity.assignments import record_assignment
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import (
    AccountStatus,
    AssignmentField,
    EmploymentStatus,
    MasterStatus,
)
from nexa_bos_api.identity.models import (
    BusinessUnit,
    Department,
    Designation,
    EmploymentPeriod,
    Office,
    ReservedEmail,
    ReservedEmployeeCode,
    Team,
    User,
    UserType,
    new_uuid,
)
from nexa_bos_api.identity.schemas import AccountEmail
from nexa_bos_api.identity.users_service import (
    find_email_owner,
    find_employee_code_owner,
    next_user_code,
    reserve_email,
    reserve_employee_code,
    utcnow,
)

MAX_CSV_BYTES = 2 * 1024 * 1024
MAX_CSV_ROWS = 1_000
BULK_IMPORT_LOCK_KEY = 0x4E45584142554C4B  # ASCII: NEXABULK


@dataclass(frozen=True)
class CsvField:
    name: str
    label: str
    required: bool
    format: str
    description: str
    example: str = ""


CSV_FIELDS = (
    CsvField(
        "full_name",
        "Full name",
        True,
        "Text, 1–200 characters",
        "Staff member's full name",
        "Example Staff",
    ),
    CsvField(
        "personal_email",
        "Personal email",
        True,
        "Valid email, maximum 320 characters",
        "Login and personal email; must never have been used before",
        "sample.staff@nexa-bos-sample.com",
    ),
    CsvField(
        "mobile",
        "Mobile",
        True,
        "Text, 5–32 characters",
        "Personal and primary mobile; format as Text in spreadsheets",
        "+971500000000",
    ),
    CsvField(
        "employee_code",
        "Employee code",
        False,
        "Text, maximum 64 characters",
        "Immutable once issued; must never have been used before",
    ),
    CsvField("date_of_joining", "Date of joining", False, "YYYY-MM-DD", "Joining date"),
    CsvField(
        "nationality",
        "Nationality",
        False,
        "Text, maximum 100 characters",
        "HR profile nationality",
    ),
    CsvField("gender", "Gender", False, "Text, maximum 40 characters", "HR profile gender"),
    CsvField(
        "marital_status",
        "Marital status",
        False,
        "Text, maximum 40 characters",
        "HR profile marital status",
    ),
    CsvField(
        "emirates_id_number",
        "Emirates ID number",
        False,
        "Text, maximum 120 characters",
        "Creates an Emirates ID PRO record only when supplied",
    ),
    CsvField(
        "passport_number",
        "Passport number",
        False,
        "Text, maximum 120 characters",
        "Creates a Passport PRO record only when supplied",
    ),
    CsvField(
        "designation_code",
        "Designation code",
        False,
        "Existing active code",
        "Job title/designation; does not grant permissions",
    ),
    CsvField(
        "office_code",
        "Office code",
        False,
        "Existing active code",
        "Required when department, business unit, or team is supplied",
    ),
    CsvField(
        "department_code",
        "Department code",
        False,
        "Existing active code",
        "Must belong to office_code",
    ),
    CsvField(
        "business_unit_code",
        "Business Unit code",
        False,
        "Existing active code",
        "Must belong to office_code and department_code",
    ),
    CsvField(
        "team_code",
        "Team code",
        False,
        "Existing active code",
        "Must match office, department, and supplied Business Unit",
    ),
    CsvField(
        "user_type_code",
        "User Type code",
        False,
        "Existing active non-OWNER code",
        "Permission-bearing User Type; blank keeps Pending Setup unassigned",
    ),
)
CSV_FIELD_NAMES = tuple(field.name for field in CSV_FIELDS)
REQUIRED_FIELD_NAMES = tuple(field.name for field in CSV_FIELDS if field.required)


class StaffCsvRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1, max_length=200)
    personal_email: AccountEmail
    mobile: str = Field(min_length=5, max_length=32)
    employee_code: str | None = Field(default=None, max_length=64)
    date_of_joining: date | None = None
    nationality: str | None = Field(default=None, max_length=100)
    gender: str | None = Field(default=None, max_length=40)
    marital_status: str | None = Field(default=None, max_length=40)
    emirates_id_number: str | None = Field(default=None, max_length=120)
    passport_number: str | None = Field(default=None, max_length=120)
    designation_code: str | None = Field(default=None, max_length=32)
    office_code: str | None = Field(default=None, max_length=32)
    department_code: str | None = Field(default=None, max_length=32)
    business_unit_code: str | None = Field(default=None, max_length=32)
    team_code: str | None = Field(default=None, max_length=32)
    user_type_code: str | None = Field(default=None, max_length=64)

    @field_validator("full_name", "mobile", mode="before")
    @classmethod
    def trim_required(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("personal_email", mode="before")
    @classmethod
    def trim_email(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator(
        "employee_code",
        "nationality",
        "gender",
        "marital_status",
        "emirates_id_number",
        "passport_number",
        "designation_code",
        "office_code",
        "department_code",
        "business_unit_code",
        "team_code",
        "user_type_code",
        mode="before",
    )
    @classmethod
    def blank_to_none(cls, value: object) -> object:
        return value.strip() or None if isinstance(value, str) else value

    @field_validator("date_of_joining", mode="before")
    @classmethod
    def exact_iso_date(cls, value: object) -> object:
        if value in (None, ""):
            return None
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError("must use YYYY-MM-DD")
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("must use YYYY-MM-DD") from exc
        if parsed.isoformat() != value:
            raise ValueError("must use YYYY-MM-DD")
        return parsed


@dataclass
class ResolvedStaffRow:
    row_number: int
    values: StaffCsvRow
    designation_id: UUID | None = None
    office_id: UUID | None = None
    department_id: UUID | None = None
    business_unit_id: UUID | None = None
    team_id: UUID | None = None
    user_type_id: UUID | None = None
    designation_name: str | None = None
    office_name: str | None = None
    department_name: str | None = None
    business_unit_name: str | None = None
    team_name: str | None = None


def field_schema() -> dict[str, object]:
    return {
        "fields": [asdict(field) for field in CSV_FIELDS],
        "limits": {"maxBytes": MAX_CSV_BYTES, "maxRows": MAX_CSV_ROWS},
        "notes": [
            "Optional columns may be omitted or left blank.",
            "Use YYYY-MM-DD for dates; format codes, mobiles, and document numbers as Text.",
            "designation_code is a job title; user_type_code controls permissions. "
            "The ambiguous role header is not accepted.",
            "Blank user_type_code keeps the account Pending Setup and unassigned. "
            "OWNER cannot be assigned.",
        ],
    }


def sample_csv() -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_FIELD_NAMES, lineterminator="\r\n")
    writer.writeheader()
    writer.writerow({field.name: field.example for field in CSV_FIELDS})
    return output.getvalue().encode("utf-8-sig")


def _error(row: int, field: str, message: str) -> dict[str, object]:
    return {"row": row, "field": field, "message": message}


def _parse_csv(
    payload: bytes,
) -> tuple[
    list[tuple[int, StaffCsvRow]],
    list[tuple[int, dict[str, str]]],
    list[dict[str, object]],
]:
    errors: list[dict[str, object]] = []
    if not payload:
        return [], [], [_error(1, "file", "CSV file is empty")]
    if len(payload) > MAX_CSV_BYTES:
        return (
            [],
            [],
            [_error(1, "file", f"CSV file must be {MAX_CSV_BYTES // 1024 // 1024} MB or smaller")],
        )
    if b"\x00" in payload:
        return [], [], [_error(1, "file", "CSV file contains invalid null bytes")]
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [], [_error(1, "file", "CSV file must be UTF-8 encoded")]
    try:
        reader = csv.reader(io.StringIO(text, newline=""), strict=True)
        raw_header = next(reader, None)
    except csv.Error as exc:
        return [], [], [_error(1, "file", f"CSV could not be parsed: {exc}")]
    if raw_header is None:
        return [], [], [_error(1, "header", "CSV header row is required")]
    header = [value.strip() for value in raw_header]
    duplicates = sorted({name for name in header if name and header.count(name) > 1})
    for name in duplicates:
        errors.append(_error(1, name, "Header appears more than once"))
    for name in REQUIRED_FIELD_NAMES:
        if name not in header:
            errors.append(_error(1, name, "Required header is missing"))
    for name in header:
        if not name:
            errors.append(_error(1, "header", "Header names cannot be blank"))
        elif name not in CSV_FIELD_NAMES:
            message = "Unknown header"
            if name == "role":
                message = "Ambiguous role is not accepted; use designation_code or user_type_code"
            errors.append(_error(1, name, message))
    if errors:
        return [], [], errors

    rows: list[tuple[int, StaffCsvRow]] = []
    raw_rows: list[tuple[int, dict[str, str]]] = []
    try:
        for raw in reader:
            row_number = reader.line_num
            if not raw or all(not value.strip() for value in raw):
                continue
            if len(raw_rows) >= MAX_CSV_ROWS:
                errors.append(
                    _error(row_number, "file", f"CSV may contain at most {MAX_CSV_ROWS} data rows")
                )
                break
            if len(raw) != len(header):
                errors.append(
                    _error(
                        row_number, "row", f"Expected {len(header)} columns but found {len(raw)}"
                    )
                )
                continue
            values = {name: value for name, value in zip(header, raw, strict=True)}
            raw_rows.append((row_number, values))
            try:
                rows.append((row_number, StaffCsvRow.model_validate(values)))
            except ValidationError as exc:
                for detail in exc.errors(include_url=False):
                    field = str(detail.get("loc", ("row",))[0])
                    errors.append(_error(row_number, field, str(detail["msg"])))
    except csv.Error as exc:
        errors.append(_error(reader.line_num or 1, "file", f"CSV could not be parsed: {exc}"))
    if not raw_rows and not errors:
        errors.append(_error(1, "file", "CSV must contain at least one staff row"))
    return rows, raw_rows, errors


def _catalog_map(rows: list[Any]) -> dict[str, list[Any]]:
    mapped: dict[str, list[Any]] = defaultdict(list)
    for row in rows:
        mapped[row.code.casefold()].append(row)
    return mapped


async def _resolve_reference(
    code: str | None,
    field: str,
    catalog: dict[str, list[Any]],
    row_number: int,
    errors: list[dict[str, object]],
) -> Any | None:
    if code is None:
        return None
    matches = catalog.get(code.casefold(), [])
    if not matches:
        errors.append(_error(row_number, field, f"No existing record has code '{code}'"))
        return None
    if len(matches) > 1:
        errors.append(
            _error(row_number, field, f"Code '{code}' is ambiguous; correct the master data first")
        )
        return None
    row = matches[0]
    if row.status != MasterStatus.ACTIVE:
        errors.append(_error(row_number, field, f"Code '{code}' is inactive"))
        return None
    return row


async def _catalog_rows(
    session: AsyncSession, model: type[Any], *, lock_references: bool
) -> list[Any]:
    statement = select(model)
    if lock_references:
        statement = statement.with_for_update(read=True)
    return list((await session.scalars(statement)).all())


def _reference_code(raw: dict[str, str], field: str, maximum: int) -> str | None:
    value = raw.get(field, "").strip()
    return value if value and len(value) <= maximum else None


async def validate_staff_csv(
    session: AsyncSession, payload: bytes, *, lock_references: bool = False
) -> dict[str, object]:
    parsed, raw_rows, errors = _parse_csv(payload)
    if not raw_rows:
        return {"valid": False, "rowCount": 0, "errors": errors, "rows": []}

    designations = _catalog_map(
        await _catalog_rows(session, Designation, lock_references=lock_references)
    )
    offices = _catalog_map(await _catalog_rows(session, Office, lock_references=lock_references))
    departments = _catalog_map(
        await _catalog_rows(session, Department, lock_references=lock_references)
    )
    units = _catalog_map(
        await _catalog_rows(session, BusinessUnit, lock_references=lock_references)
    )
    units_by_id = {row.id: row for matches in units.values() for row in matches}
    teams = _catalog_map(await _catalog_rows(session, Team, lock_references=lock_references))
    user_types = _catalog_map(
        await _catalog_rows(session, UserType, lock_references=lock_references)
    )
    seen_emails: dict[str, int] = {}
    seen_employee_codes: dict[str, int] = {}
    resolved_rows: list[ResolvedStaffRow] = []

    email_adapter = TypeAdapter(AccountEmail)
    for row_number, raw in raw_rows:
        raw_email = raw["personal_email"].strip()
        try:
            normalized_email = email_adapter.validate_python(raw_email)
        except ValidationError:
            normalized_email = None
        email_key = str(normalized_email).casefold() if normalized_email else ""
        if not email_key:
            continue
        if email_key in seen_emails:
            errors.append(
                _error(
                    row_number, "personal_email", f"Duplicate of CSV row {seen_emails[email_key]}"
                )
            )
        else:
            seen_emails[email_key] = row_number
            owner = await find_email_owner(session, str(normalized_email))
            reserved = await session.get(ReservedEmail, email_key)
            if owner is not None or reserved is not None:
                errors.append(
                    _error(
                        row_number,
                        "personal_email",
                        "Email is already used, including historical values",
                    )
                )

    for row_number, raw in raw_rows:
        employee_code = raw.get("employee_code", "").strip()
        if employee_code and len(employee_code) <= 64:
            code_key = employee_code.casefold()
            if code_key in seen_employee_codes:
                errors.append(
                    _error(
                        row_number,
                        "employee_code",
                        f"Duplicate of CSV row {seen_employee_codes[code_key]}",
                    )
                )
            else:
                seen_employee_codes[code_key] = row_number
                owner = await find_employee_code_owner(session, employee_code)
                reserved = await session.scalar(
                    select(ReservedEmployeeCode).where(
                        func.lower(ReservedEmployeeCode.employee_code) == code_key
                    )
                )
                if owner is not None or reserved is not None:
                    errors.append(
                        _error(row_number, "employee_code", "Employee Code has already been issued")
                    )

    parsed_by_row = dict(parsed)
    for row_number, raw in raw_rows:
        designation = await _resolve_reference(
            _reference_code(raw, "designation_code", 32),
            "designation_code",
            designations,
            row_number,
            errors,
        )
        office = await _resolve_reference(
            _reference_code(raw, "office_code", 32),
            "office_code",
            offices,
            row_number,
            errors,
        )
        department = await _resolve_reference(
            _reference_code(raw, "department_code", 32),
            "department_code",
            departments,
            row_number,
            errors,
        )
        unit = await _resolve_reference(
            _reference_code(raw, "business_unit_code", 32),
            "business_unit_code",
            units,
            row_number,
            errors,
        )
        team = await _resolve_reference(
            _reference_code(raw, "team_code", 32),
            "team_code",
            teams,
            row_number,
            errors,
        )
        user_type = await _resolve_reference(
            _reference_code(raw, "user_type_code", 64),
            "user_type_code",
            user_types,
            row_number,
            errors,
        )

        if user_type is not None and user_type.code == "OWNER":
            errors.append(
                _error(row_number, "user_type_code", "OWNER cannot be assigned through bulk upload")
            )
            user_type = None
        if department is not None and office is None:
            errors.append(
                _error(
                    row_number,
                    "office_code",
                    "An active office_code is required with department_code",
                )
            )
        elif department is not None and department.office_id != office.id:
            errors.append(
                _error(
                    row_number,
                    "department_code",
                    "Department does not belong to the supplied office",
                )
            )
        if unit is not None:
            if office is None or department is None:
                errors.append(
                    _error(
                        row_number,
                        "business_unit_code",
                        "Business Unit requires office_code and department_code",
                    )
                )
            elif unit.office_id != office.id or unit.department_id != department.id:
                errors.append(
                    _error(
                        row_number,
                        "business_unit_code",
                        "Business Unit does not match the supplied office and department",
                    )
                )
        if team is not None:
            if office is None or department is None:
                errors.append(
                    _error(row_number, "team_code", "Team requires office_code and department_code")
                )
            elif team.office_id != office.id or team.department_id != department.id:
                errors.append(
                    _error(
                        row_number,
                        "team_code",
                        "Team does not match the supplied office and department",
                    )
                )
            elif unit is not None and team.business_unit_id != unit.id:
                errors.append(
                    _error(
                        row_number,
                        "team_code",
                        "Team does not belong to the supplied Business Unit",
                    )
                )

        resolved_unit = unit or (units_by_id.get(team.business_unit_id) if team else None)

        values = parsed_by_row.get(row_number)
        if values is not None:
            resolved_rows.append(
                ResolvedStaffRow(
                    row_number=row_number,
                    values=values,
                    designation_id=designation.id if designation else None,
                    office_id=office.id if office else None,
                    department_id=department.id if department else None,
                    business_unit_id=resolved_unit.id if resolved_unit else None,
                    team_id=team.id if team else None,
                    user_type_id=user_type.id if user_type else None,
                    designation_name=designation.name if designation else None,
                    office_name=office.name if office else None,
                    department_name=department.name if department else None,
                    business_unit_name=resolved_unit.name if resolved_unit else None,
                    team_name=team.name if team else None,
                )
            )
    return {
        "valid": not errors,
        "rowCount": len(raw_rows),
        "errors": errors,
        "rows": resolved_rows,
    }


async def _assignment(
    session: AsyncSession,
    user: User,
    field: AssignmentField,
    value_id: UUID | None,
    value_label: str | None,
) -> None:
    await record_assignment(
        session,
        user_id=user.id,
        field=field,
        value_id=str(value_id) if value_id else None,
        value_label=value_label,
        at=user.created_at,
    )


async def _stage_staff_row(session: AsyncSession, actor: User, row: ResolvedStaffRow) -> User:
    values = row.values
    now = utcnow()
    user = User(
        id=new_uuid(),
        user_code=await next_user_code(session),
        employee_code=values.employee_code,
        full_name=values.full_name,
        email=str(values.personal_email).lower(),
        mobile=values.mobile,
        personal_email=str(values.personal_email).lower(),
        personal_mobile=values.mobile,
        designation_id=row.designation_id,
        employment_status=EmploymentStatus.INACTIVE,
        joining_date=values.date_of_joining,
        office_id=row.office_id,
        department_id=row.department_id,
        business_unit_id=row.business_unit_id,
        team_id=row.team_id,
        user_type_id=row.user_type_id,
        account_status=AccountStatus.PENDING,
        failed_login_count=0,
        mfa_enabled=False,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    await session.flush()
    await reserve_email(session, user.email, user.id)
    if user.employee_code:
        await reserve_employee_code(session, user.employee_code, user.id)
    if user.employee_code and user.joining_date:
        session.add(
            EmploymentPeriod(
                id=new_uuid(),
                user_id=user.id,
                joining_date=user.joining_date,
                employee_code=user.employee_code,
                is_current=True,
                created_at=now,
            )
        )

    reference_values = (
        (AssignmentField.EMPLOYEE_CODE, None, user.employee_code),
        (AssignmentField.DESIGNATION, row.designation_id, row.designation_name),
        (AssignmentField.OFFICE, row.office_id, row.office_name),
        (AssignmentField.DEPARTMENT, row.department_id, row.department_name),
        (AssignmentField.BUSINESS_UNIT, row.business_unit_id, row.business_unit_name),
        (AssignmentField.TEAM, row.team_id, row.team_name),
    )
    for field, value_id, label in reference_values:
        if label:
            await _assignment(session, user, field, value_id, label)

    hr_values = {
        "nationality": values.nationality,
        "gender": values.gender,
        "marital_status": values.marital_status,
    }
    if any(value is not None for value in hr_values.values()):
        session.add(
            HRProfile(
                user_id=user.id,
                created_by_id=actor.id,
                updated_by_id=actor.id,
                created_at=now,
                updated_at=now,
                lock_version=1,
                **hr_values,
            )
        )
        await record_audit(
            session,
            action="user.profile.hr.update",
            entity_type="hr_profile",
            entity_id=str(user.id),
            actor_id=actor.id,
            target_user_id=user.id,
            new_values={
                "changedFields": sorted(
                    key for key, value in hr_values.items() if value is not None
                )
            },
        )

    for kind, number in (
        ("passport", values.passport_number),
        ("emirates_id", values.emirates_id_number),
    ):
        if not number:
            continue
        document = EmployeeDocument(
            id=new_uuid(),
            user_id=user.id,
            record_key=kind,
            kind=kind,
            document_number=number,
            version=1,
            is_active=True,
            created_by_id=actor.id,
            updated_by_id=actor.id,
            created_at=now,
            updated_at=now,
        )
        session.add(document)
        await record_audit(
            session,
            action="user.document.create",
            entity_type="employee_document",
            entity_id=str(document.id),
            actor_id=actor.id,
            target_user_id=user.id,
            new_values={"kind": kind, "recordKey": kind, "version": 1},
        )

    await record_audit(
        session,
        action="user.create",
        entity_type="user",
        entity_id=str(user.id),
        actor_id=actor.id,
        target_user_id=user.id,
        new_values={
            "userCode": user.user_code,
            "email": user.email,
            "employeeCode": user.employee_code,
            "source": "bulk_csv",
        },
    )
    return user


async def import_staff_csv(session: AsyncSession, actor: User, payload: bytes) -> int:
    if not is_owner(actor):
        raise AppError(
            status_code=403, code="OWNER_REQUIRED", message="Only OWNER can bulk upload staff"
        )
    await session.execute(select(func.pg_advisory_xact_lock(BULK_IMPORT_LOCK_KEY)))
    validation = await validate_staff_csv(session, payload, lock_references=True)
    if not validation["valid"]:
        await session.rollback()
        raise AppError(
            status_code=422,
            code="CSV_VALIDATION_FAILED",
            message="CSV validation failed; no staff were imported",
            details=validation["errors"],
        )
    rows = validation["rows"]
    batch_id = str(uuid4())
    try:
        for row in rows:
            await _stage_staff_row(session, actor, row)
        await record_audit(
            session,
            action="user.bulk_import",
            entity_type="staff_bulk_import",
            entity_id=batch_id,
            actor_id=actor.id,
            new_values={"importedCount": len(rows)},
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="BULK_IMPORT_CONFLICT",
            message=(
                "Staff data changed after validation; no staff were imported. "
                "Validate the CSV again."
            ),
        ) from exc
    except Exception:
        await session.rollback()
        raise
    return len(rows)
