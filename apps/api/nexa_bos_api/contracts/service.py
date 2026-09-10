from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from pathlib import Path
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.exc import StaleDataError

from nexa_bos_api.attendance.enums import BUSINESS_TZ
from nexa_bos_api.contracts.enums import ContractStatus
from nexa_bos_api.contracts.models import (
    ContractAttachment,
    ContractEvent,
    ContractType,
    EmploymentContract,
)
from nexa_bos_api.contracts.schemas import (
    ContractAction,
    ContractCancel,
    ContractCreate,
    ContractDecision,
    ContractTypeCreate,
    ContractTypeUpdate,
    ContractUpdate,
)
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.employee_profiles.service import validate_document_upload
from nexa_bos_api.identity.access import has_permission, is_owner
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus
from nexa_bos_api.identity.models import User, new_uuid
from nexa_bos_api.identity.permissions import (
    CONTRACTS_APPROVE,
    CONTRACTS_VIEW,
    CONTRACTS_VIEW_OWN,
)


def _now() -> datetime:
    return datetime.now(UTC)


def _today() -> date:
    return datetime.now(BUSINESS_TZ).date()


def _money(value: object) -> str:
    return f"{value:.2f}"


def _derived_status(row: EmploymentContract) -> ContractStatus:
    if row.status != ContractStatus.ACTIVE or row.end_date is None:
        return ContractStatus(row.status)
    remaining = (row.end_date - _today()).days
    if remaining < 0:
        return ContractStatus.EXPIRED
    if remaining <= 90:
        return ContractStatus.EXPIRING_SOON
    return ContractStatus.ACTIVE


def _type_payload(row: ContractType) -> dict[str, object]:
    return {
        "id": str(row.id),
        "code": row.code,
        "name": row.name,
        "description": row.description,
        "isActive": row.is_active,
    }


async def list_types(session: AsyncSession, *, include_inactive: bool) -> list[dict[str, object]]:
    stmt = select(ContractType).order_by(ContractType.name, ContractType.code)
    if not include_inactive:
        stmt = stmt.where(ContractType.is_active.is_(True))
    return [_type_payload(row) for row in (await session.scalars(stmt)).all()]


async def create_type(
    session: AsyncSession, actor: User, payload: ContractTypeCreate
) -> dict[str, object]:
    row = ContractType(
        id=new_uuid(),
        code=payload.code.strip().upper(),
        name=payload.name.strip(),
        description=payload.description,
        is_active=True,
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(row)
    await record_audit(
        session,
        action="contract.type.create",
        entity_type="contract_type",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values={"code": row.code, "name": row.name},
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409, code="CONTRACT_TYPE_EXISTS", message="Contract type code exists"
        ) from exc
    return _type_payload(row)


async def update_type(
    session: AsyncSession, actor: User, type_id: UUID, payload: ContractTypeUpdate
) -> dict[str, object]:
    row = await session.get(ContractType, type_id, with_for_update=True)
    if row is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Contract type was not found")
    old = _type_payload(row)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value.strip() if isinstance(value, str) else value)
    row.updated_at = _now()
    await record_audit(
        session,
        action="contract.type.update",
        entity_type="contract_type",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old,
        new_values=_type_payload(row),
    )
    await session.commit()
    return _type_payload(row)


async def employee_options(session: AsyncSession) -> list[dict[str, str]]:
    rows = (
        await session.scalars(
            select(User)
            .where(User.account_status == AccountStatus.ACTIVE)
            .order_by(User.full_name, User.employee_code)
        )
    ).all()
    return [
        {"id": str(row.id), "fullName": row.full_name, "employeeCode": row.employee_code}
        for row in rows
    ]


def _contract_stmt():
    return select(EmploymentContract).options(
        selectinload(EmploymentContract.employee),
        selectinload(EmploymentContract.contract_type),
        selectinload(EmploymentContract.created_by),
        selectinload(EmploymentContract.updated_by),
        selectinload(EmploymentContract.events).selectinload(ContractEvent.actor),
        selectinload(EmploymentContract.attachments),
    )


def _can_view(actor: User, row: EmploymentContract) -> bool:
    if is_owner(actor) or has_permission(actor, CONTRACTS_VIEW):
        return True
    return (
        actor.id == row.employee_id
        and has_permission(actor, CONTRACTS_VIEW_OWN)
        and row.status == ContractStatus.ACTIVE
        and (row.end_date is None or row.end_date >= _today())
    )


async def _contract(
    session: AsyncSession, actor: User, contract_id: UUID, *, lock: bool = False
) -> EmploymentContract:
    stmt = _contract_stmt().where(
        EmploymentContract.id == contract_id,
        EmploymentContract.archived_at.is_(None),
    )
    if lock:
        stmt = stmt.with_for_update()
    row = await session.scalar(stmt)
    if row is None or not _can_view(actor, row):
        raise AppError(status_code=404, code="NOT_FOUND", message="Contract was not found")
    return row


def _attachment_payload(row: ContractAttachment) -> dict[str, object]:
    return {
        "id": str(row.id),
        "name": row.original_filename,
        "contentType": row.content_type,
        "sizeBytes": row.size_bytes,
        "version": row.version,
        "isActive": row.is_active,
        "uploadedAt": row.uploaded_at.isoformat(),
        "replacementReason": row.replacement_reason,
    }


def _event(
    row: EmploymentContract,
    actor: User,
    action: str,
    target: ContractStatus,
    *,
    comment: str | None = None,
) -> ContractEvent:
    previous = row.status
    row.status = target
    row.updated_by_id = actor.id
    row.updated_at = _now()
    return ContractEvent(
        id=new_uuid(),
        contract=row,
        actor_id=actor.id,
        action=action,
        from_status=previous,
        to_status=target,
        comment=comment,
        snapshot={"contractNumber": row.contract_number, "lockVersion": row.lock_version},
        created_at=_now(),
    )


def _payload(
    row: EmploymentContract,
    *,
    include_history: bool = True,
    active_attachments_only: bool = False,
) -> dict[str, object]:
    attachments = (
        [item for item in row.attachments if item.is_active]
        if active_attachments_only
        else row.attachments
    )
    return {
        "id": str(row.id),
        "employeeId": str(row.employee_id),
        "employee": row.employee.full_name,
        "employeeCode": row.employee.employee_code,
        "contractType": _type_payload(row.contract_type),
        "parentContractId": str(row.parent_contract_id) if row.parent_contract_id else None,
        "contractNumber": row.contract_number,
        "startDate": row.start_date.isoformat(),
        "endDate": row.end_date.isoformat() if row.end_date else None,
        "jobTitleSnapshot": row.job_title_snapshot,
        "currency": row.currency,
        "basicSalary": _money(row.basic_salary),
        "allowancesTotal": _money(row.allowances_total),
        "totalCompensation": _money(row.basic_salary + row.allowances_total),
        "notes": row.notes,
        "status": _derived_status(row),
        "storedStatus": row.status,
        "lockVersion": row.lock_version,
        "attachments": [_attachment_payload(item) for item in attachments],
        "history": [
            {
                "id": str(item.id),
                "actor": item.actor.full_name,
                "action": item.action,
                "fromStatus": item.from_status,
                "toStatus": item.to_status,
                "comment": item.comment,
                "createdAt": item.created_at.isoformat(),
            }
            for item in row.events
        ]
        if include_history
        else [],
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


async def list_contracts(
    session: AsyncSession, actor: User, *, status: str | None, employee_id: UUID | None
) -> list[dict[str, object]]:
    if not (is_owner(actor) or has_permission(actor, CONTRACTS_VIEW)):
        raise AppError(status_code=403, code="FORBIDDEN", message="Contract register denied")
    stmt = (
        _contract_stmt()
        .where(EmploymentContract.archived_at.is_(None))
        .order_by(EmploymentContract.created_at.desc())
    )
    if employee_id:
        stmt = stmt.where(EmploymentContract.employee_id == employee_id)
    rows = (await session.scalars(stmt)).all()
    payloads = [_payload(row) for row in rows]
    return [item for item in payloads if status is None or item["status"] == status]


async def own_active_contract(session: AsyncSession, actor: User) -> dict[str, object] | None:
    if not has_permission(actor, CONTRACTS_VIEW_OWN) and not is_owner(actor):
        raise AppError(status_code=403, code="FORBIDDEN", message="Own contract access denied")
    row = await session.scalar(
        _contract_stmt()
        .where(
            EmploymentContract.employee_id == actor.id,
            EmploymentContract.status == ContractStatus.ACTIVE,
            EmploymentContract.archived_at.is_(None),
        )
        .order_by(EmploymentContract.activated_at.desc())
    )
    if row is None or (row.end_date and row.end_date < _today()):
        return None
    await record_audit(
        session,
        action="contract.own.view",
        entity_type="employment_contract",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=actor.id,
    )
    await session.commit()
    return _payload(row, include_history=False, active_attachments_only=True)


async def get_contract(session: AsyncSession, actor: User, contract_id: UUID) -> dict[str, object]:
    row = await _contract(session, actor, contract_id)
    if actor.id == row.employee_id and not (
        is_owner(actor) or has_permission(actor, CONTRACTS_VIEW)
    ):
        await record_audit(
            session,
            action="contract.own.view",
            entity_type="employment_contract",
            entity_id=str(row.id),
            actor_id=actor.id,
            target_user_id=actor.id,
        )
        await session.commit()
    operational = is_owner(actor) or has_permission(actor, CONTRACTS_VIEW)
    return _payload(
        row,
        include_history=operational,
        active_attachments_only=not operational,
    )


async def create_contract(
    session: AsyncSession, actor: User, payload: ContractCreate
) -> dict[str, object]:
    employee = await session.get(User, payload.employee_id)
    contract_type = await session.get(ContractType, payload.contract_type_id)
    if employee is None or contract_type is None or not contract_type.is_active:
        raise AppError(
            status_code=422, code="CONTRACT_REFERENCE_INVALID", message="Invalid employee or type"
        )
    if payload.parent_contract_id:
        parent = await session.get(EmploymentContract, payload.parent_contract_id)
        if parent is None or parent.employee_id != employee.id:
            raise AppError(
                status_code=422, code="CONTRACT_RENEWAL_INVALID", message="Invalid renewal"
            )
    now = _now()
    row = EmploymentContract(
        id=new_uuid(),
        status=ContractStatus.DRAFT,
        created_by_id=actor.id,
        updated_by_id=actor.id,
        created_at=now,
        updated_at=now,
        lock_version=1,
        **payload.model_dump(),
    )
    session.add(row)
    session.add(
        _event(
            row, actor, "create" if not row.parent_contract_id else "renew", ContractStatus.DRAFT
        )
    )
    await record_audit(
        session,
        action="contract.create" if not row.parent_contract_id else "contract.renew",
        entity_type="employment_contract",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=employee.id,
        new_values={
            "contractNumber": row.contract_number,
            "parentContractId": str(row.parent_contract_id) if row.parent_contract_id else None,
        },
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409, code="CONTRACT_NUMBER_EXISTS", message="Contract number exists"
        ) from exc
    return await get_contract(session, actor, row.id)


async def update_contract(
    session: AsyncSession, actor: User, contract_id: UUID, payload: ContractUpdate
) -> dict[str, object]:
    row = await _contract(session, actor, contract_id, lock=True)
    if row.lock_version != payload.lock_version:
        raise AppError(status_code=409, code="CONTRACT_CONFLICT", message="Reload latest contract")
    if row.status != ContractStatus.DRAFT:
        raise AppError(
            status_code=409, code="CONTRACT_IMMUTABLE", message="Only drafts can be edited"
        )
    old = {
        "startDate": row.start_date.isoformat(),
        "endDate": row.end_date.isoformat() if row.end_date else None,
    }
    values = payload.model_dump(exclude_unset=True, exclude={"lock_version"})
    if "contract_type_id" in values:
        contract_type = await session.get(ContractType, values["contract_type_id"])
        if contract_type is None or not contract_type.is_active:
            raise AppError(
                status_code=422, code="CONTRACT_TYPE_INVALID", message="Contract type unavailable"
            )
    for field, value in values.items():
        setattr(row, field, value)
    if row.end_date and row.end_date < row.start_date:
        raise AppError(status_code=422, code="CONTRACT_DATES_INVALID", message="Invalid dates")
    session.add(_event(row, actor, "correct", ContractStatus.DRAFT))
    await record_audit(
        session,
        action="contract.correct",
        entity_type="employment_contract",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        old_values=old,
        new_values={"changedFields": sorted(values)},
    )
    try:
        await session.commit()
    except StaleDataError as exc:
        await session.rollback()
        raise AppError(
            status_code=409, code="CONTRACT_CONFLICT", message="Reload latest contract"
        ) from exc
    return await get_contract(session, actor, row.id)


async def submit_contract(
    session: AsyncSession, actor: User, contract_id: UUID, payload: ContractAction
) -> dict[str, object]:
    row = await _contract(session, actor, contract_id, lock=True)
    if row.lock_version != payload.lock_version or row.status != ContractStatus.DRAFT:
        raise AppError(status_code=409, code="CONTRACT_CONFLICT", message="Reload latest contract")
    session.add(
        _event(row, actor, "submit", ContractStatus.PENDING_APPROVAL, comment=payload.comment)
    )
    row.submitted_at = _now()
    await record_audit(
        session,
        action="contract.submit",
        entity_type="employment_contract",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        new_values={"status": ContractStatus.PENDING_APPROVAL},
        note=payload.comment,
    )
    await _commit(session)
    return await get_contract(session, actor, row.id)


async def activate_contract(
    session: AsyncSession, actor: User, contract_id: UUID, payload: ContractAction
) -> dict[str, object]:
    row = await _contract(session, actor, contract_id, lock=True)
    if not (is_owner(actor) and has_permission(actor, CONTRACTS_APPROVE)):
        raise AppError(status_code=403, code="FORBIDDEN", message="OWNER approval is required")
    if actor.id in {row.employee_id, row.created_by_id}:
        raise AppError(
            status_code=403, code="SELF_APPROVAL_FORBIDDEN", message="Self approval is forbidden"
        )
    if row.lock_version != payload.lock_version or row.status != ContractStatus.PENDING_APPROVAL:
        raise AppError(status_code=409, code="CONTRACT_CONFLICT", message="Reload latest contract")
    if not any(item.is_active for item in row.attachments):
        raise AppError(
            status_code=409,
            code="CONTRACT_ATTACHMENT_REQUIRED",
            message="Signed attachment is required",
        )
    previous = await session.scalar(
        _contract_stmt()
        .where(
            EmploymentContract.employee_id == row.employee_id,
            EmploymentContract.status == ContractStatus.ACTIVE,
            EmploymentContract.archived_at.is_(None),
            EmploymentContract.id != row.id,
        )
        .with_for_update()
    )
    if previous:
        session.add(
            _event(previous, actor, "supersede", ContractStatus.SUPERSEDED, comment=payload.comment)
        )
    row.activated_at = _now()
    session.add(_event(row, actor, "activate", ContractStatus.ACTIVE, comment=payload.comment))
    await record_audit(
        session,
        action="contract.activate",
        entity_type="employment_contract",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        old_values={"previousContractId": str(previous.id) if previous else None},
        new_values={"status": ContractStatus.ACTIVE},
        note=payload.comment,
    )
    await _commit(session)
    return await get_contract(session, actor, row.id)


async def decide_contract(
    session: AsyncSession, actor: User, contract_id: UUID, payload: ContractDecision
) -> dict[str, object]:
    row = await _contract(session, actor, contract_id, lock=True)
    if row.lock_version != payload.lock_version or row.status != ContractStatus.PENDING_APPROVAL:
        raise AppError(status_code=409, code="CONTRACT_CONFLICT", message="Reload latest contract")
    if actor.id in {row.employee_id, row.created_by_id}:
        raise AppError(
            status_code=403, code="SELF_APPROVAL_FORBIDDEN", message="Self decision is forbidden"
        )
    target = ContractStatus.DRAFT if payload.decision == "return" else ContractStatus.CANCELLED
    session.add(_event(row, actor, payload.decision, target, comment=payload.comment))
    await record_audit(
        session,
        action=f"contract.{payload.decision}",
        entity_type="employment_contract",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        new_values={"status": target},
        note=payload.comment,
    )
    await _commit(session)
    return await get_contract(session, actor, row.id)


async def cancel_contract(
    session: AsyncSession, actor: User, contract_id: UUID, payload: ContractCancel
) -> dict[str, object]:
    row = await _contract(session, actor, contract_id, lock=True)
    if row.lock_version != payload.lock_version or row.status not in {
        ContractStatus.DRAFT,
        ContractStatus.PENDING_APPROVAL,
    }:
        raise AppError(status_code=409, code="CONTRACT_CONFLICT", message="Reload latest contract")
    row.cancelled_at = _now()
    session.add(_event(row, actor, "cancel", ContractStatus.CANCELLED, comment=payload.reason))
    await record_audit(
        session,
        action="contract.cancel",
        entity_type="employment_contract",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        new_values={"status": ContractStatus.CANCELLED},
        note=payload.reason,
    )
    await _commit(session)
    return await get_contract(session, actor, row.id)


def _attachment_root() -> Path:
    root = (get_settings().file_storage_dir / "contract-attachments").resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _attachment_path(storage_key: str) -> Path:
    root = _attachment_root()
    path = (root / storage_key).resolve()
    if root not in path.parents:
        raise AppError(status_code=400, code="CONTRACT_PATH_INVALID", message="Invalid file path")
    return path


async def upload_attachment(
    session: AsyncSession,
    actor: User,
    contract_id: UUID,
    upload: UploadFile,
    *,
    reason: str | None,
) -> dict[str, object]:
    row = await _contract(session, actor, contract_id, lock=True)
    if row.status not in {ContractStatus.DRAFT, ContractStatus.PENDING_APPROVAL}:
        raise AppError(
            status_code=409, code="CONTRACT_IMMUTABLE", message="Active evidence is immutable"
        )
    data, content_type, suffix = await validate_document_upload(upload)
    active = next((item for item in row.attachments if item.is_active), None)
    if active and not reason:
        raise AppError(
            status_code=422,
            code="REPLACEMENT_REASON_REQUIRED",
            message="Replacement reason required",
        )
    version = max((item.version for item in row.attachments), default=0) + 1
    key = f"{row.employee_id}/{row.id}/{uuid.uuid4().hex}{suffix}"
    path = _attachment_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)
    if active:
        active.is_active = False
    attachment = ContractAttachment(
        id=new_uuid(),
        contract_id=row.id,
        storage_key=key,
        original_filename=Path((upload.filename or "contract").replace("\\", "/")).name[:255],
        content_type=content_type,
        size_bytes=len(data),
        version=version,
        is_active=True,
        uploaded_by_id=actor.id,
        uploaded_at=_now(),
        replacement_reason=reason,
    )
    session.add(attachment)
    await record_audit(
        session,
        action="contract.attachment.upload" if not active else "contract.attachment.replace",
        entity_type="contract_attachment",
        entity_id=str(attachment.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        new_values={"contractId": str(row.id), "version": version, "sizeBytes": len(data)},
        note=reason,
    )
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        path.unlink(missing_ok=True)
        raise
    return _attachment_payload(attachment)


async def attachment_file(
    session: AsyncSession, actor: User, contract_id: UUID, attachment_id: UUID
) -> tuple[Path, str, str]:
    row = await _contract(session, actor, contract_id)
    attachment = next((item for item in row.attachments if item.id == attachment_id), None)
    if attachment is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Attachment was not found")
    if not attachment.is_active and not (is_owner(actor) or has_permission(actor, CONTRACTS_VIEW)):
        raise AppError(status_code=404, code="NOT_FOUND", message="Attachment was not found")
    path = _attachment_path(attachment.storage_key)
    if not path.is_file():
        raise AppError(status_code=404, code="FILE_NOT_FOUND", message="Attachment file is missing")
    await record_audit(
        session,
        action="contract.attachment.view",
        entity_type="contract_attachment",
        entity_id=str(attachment.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
    )
    await session.commit()
    return path, attachment.content_type, attachment.original_filename


async def reminders(session: AsyncSession, actor: User) -> list[dict[str, object]]:
    if not (is_owner(actor) or has_permission(actor, CONTRACTS_VIEW)):
        raise AppError(status_code=403, code="FORBIDDEN", message="Contract reminders denied")
    rows = (
        await session.scalars(
            _contract_stmt()
            .where(
                EmploymentContract.status == ContractStatus.ACTIVE,
                EmploymentContract.archived_at.is_(None),
                EmploymentContract.end_date.is_not(None),
            )
            .order_by(EmploymentContract.end_date)
        )
    ).all()
    items = []
    for row in rows:
        days = (row.end_date - _today()).days if row.end_date else None
        if days is None or days < 0 or days > 90:
            continue
        milestone = next(limit for limit in (7, 30, 60, 90) if days <= limit)
        items.append({**_payload(row), "daysRemaining": days, "reminderMilestone": milestone})
    return items


async def _commit(session: AsyncSession) -> None:
    try:
        await session.commit()
    except (StaleDataError, IntegrityError) as exc:
        await session.rollback()
        raise AppError(
            status_code=409, code="CONTRACT_CONFLICT", message="Reload latest contract"
        ) from exc
