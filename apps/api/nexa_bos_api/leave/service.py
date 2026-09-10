from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.exc import StaleDataError

from nexa_bos_api.attendance.enums import BUSINESS_TZ
from nexa_bos_api.attendance.models import LeaveType
from nexa_bos_api.attendance.service import load_holiday_dates, load_working_weekdays
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.employee_profiles.service import validate_document_upload
from nexa_bos_api.identity.access import has_permission, is_owner
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus, MasterStatus
from nexa_bos_api.identity.models import User, new_uuid
from nexa_bos_api.identity.permissions import (
    LEAVE_APPROVE_HR,
    LEAVE_CREATE_FOR_EMPLOYEE,
    LEAVE_EDIT,
    LEAVE_OVERRIDE,
    LEAVE_SETTINGS,
)
from nexa_bos_api.leave.enums import (
    ACTIVE_BALANCE_STATUSES,
    APPROVED_STATUSES,
    LeaveAccrualMethod,
    LeavePortion,
    LeaveStatus,
)
from nexa_bos_api.leave.models import (
    LeaveAttachment,
    LeaveBalanceAdjustment,
    LeaveRequest,
    LeaveRequestEvent,
)
from nexa_bos_api.leave.schemas import (
    LeaveAction,
    LeaveBalanceAdjustmentCreate,
    LeaveCancellation,
    LeaveCancellationDecision,
    LeaveDecision,
    LeaveRequestCreate,
    LeaveRequestUpdate,
    LeaveTypeConfig,
)


def _now() -> datetime:
    return datetime.now(UTC)


def _business_today() -> date:
    return datetime.now(BUSINESS_TZ).date()


def _amount(value: Decimal | float | int | None) -> float:
    return float(value or 0)


def _leave_root() -> Path:
    root = (get_settings().file_storage_dir / "leave-attachments").resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _leave_path(storage_key: str) -> Path:
    root = _leave_root()
    path = (root / storage_key).resolve()
    if root not in path.parents:
        raise AppError(status_code=400, code="LEAVE_PATH_INVALID", message="Invalid file path")
    return path


async def _employee(session: AsyncSession, employee_id: UUID) -> User:
    row = await session.get(User, employee_id)
    if row is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    return row


async def _can_view_request(session: AsyncSession, actor: User, row: LeaveRequest) -> bool:
    if actor.id == row.employee_id or is_owner(actor):
        return True
    if has_permission(actor, LEAVE_APPROVE_HR):
        return True
    return row.employee.reporting_manager_id == actor.id


def _can_view_private(actor: User, row: LeaveRequest) -> bool:
    return actor.id == row.employee_id or is_owner(actor) or has_permission(actor, LEAVE_APPROVE_HR)


async def _request(
    session: AsyncSession, actor: User, request_id: UUID, *, lock: bool = False
) -> LeaveRequest:
    stmt = (
        select(LeaveRequest)
        .options(
            selectinload(LeaveRequest.employee),
            selectinload(LeaveRequest.requested_by),
            selectinload(LeaveRequest.events).selectinload(LeaveRequestEvent.actor),
            selectinload(LeaveRequest.attachments),
        )
        .where(LeaveRequest.id == request_id, LeaveRequest.archived_at.is_(None))
    )
    if lock:
        stmt = stmt.with_for_update()
    row = await session.scalar(stmt)
    if row is None or not await _can_view_request(session, actor, row):
        raise AppError(status_code=404, code="NOT_FOUND", message="Leave request was not found")
    return row


async def _working_days(
    session: AsyncSession, start: date, end: date, portion: LeavePortion
) -> Decimal:
    working_week = await load_working_weekdays(session)
    if not working_week:
        raise AppError(
            status_code=409,
            code="WORKING_CALENDAR_NOT_CONFIGURED",
            message="Company working days must be configured before requesting leave",
        )
    holidays = await load_holiday_dates(session)
    cursor = start
    count = Decimal("0")
    while cursor <= end:
        if cursor.weekday() in working_week and cursor not in holidays:
            count += Decimal("1")
        cursor = date.fromordinal(cursor.toordinal() + 1)
    if portion is not LeavePortion.FULL_DAY:
        if start != end:
            raise AppError(
                status_code=422,
                code="HALF_DAY_RANGE_INVALID",
                message="Half-day leave must use one date",
            )
        count = Decimal("0.5") if count else Decimal("0")
    if count <= 0:
        raise AppError(
            status_code=422,
            code="LEAVE_NO_WORKING_DAYS",
            message="The selected dates contain no working days",
        )
    return count


async def _leave_type(session: AsyncSession, leave_type_id: UUID) -> LeaveType:
    row = await session.get(LeaveType, leave_type_id)
    if row is None or row.status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=422, code="LEAVE_TYPE_INVALID", message="Leave type is not available"
        )
    return row


def _type_payload(row: LeaveType) -> dict[str, object]:
    return {
        "id": str(row.id),
        "code": row.code,
        "name": row.name,
        "isSystem": row.is_system,
        "status": row.status,
        "isPaid": row.is_paid,
        "eligibility": row.eligibility,
        "yearlyEntitlement": _amount(row.yearly_entitlement),
        "accrualMethod": row.accrual_method,
        "monthlyAccrual": _amount(row.monthly_accrual),
        "carryForwardLimit": _amount(row.carry_forward_limit),
        "carryForwardExpiryMonths": row.carry_forward_expiry_months,
        "halfDayAllowed": row.half_day_allowed,
        "attachmentRequired": row.attachment_required,
    }


async def list_leave_types(
    session: AsyncSession, *, include_inactive: bool
) -> list[dict[str, object]]:
    stmt = select(LeaveType).order_by(LeaveType.code)
    if not include_inactive:
        stmt = stmt.where(LeaveType.status == MasterStatus.ACTIVE)
    return [_type_payload(row) for row in (await session.scalars(stmt)).all()]


async def list_employee_options(session: AsyncSession) -> list[dict[str, str]]:
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


async def configure_leave_type(
    session: AsyncSession, actor: User, leave_type_id: UUID, payload: LeaveTypeConfig
) -> dict[str, object]:
    row = await session.get(LeaveType, leave_type_id, with_for_update=True)
    if row is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Leave type was not found")
    old = _type_payload(row)
    values = payload.model_dump(exclude_unset=True)
    if values.get("status") not in (None, MasterStatus.ACTIVE, MasterStatus.INACTIVE):
        raise AppError(status_code=422, code="LEAVE_TYPE_INVALID", message="Invalid status")
    for field, value in values.items():
        setattr(row, field, value)
    if row.accrual_method == LeaveAccrualMethod.MONTHLY and _amount(row.monthly_accrual) <= 0:
        raise AppError(
            status_code=422,
            code="LEAVE_ACCRUAL_INVALID",
            message="Monthly accrual must be greater than zero",
        )
    row.updated_at = _now()
    await record_audit(
        session,
        action="leave.type.configure",
        entity_type="leave_type",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old,
        new_values=_type_payload(row),
    )
    await session.commit()
    return _type_payload(row)


async def _balance(
    session: AsyncSession, employee_id: UUID, leave_type: LeaveType, year: int
) -> dict[str, float]:
    today = _business_today()
    if leave_type.accrual_method == LeaveAccrualMethod.MONTHLY:
        months = 12 if year < today.year else today.month if year == today.year else 0
        entitled = min(
            _amount(leave_type.yearly_entitlement), _amount(leave_type.monthly_accrual) * months
        )
    else:
        entitled = _amount(leave_type.yearly_entitlement)
    adjustment_rows = (
        await session.scalars(
            select(LeaveBalanceAdjustment).where(
                LeaveBalanceAdjustment.employee_id == employee_id,
                LeaveBalanceAdjustment.leave_type_id == leave_type.id,
                LeaveBalanceAdjustment.year == year,
                or_(
                    LeaveBalanceAdjustment.expires_on.is_(None),
                    LeaveBalanceAdjustment.expires_on >= today,
                ),
            )
        )
    ).all()
    adjustments = sum(_amount(row.amount) for row in adjustment_rows)
    requests = (
        await session.scalars(
            select(LeaveRequest).where(
                LeaveRequest.employee_id == employee_id,
                LeaveRequest.leave_type_id == leave_type.id,
                func.extract("year", LeaveRequest.start_date) == year,
                LeaveRequest.status.in_([str(status) for status in ACTIVE_BALANCE_STATUSES]),
                LeaveRequest.archived_at.is_(None),
            )
        )
    ).all()
    used = sum(_amount(row.working_days) for row in requests if row.status in APPROVED_STATUSES)
    pending = sum(
        _amount(row.working_days)
        for row in requests
        if row.status in {LeaveStatus.SUBMITTED, LeaveStatus.MANAGER_APPROVED}
    )
    return {
        "entitled": entitled,
        "adjustments": adjustments,
        "used": used,
        "pending": pending,
        "available": entitled + adjustments - used - pending,
    }


async def balances(
    session: AsyncSession, actor: User, employee_id: UUID, year: int
) -> dict[str, object]:
    employee = await _employee(session, employee_id)
    if actor.id != employee.id and not (
        is_owner(actor)
        or has_permission(actor, LEAVE_APPROVE_HR)
        or employee.reporting_manager_id == actor.id
    ):
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    types = (
        await session.scalars(
            select(LeaveType)
            .where(LeaveType.status == MasterStatus.ACTIVE)
            .order_by(LeaveType.code)
        )
    ).all()
    return {
        "employeeId": str(employee.id),
        "employee": employee.full_name,
        "year": year,
        "items": [
            {"leaveType": _type_payload(row), **(await _balance(session, employee.id, row, year))}
            for row in types
        ],
    }


async def add_balance_adjustment(
    session: AsyncSession, actor: User, payload: LeaveBalanceAdjustmentCreate
) -> dict[str, object]:
    if payload.amount == 0:
        raise AppError(status_code=422, code="ADJUSTMENT_ZERO", message="Amount cannot be zero")
    employee = await _employee(session, payload.employee_id)
    if not (is_owner(actor) or has_permission(actor, LEAVE_SETTINGS)):
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    leave_type = await _leave_type(session, payload.leave_type_id)
    row = LeaveBalanceAdjustment(
        id=new_uuid(), actor_id=actor.id, created_at=_now(), **payload.model_dump()
    )
    session.add(row)
    await record_audit(
        session,
        action="leave.balance.adjust",
        entity_type="leave_balance_adjustment",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=employee.id,
        new_values={
            "leaveTypeId": str(leave_type.id),
            "year": row.year,
            "amount": _amount(row.amount),
            "kind": row.kind,
            "expiresOn": row.expires_on.isoformat() if row.expires_on else None,
        },
        note=row.reason,
    )
    await session.commit()
    return await balances(session, actor, employee.id, payload.year)


async def _overlap(
    session: AsyncSession, employee_id: UUID, start: date, end: date, *, exclude: UUID | None = None
) -> bool:
    stmt = select(LeaveRequest.id).where(
        LeaveRequest.employee_id == employee_id,
        LeaveRequest.archived_at.is_(None),
        LeaveRequest.status.in_([str(status) for status in ACTIVE_BALANCE_STATUSES]),
        LeaveRequest.start_date <= end,
        LeaveRequest.end_date >= start,
    )
    if exclude:
        stmt = stmt.where(LeaveRequest.id != exclude)
    return await session.scalar(stmt) is not None


def _event(
    row: LeaveRequest, actor: User, action: str, target: LeaveStatus, *, comment: str | None = None
) -> LeaveRequestEvent:
    previous = row.status
    row.status = target
    row.updated_at = _now()
    return LeaveRequestEvent(
        id=new_uuid(),
        request=row,
        actor_id=actor.id,
        action=action,
        from_status=previous,
        to_status=target,
        comment=comment,
        snapshot={"workingDays": _amount(row.working_days), "lockVersion": row.lock_version},
        created_at=_now(),
    )


async def _validate_submission(
    session: AsyncSession,
    actor: User,
    row: LeaveRequest,
    leave_type: LeaveType,
    *,
    exception_reason: str | None,
) -> None:
    conflict = await _overlap(
        session, row.employee_id, row.start_date, row.end_date, exclude=row.id
    )
    balance = await _balance(session, row.employee_id, leave_type, row.start_date.year)
    insufficient = balance["available"] < _amount(row.working_days)
    missing_attachment = leave_type.attachment_required and not any(
        item.is_active for item in row.attachments
    )
    if missing_attachment:
        raise AppError(
            status_code=422,
            code="LEAVE_ATTACHMENT_REQUIRED",
            message="This leave type requires an attachment",
        )
    if conflict or insufficient:
        if not (is_owner(actor) and exception_reason and has_permission(actor, LEAVE_OVERRIDE)):
            raise AppError(
                status_code=409,
                code="LEAVE_OVERLAP" if conflict else "LEAVE_BALANCE_INSUFFICIENT",
                message="Leave dates overlap an active request"
                if conflict
                else "Available leave balance is insufficient",
            )
        row.exception_reason = exception_reason


async def create_request(
    session: AsyncSession, actor: User, payload: LeaveRequestCreate
) -> dict[str, object]:
    employee_id = payload.employee_id or actor.id
    employee = await _employee(session, employee_id)
    if employee.id != actor.id:
        if not has_permission(actor, LEAVE_CREATE_FOR_EMPLOYEE):
            raise AppError(status_code=403, code="FORBIDDEN", message="Cannot request for employee")
    leave_type = await _leave_type(session, payload.leave_type_id)
    if payload.portion is not LeavePortion.FULL_DAY and not leave_type.half_day_allowed:
        raise AppError(
            status_code=422, code="HALF_DAY_NOT_ALLOWED", message="Half-day leave is not allowed"
        )
    if payload.start_date.year != payload.end_date.year:
        raise AppError(
            status_code=422,
            code="LEAVE_YEAR_BOUNDARY",
            message="A leave request cannot cross a calendar year",
        )
    working_days = await _working_days(
        session, payload.start_date, payload.end_date, payload.portion
    )
    now = _now()
    row = LeaveRequest(
        id=new_uuid(),
        employee_id=employee.id,
        leave_type_id=leave_type.id,
        requested_by_id=actor.id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        portion=payload.portion,
        working_days=working_days,
        status=LeaveStatus.DRAFT,
        reason=payload.reason.strip(),
        exception_reason=payload.exception_reason,
        created_at=now,
        updated_at=now,
        lock_version=1,
    )
    session.add(row)
    await session.flush()
    session.add(_event(row, actor, "create", LeaveStatus.DRAFT))
    if payload.submit:
        await _validate_submission(
            session, actor, row, leave_type, exception_reason=payload.exception_reason
        )
        row.submitted_at = now
        session.add(_event(row, actor, "submit", LeaveStatus.SUBMITTED))
    await record_audit(
        session,
        action="leave.request.create",
        entity_type="leave_request",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=employee.id,
        new_values={
            "leaveTypeId": str(leave_type.id),
            "startDate": row.start_date.isoformat(),
            "endDate": row.end_date.isoformat(),
            "workingDays": _amount(row.working_days),
            "status": row.status,
            "exception": bool(row.exception_reason),
        },
        note=payload.exception_reason,
    )
    await session.commit()
    return await get_request(session, actor, row.id)


async def update_request(
    session: AsyncSession, actor: User, request_id: UUID, payload: LeaveRequestUpdate
) -> dict[str, object]:
    row = await _request(session, actor, request_id, lock=True)
    if row.lock_version != payload.lock_version:
        raise AppError(status_code=409, code="LEAVE_CONFLICT", message="Reload latest request")
    if row.status not in {LeaveStatus.DRAFT, LeaveStatus.RETURNED}:
        raise AppError(status_code=409, code="LEAVE_IMMUTABLE", message="Request cannot be edited")
    if actor.id != row.employee_id and not has_permission(actor, LEAVE_EDIT):
        raise AppError(status_code=403, code="FORBIDDEN", message="Cannot edit this request")
    leave_type = await _leave_type(session, payload.leave_type_id or row.leave_type_id)
    start = payload.start_date or row.start_date
    end = payload.end_date or row.end_date
    portion = payload.portion or LeavePortion(row.portion)
    if end < start or start.year != end.year:
        raise AppError(status_code=422, code="LEAVE_DATES_INVALID", message="Invalid dates")
    if portion is not LeavePortion.FULL_DAY and (start != end or not leave_type.half_day_allowed):
        raise AppError(status_code=422, code="HALF_DAY_NOT_ALLOWED", message="Invalid half day")
    old_values = {
        "leaveTypeId": str(row.leave_type_id),
        "startDate": row.start_date.isoformat(),
        "endDate": row.end_date.isoformat(),
        "portion": row.portion,
        "reason": row.reason,
    }
    row.leave_type_id = leave_type.id
    row.start_date = start
    row.end_date = end
    row.portion = portion
    row.working_days = await _working_days(session, start, end, portion)
    if payload.reason is not None:
        row.reason = payload.reason.strip()
    row.updated_at = _now()
    session.add(_event(row, actor, "correct", LeaveStatus.DRAFT))
    await record_audit(
        session,
        action="leave.request.correct",
        entity_type="leave_request",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        old_values=old_values,
        new_values={
            "leaveTypeId": str(row.leave_type_id),
            "startDate": row.start_date.isoformat(),
            "endDate": row.end_date.isoformat(),
            "portion": row.portion,
            "reason": row.reason,
        },
        note=payload.reason,
    )
    try:
        await session.commit()
    except StaleDataError as exc:
        await session.rollback()
        raise AppError(
            status_code=409, code="LEAVE_CONFLICT", message="Reload latest request"
        ) from exc
    return await get_request(session, actor, row.id)


async def transition(
    session: AsyncSession, actor: User, request_id: UUID, action: str, payload: LeaveAction
) -> dict[str, object]:
    row = await _request(session, actor, request_id, lock=True)
    if row.lock_version != payload.lock_version:
        raise AppError(status_code=409, code="LEAVE_CONFLICT", message="Reload latest request")
    employee = row.employee
    if action == "submit":
        if actor.id != employee.id and not has_permission(actor, LEAVE_EDIT):
            raise AppError(status_code=403, code="FORBIDDEN", message="Cannot submit request")
        if row.status not in {LeaveStatus.DRAFT, LeaveStatus.RETURNED}:
            raise AppError(status_code=409, code="LEAVE_STATE_INVALID", message="Cannot submit")
        leave_type = await _leave_type(session, row.leave_type_id)
        await _validate_submission(
            session, actor, row, leave_type, exception_reason=payload.exception_reason
        )
        row.submitted_at = _now()
        target = LeaveStatus.SUBMITTED
    elif action == "manager-approve":
        if employee.reporting_manager_id != actor.id or actor.id == employee.id:
            raise AppError(status_code=403, code="FORBIDDEN", message="Manager approval denied")
        if row.status != LeaveStatus.SUBMITTED:
            raise AppError(status_code=409, code="LEAVE_STATE_INVALID", message="Cannot approve")
        row.manager_approved_at = _now()
        target = LeaveStatus.MANAGER_APPROVED
    elif action == "hr-approve":
        if actor.id == employee.id:
            raise AppError(
                status_code=403,
                code="SELF_APPROVAL_FORBIDDEN",
                message="Self approval is forbidden",
            )
        if row.status != LeaveStatus.MANAGER_APPROVED:
            raise AppError(
                status_code=409, code="LEAVE_STATE_INVALID", message="Manager approval is required"
            )
        row.hr_approved_at = _now()
        target = LeaveStatus.HR_APPROVED
    elif action == "owner-override":
        if not is_owner(actor) or not payload.exception_reason:
            raise AppError(
                status_code=403,
                code="LEAVE_OVERRIDE_REASON_REQUIRED",
                message="OWNER reason is required",
            )
        if row.status not in {
            LeaveStatus.DRAFT,
            LeaveStatus.SUBMITTED,
            LeaveStatus.MANAGER_APPROVED,
            LeaveStatus.RETURNED,
        }:
            raise AppError(
                status_code=409,
                code="LEAVE_STATE_INVALID",
                message="Cannot override this request",
            )
        row.exception_reason = payload.exception_reason
        row.hr_approved_at = _now()
        target = LeaveStatus.HR_APPROVED
    else:
        raise AppError(status_code=404, code="ACTION_NOT_FOUND", message="Unknown leave action")
    session.add(
        _event(row, actor, action, target, comment=payload.comment or payload.exception_reason)
    )
    await record_audit(
        session,
        action=f"leave.request.{action}",
        entity_type="leave_request",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=employee.id,
        new_values={"status": target},
        note=payload.comment or payload.exception_reason,
    )
    try:
        await session.commit()
    except StaleDataError as exc:
        await session.rollback()
        raise AppError(
            status_code=409, code="LEAVE_CONFLICT", message="Reload latest request"
        ) from exc
    return await get_request(session, actor, row.id)


async def decide(
    session: AsyncSession, actor: User, request_id: UUID, payload: LeaveDecision
) -> dict[str, object]:
    row = await _request(session, actor, request_id, lock=True)
    if row.lock_version != payload.lock_version:
        raise AppError(status_code=409, code="LEAVE_CONFLICT", message="Reload latest request")
    if actor.id == row.employee_id:
        raise AppError(
            status_code=403, code="SELF_APPROVAL_FORBIDDEN", message="Self decision is forbidden"
        )
    manager = row.employee.reporting_manager_id == actor.id
    hr = has_permission(actor, LEAVE_APPROVE_HR)
    if not (manager or hr or is_owner(actor)):
        raise AppError(status_code=403, code="FORBIDDEN", message="Decision denied")
    if row.status not in {LeaveStatus.SUBMITTED, LeaveStatus.MANAGER_APPROVED}:
        raise AppError(
            status_code=409, code="LEAVE_STATE_INVALID", message="Decision is not available"
        )
    decision = payload.decision.casefold()
    if decision == "return":
        target = LeaveStatus.RETURNED
    elif decision == "reject":
        target = LeaveStatus.REJECTED
    else:
        raise AppError(
            status_code=422, code="LEAVE_DECISION_INVALID", message="Use return or reject"
        )
    session.add(_event(row, actor, decision, target, comment=payload.comment))
    await record_audit(
        session,
        action=f"leave.request.{decision}",
        entity_type="leave_request",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        new_values={"status": target},
        note=payload.comment,
    )
    try:
        await session.commit()
    except StaleDataError as exc:
        await session.rollback()
        raise AppError(
            status_code=409, code="LEAVE_CONFLICT", message="Reload latest request"
        ) from exc
    return await get_request(session, actor, row.id)


async def cancel_request(
    session: AsyncSession, actor: User, request_id: UUID, payload: LeaveCancellation
) -> dict[str, object]:
    row = await _request(session, actor, request_id, lock=True)
    if row.lock_version != payload.lock_version:
        raise AppError(status_code=409, code="LEAVE_CONFLICT", message="Reload latest request")
    if actor.id != row.employee_id and not (has_permission(actor, LEAVE_EDIT) or is_owner(actor)):
        raise AppError(status_code=403, code="FORBIDDEN", message="Cancellation denied")
    previous_status = row.status
    row.cancellation_reason = payload.reason
    if row.status in {
        LeaveStatus.DRAFT,
        LeaveStatus.SUBMITTED,
        LeaveStatus.MANAGER_APPROVED,
        LeaveStatus.RETURNED,
    }:
        target = LeaveStatus.CANCELLED
    elif row.status in APPROVED_STATUSES:
        target = LeaveStatus.CANCELLATION_PENDING
    else:
        raise AppError(status_code=409, code="LEAVE_STATE_INVALID", message="Cannot cancel request")
    session.add(_event(row, actor, "cancel", target, comment=payload.reason))
    await record_audit(
        session,
        action="leave.request.cancel",
        entity_type="leave_request",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        old_values={"status": previous_status},
        new_values={"status": target},
        note=payload.reason,
    )
    try:
        await session.commit()
    except StaleDataError as exc:
        await session.rollback()
        raise AppError(
            status_code=409, code="LEAVE_CONFLICT", message="Reload latest request"
        ) from exc
    return await get_request(session, actor, row.id)


async def decide_cancellation(
    session: AsyncSession,
    actor: User,
    request_id: UUID,
    payload: LeaveCancellationDecision,
) -> dict[str, object]:
    row = await _request(session, actor, request_id, lock=True)
    if row.lock_version != payload.lock_version or row.status != LeaveStatus.CANCELLATION_PENDING:
        raise AppError(status_code=409, code="LEAVE_CONFLICT", message="Reload latest request")
    if actor.id == row.employee_id:
        raise AppError(
            status_code=403, code="SELF_APPROVAL_FORBIDDEN", message="Self approval is forbidden"
        )
    manager = row.employee.reporting_manager_id == actor.id
    hr = has_permission(actor, LEAVE_APPROVE_HR)
    if payload.approve and manager and not hr and not is_owner(actor):
        if row.cancellation_manager_approved_at:
            raise AppError(
                status_code=409,
                code="LEAVE_STATE_INVALID",
                message="Manager cancellation approval is already recorded",
            )
        row.cancellation_manager_approved_at = _now()
        session.add(
            _event(
                row,
                actor,
                "cancellation-manager-approve",
                LeaveStatus.CANCELLATION_PENDING,
                comment=payload.comment,
            )
        )
        audit_action = "cancellation-manager-approve"
        target = LeaveStatus.CANCELLATION_PENDING
    elif hr or is_owner(actor):
        if (
            payload.approve
            and not is_owner(actor)
            and row.employee.reporting_manager_id
            and not row.cancellation_manager_approved_at
        ):
            raise AppError(
                status_code=409,
                code="MANAGER_APPROVAL_REQUIRED",
                message="Manager cancellation approval is required",
            )
        target = LeaveStatus.CANCELLED if payload.approve else LeaveStatus.HR_APPROVED
        session.add(
            _event(
                row,
                actor,
                "cancellation-approve" if payload.approve else "cancellation-reject",
                target,
                comment=payload.comment,
            )
        )
        audit_action = "cancellation-approve" if payload.approve else "cancellation-reject"
    else:
        raise AppError(status_code=403, code="FORBIDDEN", message="Cancellation decision denied")
    await record_audit(
        session,
        action=f"leave.request.{audit_action}",
        entity_type="leave_request",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        old_values={"status": LeaveStatus.CANCELLATION_PENDING},
        new_values={"status": target},
        note=payload.comment,
    )
    try:
        await session.commit()
    except StaleDataError as exc:
        await session.rollback()
        raise AppError(
            status_code=409, code="LEAVE_CONFLICT", message="Reload latest request"
        ) from exc
    return await get_request(session, actor, row.id)


def _attachment_payload(row: LeaveAttachment) -> dict[str, object]:
    return {
        "id": str(row.id),
        "name": row.original_filename,
        "contentType": row.content_type,
        "sizeBytes": row.size_bytes,
        "version": row.version,
        "isActive": row.is_active,
        "uploadedAt": row.uploaded_at.isoformat(),
    }


async def upload_attachment(
    session: AsyncSession,
    actor: User,
    request_id: UUID,
    upload: UploadFile,
    *,
    reason: str | None,
) -> dict[str, object]:
    row = await _request(session, actor, request_id, lock=True)
    if row.status not in {LeaveStatus.DRAFT, LeaveStatus.RETURNED}:
        raise AppError(status_code=409, code="LEAVE_IMMUTABLE", message="Attachment is locked")
    if actor.id != row.employee_id and not (
        has_permission(actor, LEAVE_EDIT) or has_permission(actor, LEAVE_CREATE_FOR_EMPLOYEE)
    ):
        raise AppError(status_code=403, code="FORBIDDEN", message="Attachment upload denied")
    data, content_type, suffix = await validate_document_upload(upload)
    active = next((item for item in row.attachments if item.is_active), None)
    if active and not reason:
        raise AppError(
            status_code=422,
            code="REPLACEMENT_REASON_REQUIRED",
            message="Replacement reason is required",
        )
    version = max((item.version for item in row.attachments), default=0) + 1
    key = f"{row.employee_id}/{row.id}/{uuid.uuid4().hex}{suffix}"
    path = _leave_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)
    if active:
        active.is_active = False
    attachment = LeaveAttachment(
        id=new_uuid(),
        request_id=row.id,
        storage_key=key,
        original_filename=Path((upload.filename or "attachment").replace("\\", "/")).name[:255],
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
        action="leave.attachment.upload" if not active else "leave.attachment.replace",
        entity_type="leave_attachment",
        entity_id=str(attachment.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        new_values={"requestId": str(row.id), "version": version, "sizeBytes": len(data)},
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
    session: AsyncSession, actor: User, request_id: UUID, attachment_id: UUID
) -> tuple[Path, str, str]:
    row = await _request(session, actor, request_id)
    if not _can_view_private(actor, row):
        raise AppError(status_code=404, code="NOT_FOUND", message="Attachment was not found")
    attachment = next((item for item in row.attachments if item.id == attachment_id), None)
    if attachment is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Attachment was not found")
    path = _leave_path(attachment.storage_key)
    if not path.is_file():
        raise AppError(status_code=404, code="FILE_NOT_FOUND", message="Attachment file is missing")
    await record_audit(
        session,
        action="leave.attachment.view",
        entity_type="leave_attachment",
        entity_id=str(attachment.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
    )
    await session.commit()
    return path, attachment.content_type, attachment.original_filename


async def get_request(session: AsyncSession, actor: User, request_id: UUID) -> dict[str, object]:
    row = await _request(session, actor, request_id)
    private = _can_view_private(actor, row)
    status = (
        LeaveStatus.COMPLETED
        if row.status == LeaveStatus.HR_APPROVED and row.end_date < _business_today()
        else row.status
    )
    return {
        "id": str(row.id),
        "employeeId": str(row.employee_id),
        "employee": row.employee.full_name,
        "requestedBy": row.requested_by.full_name,
        "leaveTypeId": str(row.leave_type_id),
        "startDate": row.start_date.isoformat(),
        "endDate": row.end_date.isoformat(),
        "portion": row.portion,
        "workingDays": _amount(row.working_days),
        "status": status,
        "reason": row.reason if private else None,
        "exceptionReason": row.exception_reason if private else None,
        "cancellationReason": row.cancellation_reason if private else None,
        "cancellationManagerApproved": bool(row.cancellation_manager_approved_at),
        "lockVersion": row.lock_version,
        "attachments": [_attachment_payload(item) for item in row.attachments if item.is_active]
        if private
        else [],
        "history": [
            {
                "id": str(item.id),
                "actor": item.actor.full_name,
                "action": item.action,
                "fromStatus": item.from_status,
                "toStatus": item.to_status,
                "comment": item.comment if private else None,
                "createdAt": item.created_at.isoformat(),
            }
            for item in row.events
        ],
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


async def list_requests(
    session: AsyncSession,
    actor: User,
    *,
    status: str | None,
    employee_id: UUID | None,
) -> list[dict[str, object]]:
    stmt = (
        select(LeaveRequest)
        .options(selectinload(LeaveRequest.employee))
        .where(LeaveRequest.archived_at.is_(None))
        .order_by(LeaveRequest.created_at.desc())
    )
    if status:
        stmt = stmt.where(LeaveRequest.status == status)
    if employee_id:
        stmt = stmt.where(LeaveRequest.employee_id == employee_id)
    rows = (await session.scalars(stmt)).all()
    visible: list[dict[str, object]] = []
    for row in rows:
        if await _can_view_request(session, actor, row):
            visible.append(await get_request(session, actor, row.id))
    return visible


async def team_calendar(
    session: AsyncSession, actor: User, *, start: date, end: date
) -> list[dict[str, object]]:
    rows = (
        await session.scalars(
            select(LeaveRequest)
            .options(selectinload(LeaveRequest.employee))
            .where(
                LeaveRequest.archived_at.is_(None),
                LeaveRequest.status.in_([str(status) for status in APPROVED_STATUSES]),
                LeaveRequest.start_date <= end,
                LeaveRequest.end_date >= start,
            )
            .order_by(LeaveRequest.start_date)
        )
    ).all()
    return [
        {
            "employee": row.employee.full_name,
            "startDate": row.start_date.isoformat(),
            "endDate": row.end_date.isoformat(),
            "status": row.status,
        }
        for row in rows
        if row.employee_id == actor.id
        or row.employee.reporting_manager_id == actor.id
        or is_owner(actor)
        or has_permission(actor, LEAVE_APPROVE_HR)
    ]
