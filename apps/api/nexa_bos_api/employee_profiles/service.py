from __future__ import annotations

import io
import uuid
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.exc import StaleDataError

from nexa_bos_api.attendance.enums import BUSINESS_TZ
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.employee_profiles.models import EmployeeDocument, HRProfile
from nexa_bos_api.employee_profiles.schemas import (
    BasicProfileUpdate,
    EmployeeDocumentCreate,
    EmployeeDocumentUpdate,
    HRProfileUpdate,
)
from nexa_bos_api.identity.access import has_permission, visible_user_ids
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.auth_service import public_user
from nexa_bos_api.identity.models import AuditEvent, User, new_uuid
from nexa_bos_api.identity.permissions import (
    USER_DOCUMENTS_DELETE,
    USER_DOCUMENTS_DOWNLOAD,
    USER_DOCUMENTS_HISTORY,
    USER_DOCUMENTS_PURGE,
    USER_DOCUMENTS_REPLACE,
    USER_DOCUMENTS_UPLOAD,
    USER_DOCUMENTS_VIEW,
    USER_PROFILES_BASIC_UPDATE,
    USER_PROFILES_BASIC_VIEW,
    USER_PROFILES_HR_UPDATE,
    USER_PROFILES_HR_VIEW,
    USER_PROFILES_PRO_UPDATE,
    USER_PROFILES_PRO_VIEW,
    USERS_EDIT,
    USERS_VIEW,
)
from nexa_bos_api.identity.users_service import (
    get_visible_user,
    update_user,
)

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
REQUIRED_DOCUMENT_KINDS = (
    "passport",
    "visa",
    "emirates_id",
    "work_permit",
    "medical",
    "insurance",
)
DOCUMENT_LABELS = {
    "passport": "Passport",
    "visa": "Visa / Residence",
    "emirates_id": "Emirates ID",
    "work_permit": "Labour Card / Work Permit",
    "medical": "Medical / Fitness",
    "insurance": "Health Insurance",
    "other": "Other Document",
}
_MIME_EXTENSIONS = {
    "application/pdf": {".pdf"},
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/webp": {".webp"},
}
_IMAGE_FORMAT_MIME = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def _now() -> datetime:
    return datetime.now(UTC)


def _today() -> date:
    return datetime.now(BUSINESS_TZ).date()


def _money(value: Decimal | None) -> str | None:
    return f"{value:.2f}" if value is not None else None


def _completion(required: dict[str, object]) -> dict[str, object]:
    completed = sum(value is not None and value != "" for value in required.values())
    total = len(required)
    state = "Complete" if completed == total else "Pending" if completed == 0 else "In Progress"
    return {
        "state": state,
        "completed": completed,
        "required": total,
        "missing": [label for label, value in required.items() if value is None or value == ""],
    }


def _derived_document_status(row: EmployeeDocument, *, today: date | None = None) -> str:
    current = today or _today()
    if row.expiry_date is None:
        return "Missing"
    remaining = (row.expiry_date - current).days
    if remaining < 0:
        return "Expired"
    if remaining < 60:
        return "Expiring Soon"
    return "Active"


def _basic_completion(user: User) -> dict[str, object]:
    return _completion(
        {
            "Full name": user.full_name,
            "Personal email": user.personal_email,
            "Personal mobile": user.personal_mobile,
            "User code": user.user_code,
        }
    )


def _hr_completion(user: User, row: HRProfile | None) -> dict[str, object]:
    if row is None:
        return _completion({label: None for label in _HR_REQUIRED_LABELS})
    return _completion(
        {
            "Date of birth": row.date_of_birth,
            "Gender": row.gender,
            "Nationality": row.nationality,
            "Marital status": row.marital_status,
            "Emergency contact name": row.emergency_contact_name,
            "Emergency contact relationship": row.emergency_contact_relationship,
            "Emergency contact mobile": row.emergency_contact_mobile,
            "Employee status": user.employment_status,
            "Employee type": row.employee_type,
            "Employment type": row.employment_type,
            "Joining date": user.joining_date,
            "Job title": row.job_title,
            "Business unit": row.business_unit,
            "Location": row.location,
            "Work email": user.work_email,
            "Work mobile": user.work_mobile,
            "Employee grade": row.employee_grade,
            "Basic salary": row.basic_salary,
            "Payment method": row.payment_method,
            "Bank name": row.bank_name,
            "Bank account name": row.bank_account_name,
            "IBAN": row.iban,
            "Bank account number": row.bank_account_number,
        }
    )


_HR_REQUIRED_LABELS = (
    "Date of birth",
    "Gender",
    "Nationality",
    "Marital status",
    "Emergency contact name",
    "Emergency contact relationship",
    "Emergency contact mobile",
    "Employee status",
    "Employee type",
    "Employment type",
    "Joining date",
    "Job title",
    "Business unit",
    "Location",
    "Work email",
    "Work mobile",
    "Employee grade",
    "Basic salary",
    "Payment method",
    "Bank name",
    "Bank account name",
    "IBAN",
    "Bank account number",
)


def _pro_completion(rows: list[EmployeeDocument]) -> dict[str, object]:
    active = {row.kind: row for row in rows if row.is_active and row.kind != "other"}
    required: dict[str, object] = {}
    for kind in REQUIRED_DOCUMENT_KINDS:
        row = active.get(kind)
        required[DOCUMENT_LABELS[kind]] = (
            row
            if row
            and row.expiry_date
            and row.storage_key
            and (
                row.document_number
                or (kind == "medical" and row.medical_status)
                or (kind == "insurance" and row.document_number and row.insurance_provider)
            )
            else None
        )
    return _completion(required)


def _actor_payload(user: object | None) -> dict[str, str] | None:
    if not isinstance(user, User):
        return None
    return {"id": str(user.id), "name": user.full_name, "userCode": user.user_code}


def _hr_payload(
    user: User,
    row: HRProfile | None,
    *,
    include_sensitive: bool,
    reporting_manager: User | None,
) -> dict[str, object] | None:
    if row is None:
        return None
    allowances = [row.housing_allowance, row.transport_allowance, row.other_allowances]
    gross = (row.basic_salary or Decimal("0")) + sum(
        (value or Decimal("0") for value in allowances), Decimal("0")
    )
    return {
        "dateOfBirth": row.date_of_birth.isoformat() if row.date_of_birth else None,
        "gender": row.gender,
        "nationality": row.nationality,
        "maritalStatus": row.marital_status,
        "emergencyContactName": row.emergency_contact_name,
        "emergencyContactRelationship": row.emergency_contact_relationship,
        "emergencyContactMobile": row.emergency_contact_mobile,
        "employeeStatus": user.employment_status,
        "employeeType": row.employee_type,
        "employmentType": row.employment_type,
        "joiningDate": user.joining_date.isoformat() if user.joining_date else None,
        "employeeCode": user.employee_code,
        "probationEndDate": row.probation_end_date.isoformat() if row.probation_end_date else None,
        "jobTitle": row.job_title,
        "department": (
            {
                "id": str(user.department.id),
                "code": user.department.code,
                "name": user.department.name,
            }
            if user.department
            else None
        ),
        "businessUnit": row.business_unit,
        "location": row.location,
        "reportingManagerId": str(user.reporting_manager_id) if user.reporting_manager_id else None,
        "reportingManager": _actor_payload(reporting_manager),
        "workEmail": user.work_email,
        "workMobile": user.work_mobile,
        "employeeGrade": row.employee_grade,
        "basicSalary": _money(row.basic_salary) if include_sensitive else None,
        "housingAllowance": _money(row.housing_allowance) if include_sensitive else None,
        "transportAllowance": _money(row.transport_allowance) if include_sensitive else None,
        "otherAllowances": _money(row.other_allowances) if include_sensitive else None,
        "grossSalary": _money(gross) if include_sensitive else None,
        "paymentMethod": row.payment_method if include_sensitive else None,
        "bankName": row.bank_name if include_sensitive else None,
        "bankAccountName": row.bank_account_name if include_sensitive else None,
        "iban": row.iban if include_sensitive else None,
        "bankAccountNumber": row.bank_account_number if include_sensitive else None,
        "hrNotes": row.hr_notes if include_sensitive else None,
        "lockVersion": row.lock_version,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
        "lastUpdatedBy": _actor_payload(row.updated_by),
    }


def _document_payload(
    row: EmployeeDocument, *, include_attachment_metadata: bool
) -> dict[str, object]:
    today = _today()
    return {
        "id": str(row.id),
        "recordKey": row.record_key,
        "kind": row.kind,
        "label": row.name or DOCUMENT_LABELS[row.kind],
        "name": row.name,
        "documentNumber": row.document_number,
        "visaType": row.visa_type,
        "medicalStatus": row.medical_status,
        "insuranceProvider": row.insurance_provider,
        "expiryDate": row.expiry_date.isoformat() if row.expiry_date else None,
        "status": _derived_document_status(row, today=today),
        "declaredStatus": row.declared_status,
        "remainingDays": (row.expiry_date - today).days if row.expiry_date else None,
        "notes": row.notes,
        "hasAttachment": bool(row.storage_key),
        "originalFilename": row.original_filename if include_attachment_metadata else None,
        "contentType": row.content_type if include_attachment_metadata else None,
        "sizeBytes": row.size_bytes if include_attachment_metadata else None,
        "version": row.version,
        "isActive": row.is_active,
        "replacementReason": row.replacement_reason,
        "uploadedAt": row.uploaded_at.isoformat() if row.uploaded_at else None,
        "uploadedBy": _actor_payload(row.uploaded_by),
        "updatedAt": row.updated_at.isoformat(),
        "lastUpdatedBy": _actor_payload(row.updated_by),
    }


async def _load_profile_rows(
    session: AsyncSession, user_id: uuid.UUID
) -> tuple[HRProfile | None, list[EmployeeDocument]]:
    hr = await session.scalar(
        select(HRProfile)
        .options(selectinload(HRProfile.updated_by))
        .where(HRProfile.user_id == user_id)
    )
    documents = list(
        (
            await session.scalars(
                select(EmployeeDocument)
                .options(
                    selectinload(EmployeeDocument.updated_by),
                    selectinload(EmployeeDocument.uploaded_by),
                )
                .where(EmployeeDocument.user_id == user_id, EmployeeDocument.is_active.is_(True))
                .order_by(EmployeeDocument.kind, EmployeeDocument.created_at)
            )
        ).all()
    )
    return hr, documents


async def get_profile(session: AsyncSession, actor: User, user_id: uuid.UUID) -> dict[str, object]:
    target = await get_visible_user(session, actor, user_id)
    self_view = actor.id == target.id
    basic_visible = (
        self_view
        or has_permission(actor, USER_PROFILES_BASIC_VIEW)
        or has_permission(actor, USERS_VIEW)
    )
    hr_visible = self_view or has_permission(actor, USER_PROFILES_HR_VIEW)
    pro_visible = self_view or has_permission(actor, USER_PROFILES_PRO_VIEW)
    if not any((basic_visible, hr_visible, pro_visible)):
        raise AppError(status_code=403, code="FORBIDDEN", message="Profile access is not permitted")
    hr, documents = await _load_profile_rows(session, target.id)
    reporting_manager = (
        await session.get(User, target.reporting_manager_id)
        if target.reporting_manager_id
        else None
    )
    include_attachment_metadata = has_permission(actor, USER_DOCUMENTS_VIEW)
    basic_payload = public_user(target)
    basic_payload.pop("permissions", None)
    basic_payload.pop("csrfToken", None)
    return {
        "revision": max(
            [target.updated_at, hr.updated_at if hr else target.updated_at]
            + [row.updated_at for row in documents]
        ).isoformat(),
        "isSelf": self_view,
        "canUpdateBasic": has_permission(actor, USER_PROFILES_BASIC_UPDATE)
        or has_permission(actor, USERS_EDIT),
        "canUpdateHr": has_permission(actor, USER_PROFILES_HR_UPDATE),
        "canUpdatePro": has_permission(actor, USER_PROFILES_PRO_UPDATE),
        "canViewAttachments": include_attachment_metadata,
        "documentPermissions": {
            "upload": has_permission(actor, USER_DOCUMENTS_UPLOAD),
            "replace": has_permission(actor, USER_DOCUMENTS_REPLACE),
            "view": has_permission(actor, USER_DOCUMENTS_VIEW),
            "download": has_permission(actor, USER_DOCUMENTS_DOWNLOAD),
            "delete": has_permission(actor, USER_DOCUMENTS_DELETE),
            "history": has_permission(actor, USER_DOCUMENTS_HISTORY),
            "purge": has_permission(actor, USER_DOCUMENTS_PURGE),
        },
        "basic": (
            {
                **basic_payload,
                "completion": _basic_completion(target),
                "lastUpdatedAt": target.updated_at.isoformat(),
            }
            if basic_visible
            else None
        ),
        "hr": (
            {
                "employeeCode": target.employee_code,
                "workEmail": target.work_email,
                "workMobile": target.work_mobile,
                "data": _hr_payload(
                    target,
                    hr,
                    include_sensitive=has_permission(actor, USER_PROFILES_HR_VIEW),
                    reporting_manager=reporting_manager,
                ),
                "completion": _hr_completion(target, hr),
            }
            if hr_visible
            else None
        ),
        "pro": (
            {
                "documents": [
                    _document_payload(row, include_attachment_metadata=include_attachment_metadata)
                    for row in documents
                ],
                "completion": _pro_completion(documents),
            }
            if pro_visible
            else None
        ),
    }


async def update_basic_profile(
    session: AsyncSession, actor: User, user_id: uuid.UUID, payload: BasicProfileUpdate
) -> dict[str, object]:
    if not (has_permission(actor, USER_PROFILES_BASIC_UPDATE) or has_permission(actor, USERS_EDIT)):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Basic profile update is not permitted"
        )
    target = await get_visible_user(session, actor, user_id)
    old = {
        "firstName": target.first_name,
        "middleName": target.middle_name,
        "lastName": target.last_name,
        "personalEmail": target.personal_email,
        "personalMobile": target.personal_mobile,
    }
    derived = " ".join(
        value for value in (payload.first_name, payload.middle_name, payload.last_name) if value
    )
    if payload.full_name:
        target.full_name = payload.full_name
    else:
        target.first_name = payload.first_name
        target.middle_name = payload.middle_name
        target.last_name = payload.last_name
        target.full_name = derived
    target.personal_email = str(payload.personal_email).lower() if payload.personal_email else None
    target.personal_mobile = payload.personal_mobile
    target.updated_at = _now()
    await record_audit(
        session,
        action="user.profile.basic.update",
        entity_type="user_profile",
        entity_id=str(target.id),
        actor_id=actor.id,
        target_user_id=target.id,
        old_values={"changedFields": [key for key, value in old.items() if value is not None]},
        new_values={"changedFields": list(old)},
    )
    await session.commit()
    return await get_profile(session, actor, target.id)


async def update_hr_profile(
    session: AsyncSession, actor: User, user_id: uuid.UUID, payload: HRProfileUpdate
) -> dict[str, object]:
    if not has_permission(actor, USER_PROFILES_HR_UPDATE):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="HR profile update is not permitted"
        )
    target = await get_visible_user(session, actor, user_id)
    await session.refresh(target, with_for_update=True)
    row = await session.scalar(
        select(HRProfile).where(HRProfile.user_id == target.id).with_for_update()
    )
    if row and payload.lock_version is not None and row.lock_version != payload.lock_version:
        raise AppError(
            status_code=409,
            code="PROFILE_CONFLICT",
            message=(
                "This HR profile was updated by another user. Reload and review the latest values."
            ),
        )
    now = _now()
    if row is None:
        row = HRProfile(
            user_id=target.id,
            created_by_id=actor.id,
            updated_by_id=actor.id,
            created_at=now,
            updated_at=now,
            lock_version=1,
        )
        session.add(row)
    changed_fields = [name for name in payload.model_fields_set if name not in {"lock_version"}]
    canonical_update: dict[str, object] = {}
    if payload.employee_code:
        canonical_update["employee_code"] = payload.employee_code.strip()
    if "employee_status" in payload.model_fields_set and payload.employee_status is not None:
        canonical_update["employment_status"] = payload.employee_status
    if "joining_date" in payload.model_fields_set and payload.joining_date is not None:
        canonical_update["joining_date"] = payload.joining_date
    if "department_id" in payload.model_fields_set:
        canonical_update["department_id"] = payload.department_id
        canonical_update["office_id"] = target.office_id
        if payload.department_id != target.department_id:
            canonical_update["team_id"] = None
            canonical_update["business_unit_id"] = None
    if "reporting_manager_id" in payload.model_fields_set:
        canonical_update["reporting_manager_id"] = payload.reporting_manager_id
    if "work_email" in payload.model_fields_set:
        target.work_email = str(payload.work_email).lower() if payload.work_email else None
    if "work_mobile" in payload.model_fields_set:
        target.work_mobile = payload.work_mobile
    if canonical_update:
        from nexa_bos_api.identity.schemas import UserUpdateRequest

        target = await update_user(
            session,
            actor,
            target,
            UserUpdateRequest(**canonical_update),
            commit=False,
        )
    if target.employee_code and target.joining_date:
        from nexa_bos_api.identity.models import EmploymentPeriod

        period = await session.scalar(
            select(EmploymentPeriod).where(EmploymentPeriod.user_id == target.id).limit(1)
        )
        if period is None:
            session.add(
                EmploymentPeriod(
                    user_id=target.id,
                    employee_code=target.employee_code,
                    joining_date=target.joining_date,
                    is_current=True,
                    created_at=now,
                )
            )
    profile_fields = {
        "date_of_birth",
        "gender",
        "nationality",
        "marital_status",
        "emergency_contact_name",
        "emergency_contact_relationship",
        "emergency_contact_mobile",
        "employee_type",
        "employment_type",
        "probation_end_date",
        "job_title",
        "business_unit",
        "location",
        "employee_grade",
        "basic_salary",
        "housing_allowance",
        "transport_allowance",
        "other_allowances",
        "payment_method",
        "bank_name",
        "bank_account_name",
        "iban",
        "bank_account_number",
        "hr_notes",
    }
    for field in profile_fields & payload.model_fields_set:
        setattr(row, field, getattr(payload, field))
    row.updated_by_id = actor.id
    row.updated_at = now
    await record_audit(
        session,
        action="user.profile.hr.update",
        entity_type="hr_profile",
        entity_id=str(target.id),
        actor_id=actor.id,
        target_user_id=target.id,
        new_values={"changedFields": sorted(changed_fields)},
    )
    try:
        await session.commit()
    except StaleDataError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="PROFILE_CONFLICT",
            message="This HR profile was updated by another user. Reload and try again.",
        ) from exc
    return await get_profile(session, actor, target.id)


def _document_root() -> Path:
    root = (get_settings().file_storage_dir / "employee-documents").resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _document_path(storage_key: str) -> Path:
    root = _document_root()
    path = (root / storage_key).resolve()
    if root not in path.parents:
        raise AppError(
            status_code=400, code="DOCUMENT_PATH_INVALID", message="Invalid document path"
        )
    return path


async def validate_document_upload(upload: UploadFile) -> tuple[bytes, str, str]:
    declared = (upload.content_type or "").split(";", 1)[0].strip().lower()
    suffix = Path((upload.filename or "").replace("\\", "/")).suffix.lower()
    if declared not in _MIME_EXTENSIONS or suffix not in _MIME_EXTENSIONS[declared]:
        raise AppError(
            status_code=422,
            code="DOCUMENT_TYPE_INVALID",
            message="Document must be PDF, JPG/JPEG, PNG, or WebP with matching type and extension",
        )
    payload = await upload.read(MAX_DOCUMENT_BYTES + 1)
    if not payload:
        raise AppError(status_code=422, code="DOCUMENT_EMPTY", message="Document is empty")
    if len(payload) > MAX_DOCUMENT_BYTES:
        raise AppError(
            status_code=422, code="DOCUMENT_TOO_LARGE", message="Document must be 10 MB or smaller"
        )
    if declared == "application/pdf":
        if not payload.startswith(b"%PDF-") or b"%%EOF" not in payload[-2048:]:
            raise AppError(
                status_code=422,
                code="DOCUMENT_CONTENT_INVALID",
                message="The uploaded file is not a valid PDF",
            )
    else:
        try:
            with Image.open(io.BytesIO(payload)) as image:
                actual = _IMAGE_FORMAT_MIME.get(image.format or "")
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise AppError(
                status_code=422,
                code="DOCUMENT_CONTENT_INVALID",
                message="The uploaded file is not a valid image",
            ) from exc
        if actual != declared:
            raise AppError(
                status_code=422,
                code="DOCUMENT_CONTENT_MISMATCH",
                message="Document content does not match its declared type",
            )
    return payload, declared, suffix


async def create_document(
    session: AsyncSession,
    actor: User,
    user_id: uuid.UUID,
    payload: EmployeeDocumentCreate,
) -> dict[str, object]:
    if not has_permission(actor, USER_PROFILES_PRO_UPDATE):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="PRO profile update is not permitted"
        )
    target = await get_visible_user(session, actor, user_id)
    record_key = payload.kind if payload.kind != "other" else str(new_uuid())
    current = await session.scalar(
        select(EmployeeDocument).where(
            EmployeeDocument.user_id == target.id,
            EmployeeDocument.record_key == record_key,
            EmployeeDocument.is_active.is_(True),
        )
    )
    if current:
        raise AppError(
            status_code=409,
            code="DOCUMENT_EXISTS",
            message=f"An active {DOCUMENT_LABELS[payload.kind]} record already exists",
        )
    previous_version = await session.scalar(
        select(func.max(EmployeeDocument.version)).where(
            EmployeeDocument.user_id == target.id,
            EmployeeDocument.record_key == record_key,
        )
    )
    now = _now()
    row = EmployeeDocument(
        id=new_uuid(),
        user_id=target.id,
        record_key=record_key,
        version=(previous_version or 0) + 1,
        is_active=True,
        created_by_id=actor.id,
        updated_by_id=actor.id,
        created_at=now,
        updated_at=now,
        **payload.model_dump(),
    )
    session.add(row)
    await record_audit(
        session,
        action="user.document.create",
        entity_type="employee_document",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=target.id,
        new_values={"kind": row.kind, "recordKey": row.record_key, "version": row.version},
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="DOCUMENT_EXISTS",
            message=f"An active {DOCUMENT_LABELS[payload.kind]} record already exists",
        ) from exc
    await session.refresh(row)
    return _document_payload(row, include_attachment_metadata=True)


async def _active_document(
    session: AsyncSession,
    actor: User,
    user_id: uuid.UUID,
    document_id: uuid.UUID,
    *,
    lock: bool = False,
) -> tuple[User, EmployeeDocument]:
    target = await get_visible_user(session, actor, user_id)
    stmt = select(EmployeeDocument).where(
        EmployeeDocument.id == document_id,
        EmployeeDocument.user_id == target.id,
        EmployeeDocument.is_active.is_(True),
    )
    if lock:
        stmt = stmt.with_for_update()
    row = await session.scalar(stmt)
    if row is None:
        raise AppError(status_code=404, code="DOCUMENT_NOT_FOUND", message="Document not found")
    return target, row


def _clone_document(
    current: EmployeeDocument,
    actor: User,
    *,
    now: datetime,
    values: dict[str, object] | None = None,
    replacement_reason: str,
) -> EmployeeDocument:
    fields = {
        "kind": current.kind,
        "name": current.name,
        "document_number": current.document_number,
        "visa_type": current.visa_type,
        "medical_status": current.medical_status,
        "insurance_provider": current.insurance_provider,
        "expiry_date": current.expiry_date,
        "declared_status": current.declared_status,
        "notes": current.notes,
        "storage_key": current.storage_key,
        "original_filename": current.original_filename,
        "content_type": current.content_type,
        "size_bytes": current.size_bytes,
        "uploaded_by_id": current.uploaded_by_id,
        "uploaded_at": current.uploaded_at,
    }
    fields.update(values or {})
    current.is_active = False
    current.updated_by_id = actor.id
    current.updated_at = now
    return EmployeeDocument(
        id=new_uuid(),
        user_id=current.user_id,
        record_key=current.record_key,
        version=current.version + 1,
        is_active=True,
        replacement_reason=replacement_reason,
        created_by_id=actor.id,
        updated_by_id=actor.id,
        created_at=now,
        updated_at=now,
        **fields,
    )


async def update_document_metadata(
    session: AsyncSession,
    actor: User,
    user_id: uuid.UUID,
    document_id: uuid.UUID,
    payload: EmployeeDocumentUpdate,
) -> dict[str, object]:
    if not has_permission(actor, USER_PROFILES_PRO_UPDATE):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="PRO profile update is not permitted"
        )
    target, current = await _active_document(session, actor, user_id, document_id, lock=True)
    if payload.kind != current.kind:
        raise AppError(
            status_code=422, code="DOCUMENT_KIND_IMMUTABLE", message="Document kind cannot change"
        )
    now = _now()
    values = payload.model_dump(exclude={"replacement_reason"})
    replacement = _clone_document(
        current, actor, now=now, values=values, replacement_reason=payload.replacement_reason
    )
    session.add(replacement)
    await record_audit(
        session,
        action="user.document.metadata.replace",
        entity_type="employee_document",
        entity_id=str(replacement.id),
        actor_id=actor.id,
        target_user_id=target.id,
        new_values={
            "kind": replacement.kind,
            "version": replacement.version,
            "changedFields": sorted(values),
        },
        note=payload.replacement_reason,
    )
    await session.commit()
    await session.refresh(replacement)
    return _document_payload(replacement, include_attachment_metadata=True)


async def upload_document_file(
    session: AsyncSession,
    actor: User,
    user_id: uuid.UUID,
    document_id: uuid.UUID,
    upload: UploadFile,
    *,
    reason: str | None,
    replace: bool,
) -> dict[str, object]:
    permission = USER_DOCUMENTS_REPLACE if replace else USER_DOCUMENTS_UPLOAD
    if not has_permission(actor, permission):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Document upload is not permitted"
        )
    target, current = await _active_document(session, actor, user_id, document_id, lock=True)
    if replace and not reason:
        raise AppError(
            status_code=422,
            code="REPLACEMENT_REASON_REQUIRED",
            message="Replacement reason is required",
        )
    if not replace and current.storage_key:
        raise AppError(
            status_code=409,
            code="DOCUMENT_ATTACHMENT_EXISTS",
            message="Use Replace for an existing attachment",
        )
    data, content_type, suffix = await validate_document_upload(upload)
    key = f"{target.id}/{uuid.uuid4().hex}{suffix}"
    path = _document_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_bytes(data)
    temp.replace(path)
    now = _now()
    original = Path((upload.filename or "document").replace("\\", "/")).name[:255]
    replacement = _clone_document(
        current,
        actor,
        now=now,
        values={
            "storage_key": key,
            "original_filename": original,
            "content_type": content_type,
            "size_bytes": len(data),
            "uploaded_by_id": actor.id,
            "uploaded_at": now,
        },
        replacement_reason=reason or "Initial attachment upload",
    )
    session.add(replacement)
    await record_audit(
        session,
        action="user.document.replace" if replace else "user.document.upload",
        entity_type="employee_document",
        entity_id=str(replacement.id),
        actor_id=actor.id,
        target_user_id=target.id,
        new_values={
            "kind": replacement.kind,
            "version": replacement.version,
            "contentType": content_type,
            "sizeBytes": len(data),
        },
        note=reason,
    )
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        path.unlink(missing_ok=True)
        raise
    await session.refresh(replacement)
    return _document_payload(replacement, include_attachment_metadata=True)


async def inactivate_document(
    session: AsyncSession,
    actor: User,
    user_id: uuid.UUID,
    document_id: uuid.UUID,
    reason: str,
) -> None:
    if not has_permission(actor, USER_DOCUMENTS_DELETE):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Document removal is not permitted"
        )
    target, row = await _active_document(session, actor, user_id, document_id, lock=True)
    row.is_active = False
    row.updated_by_id = actor.id
    row.updated_at = _now()
    await record_audit(
        session,
        action="user.document.delete",
        entity_type="employee_document",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=target.id,
        new_values={"kind": row.kind, "version": row.version, "active": False},
        note=reason,
    )
    await session.commit()


async def document_history(
    session: AsyncSession, actor: User, user_id: uuid.UUID, document_id: uuid.UUID
) -> list[dict[str, object]]:
    if not has_permission(actor, USER_DOCUMENTS_HISTORY):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Document history is not permitted"
        )
    target = await get_visible_user(session, actor, user_id)
    seed = await session.get(EmployeeDocument, document_id)
    if seed is None or seed.user_id != target.id:
        raise AppError(status_code=404, code="DOCUMENT_NOT_FOUND", message="Document not found")
    rows = list(
        (
            await session.scalars(
                select(EmployeeDocument)
                .options(
                    selectinload(EmployeeDocument.updated_by),
                    selectinload(EmployeeDocument.uploaded_by),
                )
                .where(
                    EmployeeDocument.user_id == target.id,
                    EmployeeDocument.record_key == seed.record_key,
                )
                .order_by(EmployeeDocument.version.desc())
            )
        ).all()
    )
    return [_document_payload(row, include_attachment_metadata=True) for row in rows]


async def document_file(
    session: AsyncSession,
    actor: User,
    user_id: uuid.UUID,
    document_id: uuid.UUID,
    *,
    download: bool,
) -> tuple[Path, EmployeeDocument]:
    permission = USER_DOCUMENTS_DOWNLOAD if download else USER_DOCUMENTS_VIEW
    if not has_permission(actor, permission):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Document attachment access is not permitted"
        )
    target = await get_visible_user(session, actor, user_id)
    row = await session.get(EmployeeDocument, document_id)
    if row is None or row.user_id != target.id:
        raise AppError(status_code=404, code="DOCUMENT_NOT_FOUND", message="Document not found")
    if not row.is_active:
        if not has_permission(actor, USER_DOCUMENTS_HISTORY):
            raise AppError(status_code=404, code="DOCUMENT_NOT_FOUND", message="Document not found")
    if not row.storage_key:
        raise AppError(
            status_code=404, code="DOCUMENT_FILE_NOT_FOUND", message="Document has no attachment"
        )
    path = _document_path(row.storage_key)
    if not path.is_file():
        raise AppError(
            status_code=404, code="DOCUMENT_FILE_NOT_FOUND", message="Document file is missing"
        )
    await record_audit(
        session,
        action="user.document.download" if download else "user.document.view",
        entity_type="employee_document",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=target.id,
        new_values={"kind": row.kind, "version": row.version},
    )
    await session.commit()
    return path, row


async def purge_document(
    session: AsyncSession, actor: User, user_id: uuid.UUID, document_id: uuid.UUID, reason: str
) -> int:
    if not has_permission(actor, USER_DOCUMENTS_PURGE):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Permanent purge is not permitted"
        )
    target = await get_visible_user(session, actor, user_id)
    seed = await session.get(EmployeeDocument, document_id)
    if seed is None or seed.user_id != target.id:
        raise AppError(status_code=404, code="DOCUMENT_NOT_FOUND", message="Document not found")
    rows = list(
        (
            await session.scalars(
                select(EmployeeDocument)
                .where(
                    EmployeeDocument.user_id == target.id,
                    EmployeeDocument.record_key == seed.record_key,
                )
                .with_for_update()
            )
        ).all()
    )
    files = [row.storage_key for row in rows if row.storage_key]
    await record_audit(
        session,
        action="user.document.purge",
        entity_type="employee_document",
        entity_id=seed.record_key,
        actor_id=actor.id,
        target_user_id=target.id,
        new_values={"kind": seed.kind, "versionsPurged": len(rows)},
        note=reason,
    )
    for row in rows:
        await session.delete(row)
    await session.commit()
    for key in files:
        _document_path(key).unlink(missing_ok=True)
    return len(rows)


async def _visible_users(session: AsyncSession, actor: User) -> list[User]:
    stmt = select(User).options(
        selectinload(User.department),
        selectinload(User.hr_profile).selectinload(HRProfile.updated_by),
    )
    allowed = await visible_user_ids(session, actor)
    if allowed is not None:
        stmt = stmt.where(User.id.in_(allowed))
    return list((await session.scalars(stmt.order_by(User.full_name))).unique().all())


def _breakdown(values: list[str | None]) -> list[dict[str, object]]:
    counts = Counter(value or "Not recorded" for value in values)
    return [{"label": label, "count": count} for label, count in sorted(counts.items())]


async def hr_dashboard(session: AsyncSession, actor: User) -> dict[str, object]:
    users = await _visible_users(session, actor)
    today = _today()
    new_cutoff = today - timedelta(days=30)
    active = [user for user in users if user.employment_status.lower() == "active"]
    probation = [user for user in users if user.employment_status.lower() == "probation"]
    new_joiners = [user for user in users if user.joining_date and user.joining_date >= new_cutoff]
    pending = [
        user for user in users if _hr_completion(user, user.hr_profile)["state"] != "Complete"
    ]
    events = list(
        (
            await session.scalars(
                select(AuditEvent)
                .where(AuditEvent.action.like("user.profile.hr.%"))
                .order_by(AuditEvent.created_at.desc())
                .limit(10)
            )
        ).all()
    )
    user_by_id = {user.id: user for user in users}
    actor_ids = {event.actor_id for event in events if event.actor_id}
    actors = (
        list((await session.scalars(select(User).where(User.id.in_(actor_ids)))).all())
        if actor_ids
        else []
    )
    actor_by_id = {user.id: user for user in actors}
    return {
        "generatedAt": _now().isoformat(),
        "cards": {
            "totalEmployees": len(users),
            "activeEmployees": len(active),
            "onProbation": len(probation),
            "newJoiners": len(new_joiners),
            "pendingHrActions": len(pending),
        },
        "breakdowns": {
            "department": _breakdown(
                [user.department.name if user.department else None for user in users]
            ),
            "businessUnit": _breakdown(
                [user.hr_profile.business_unit if user.hr_profile else None for user in users]
            ),
            "location": _breakdown(
                [user.hr_profile.location if user.hr_profile else None for user in users]
            ),
            "employmentType": _breakdown(
                [user.hr_profile.employment_type if user.hr_profile else None for user in users]
            ),
            "employeeStatus": _breakdown([user.employment_status for user in users]),
        },
        "newJoiners": [
            {
                "id": str(user.id),
                "name": user.full_name,
                "employeeCode": user.employee_code,
                "joiningDate": user.joining_date.isoformat(),
            }
            for user in sorted(new_joiners, key=lambda item: item.joining_date, reverse=True)[:10]
        ],
        "probation": [
            {
                "id": str(user.id),
                "name": user.full_name,
                "endDate": user.hr_profile.probation_end_date.isoformat()
                if user.hr_profile and user.hr_profile.probation_end_date
                else None,
                "state": (
                    "Action Required"
                    if not user.hr_profile
                    or not user.hr_profile.probation_end_date
                    or user.hr_profile.probation_end_date < today
                    else "Ending Soon"
                    if (user.hr_profile.probation_end_date - today).days <= 30
                    else "Normal"
                ),
            }
            for user in probation
        ],
        "pendingActions": [
            {
                "id": str(user.id),
                "name": user.full_name,
                "completion": _hr_completion(user, user.hr_profile),
            }
            for user in pending[:20]
        ],
        "recentActivity": [
            {
                "id": str(event.id),
                "actor": actor_by_id[event.actor_id].full_name
                if event.actor_id in actor_by_id
                else "System",
                "action": event.action,
                "employee": user_by_id.get(event.target_user_id).full_name
                if event.target_user_id in user_by_id
                else "Restricted employee",
                "createdAt": event.created_at.isoformat(),
            }
            for event in events
            if event.target_user_id in user_by_id
        ],
    }


async def pro_dashboard(session: AsyncSession, actor: User) -> dict[str, object]:
    users = await _visible_users(session, actor)
    allowed_ids = {user.id for user in users}
    rows = (
        list(
            (
                await session.scalars(
                    select(EmployeeDocument).where(
                        EmployeeDocument.user_id.in_(allowed_ids),
                        EmployeeDocument.is_active.is_(True),
                        EmployeeDocument.kind.in_(REQUIRED_DOCUMENT_KINDS),
                    )
                )
            ).all()
        )
        if allowed_ids
        else []
    )
    by_user: dict[uuid.UUID, dict[str, EmployeeDocument]] = {}
    for row in rows:
        by_user.setdefault(row.user_id, {})[row.kind] = row
    compliance: list[dict[str, object]] = []
    expiring: list[dict[str, object]] = []
    status_counts = Counter()
    for user in users:
        documents = by_user.get(user.id, {})
        statuses: dict[str, dict[str, object]] = {}
        for kind in REQUIRED_DOCUMENT_KINDS:
            row = documents.get(kind)
            status = _derived_document_status(row) if row else "Missing"
            status_counts[status] += 1
            statuses[kind] = {
                "status": status,
                "documentId": str(row.id) if row else None,
                "expiryDate": row.expiry_date.isoformat() if row and row.expiry_date else None,
            }
            if row and row.expiry_date:
                days = (row.expiry_date - _today()).days
                if days <= 60:
                    expiring.append(
                        {
                            "employeeId": str(user.id),
                            "employee": user.full_name,
                            "kind": kind,
                            "label": DOCUMENT_LABELS[kind],
                            "expiryDate": row.expiry_date.isoformat(),
                            "remainingDays": days,
                            "status": status,
                        }
                    )
        compliance.append(
            {"employeeId": str(user.id), "employee": user.full_name, "documents": statuses}
        )
    return {
        "generatedAt": _now().isoformat(),
        "cards": {
            "totalEmployees": len(users),
            "documentsActive": status_counts["Active"],
            "expiringSoon": status_counts["Expiring Soon"],
            "expired": status_counts["Expired"],
            "pendingDocuments": status_counts["Missing"],
        },
        "compliance": compliance,
        "expiry": {
            "within7": [row for row in expiring if 0 <= row["remainingDays"] <= 7],
            "within30": [row for row in expiring if 0 <= row["remainingDays"] <= 30],
            "within60": [row for row in expiring if 0 <= row["remainingDays"] <= 60],
            "expired": [row for row in expiring if row["remainingDays"] < 0],
        },
    }
