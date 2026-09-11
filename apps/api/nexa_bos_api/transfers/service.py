from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.exc import StaleDataError

from nexa_bos_api.attendance.enums import BUSINESS_TZ
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import has_permission, is_owner, visible_user_ids
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus, MasterStatus
from nexa_bos_api.identity.models import (
    Department,
    Designation,
    Office,
    Team,
    User,
    UserType,
    new_uuid,
)
from nexa_bos_api.identity.schemas import UserUpdateRequest
from nexa_bos_api.identity.users_service import (
    REPORTING_HIERARCHY_LOCK_KEY,
    prepare_reporting_manager_change,
    reload_user,
    resolve_org,
    update_user,
    user_load_options,
)
from nexa_bos_api.transfers.models import EmployeeTransfer, TransferEvent
from nexa_bos_api.transfers.schemas import (
    ProposedAssignment,
    TransferAction,
    TransferCreate,
    TransferUpdate,
)

FIELDS = ("office_id", "department_id", "team_id", "designation_id", "reporting_manager_id")


def today():
    return datetime.now(BUSINESS_TZ).date()


def now():
    return datetime.now(UTC)


def require(actor: User, permission: str):
    if not has_permission(actor, permission):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Transfer action is not permitted"
        )


async def employee_ids(session: AsyncSession, actor: User) -> set[UUID] | None:
    if has_permission(actor, "Transfers.View"):
        return await visible_user_ids(session, actor)
    allowed = {actor.id} if has_permission(actor, "Transfers.ViewOwn") else set()
    if has_permission(actor, "Transfers.Recommend"):
        stmt = select(User.id).where(
            User.reporting_manager_id == actor.id, User.office_id == actor.office_id
        )
        if actor.team_id:
            stmt = stmt.where(User.team_id == actor.team_id)
        allowed.update(await session.scalars(stmt))
    return allowed


async def _employee(session: AsyncSession, actor: User, employee_id: UUID) -> User:
    allowed = await employee_ids(session, actor)
    if allowed is not None and employee_id not in allowed:
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    user = await reload_user(session, employee_id)
    if user is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    return user


def _snapshot(user: User) -> dict:
    return {key: str(getattr(user, key)) if getattr(user, key) else None for key in FIELDS}


def _stmt():
    return (
        select(EmployeeTransfer)
        .execution_options(populate_existing=True)
        .options(
            selectinload(EmployeeTransfer.employee).options(*user_load_options()),
            selectinload(EmployeeTransfer.requested_by).options(*user_load_options()),
            selectinload(EmployeeTransfer.events)
            .selectinload(TransferEvent.actor)
            .options(*user_load_options()),
        )
    )


async def _transfer(session: AsyncSession, actor: User, transfer_id: UUID, *, lock=False):
    stmt = _stmt().where(EmployeeTransfer.id == transfer_id, EmployeeTransfer.archived_at.is_(None))
    if lock:
        stmt = stmt.with_for_update()
    row = await session.scalar(stmt)
    allowed = await employee_ids(session, actor)
    if row is None or (allowed is not None and row.employee_id not in allowed):
        raise AppError(status_code=404, code="NOT_FOUND", message="Transfer was not found")
    return row


async def _payload(row: EmployeeTransfer, actor: User, session: AsyncSession) -> dict:
    names = {}
    for key, model in zip(FIELDS, (Office, Department, Team, Designation, User), strict=True):
        ids = {UUID(value) for value in (row.current_snapshot[key], row.proposed[key]) if value}
        names[key] = {
            str(item.id): item.full_name if model is User else item.name
            for item in await session.scalars(select(model).where(model.id.in_(ids)))
        }
    return {
        "id": str(row.id),
        "employeeId": str(row.employee_id),
        "employee": row.employee.full_name,
        "employeeCode": row.employee.employee_code,
        "requester": row.requested_by.full_name,
        "requestedById": str(row.requested_by_id),
        "reviewedById": str(row.reviewed_by_id) if row.reviewed_by_id else None,
        "approvedById": str(row.approved_by_id) if row.approved_by_id else None,
        "supersedesId": str(row.supersedes_id) if row.supersedes_id else None,
        "current": row.current_snapshot,
        "proposed": row.proposed,
        "currentLabels": {key: names[key].get(row.current_snapshot[key]) for key in FIELDS},
        "proposedLabels": {key: names[key].get(row.proposed[key]) for key in FIELDS},
        "reason": row.reason,
        "notes": row.notes,
        "requestedDate": row.requested_date.isoformat(),
        "effectiveDate": row.effective_date.isoformat(),
        "status": row.status,
        "lockVersion": row.lock_version,
        "updatedAt": row.updated_at.isoformat(),
        "appliedAt": row.applied_at.isoformat() if row.applied_at else None,
        "applicationError": row.application_error,
        "history": [
            {
                "id": str(item.id),
                "actor": item.actor.full_name,
                "action": item.action,
                "fromStatus": item.from_status,
                "toStatus": item.to_status,
                "comment": item.comment,
                "snapshot": item.snapshot,
                "createdAt": item.created_at.isoformat(),
            }
            for item in row.events
        ]
        if has_permission(actor, "Transfers.History")
        else [],
    }


async def _event(session, row, actor, action, status, comment=None):
    previous = row.status
    row.status = status
    row.updated_at = now()
    snapshot = {
        "current": row.current_snapshot,
        "proposed": row.proposed,
        "effectiveDate": row.effective_date.isoformat(),
    }
    session.add(
        TransferEvent(
            id=new_uuid(),
            transfer_id=row.id,
            actor_id=actor.id,
            action=action,
            from_status=previous,
            to_status=status,
            comment=comment,
            snapshot=snapshot,
            created_at=now(),
        )
    )
    await record_audit(
        session,
        action=f"transfer.{action}",
        entity_type="employee_transfer",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        old_values={"status": previous},
        new_values={"status": status, **snapshot},
        note=comment,
    )


async def _commit(session):
    try:
        await session.commit()
    except (StaleDataError, IntegrityError) as exc:
        await session.rollback()
        raise AppError(
            status_code=409, code="TRANSFER_CONFLICT", message="Reload the latest transfer"
        ) from exc


async def _validate(session, actor, user, proposed: ProposedAssignment):
    if user.account_status != AccountStatus.ACTIVE:
        raise AppError(
            status_code=409, code="TRANSFER_EMPLOYEE_INACTIVE", message="Employee must be active"
        )
    office, department, team = await resolve_org(
        session,
        office_id=proposed.office_id,
        department_id=proposed.department_id,
        team_id=proposed.team_id,
    )
    designation = await session.get(Designation, proposed.designation_id)
    if designation is None or any(
        item.status != MasterStatus.ACTIVE
        for item in (office, department, team, designation)
        if item
    ):
        raise AppError(
            status_code=422,
            code="TRANSFER_REFERENCE_INVALID",
            message="Choose active organization records",
        )
    if proposed.reporting_manager_id != user.reporting_manager_id:
        await prepare_reporting_manager_change(
            session,
            actor,
            user_id=user.id,
            manager_id=proposed.reporting_manager_id,
        )
    if is_owner(user):
        raise AppError(
            status_code=403,
            code="OWNER_TRANSFER_FORBIDDEN",
            message="OWNER organization is protected",
        )


def _backdate(actor, effective_date, reason):
    if effective_date < today() and (not is_owner(actor) or not reason or not reason.strip()):
        raise AppError(
            status_code=422,
            code="TRANSFER_BACKDATE_REQUIRED",
            message="Past effective date requires OWNER and a reason",
        )


async def list_transfers(session, actor, *, status=None, employee_id=None):
    allowed = await employee_ids(session, actor)
    stmt = (
        _stmt()
        .where(EmployeeTransfer.archived_at.is_(None))
        .order_by(EmployeeTransfer.created_at.desc())
    )
    if allowed is not None:
        stmt = stmt.where(EmployeeTransfer.employee_id.in_(allowed))
    if status:
        stmt = stmt.where(EmployeeTransfer.status == status)
    if employee_id:
        stmt = stmt.where(EmployeeTransfer.employee_id == employee_id)
    return [await _payload(row, actor, session) for row in await session.scalars(stmt)]


async def get_transfer(session, actor, transfer_id):
    return await _payload(await _transfer(session, actor, transfer_id), actor, session)


async def options(session, actor):
    allowed = await employee_ids(session, actor)
    stmt = select(User).where(User.account_status == AccountStatus.ACTIVE).order_by(User.full_name)
    if allowed is not None:
        stmt = stmt.where(User.id.in_(allowed))
    employees = list(await session.scalars(stmt))
    result = {
        "employees": [
            {
                "id": str(u.id),
                "name": u.full_name,
                "employeeCode": u.employee_code,
                "assignment": _snapshot(u),
            }
            for u in employees
        ]
    }
    for name, model in (
        ("offices", Office),
        ("departments", Department),
        ("teams", Team),
        ("designations", Designation),
    ):
        rows = await session.scalars(
            select(model).where(model.status == MasterStatus.ACTIVE).order_by(model.name)
        )
        result[name] = [
            {
                "id": str(r.id),
                "name": r.name,
                "officeId": str(r.office_id) if hasattr(r, "office_id") else None,
                "departmentId": str(r.department_id) if hasattr(r, "department_id") else None,
            }
            for r in rows
        ]
    # Manager choices use the existing directory scope; salary and profile data are absent.
    manager_ids = await visible_user_ids(session, actor)
    managers = (
        select(User)
        .join(UserType, User.user_type_id == UserType.id)
        .where(
            User.account_status == AccountStatus.ACTIVE, UserType.can_be_reporting_manager.is_(True)
        )
        .order_by(User.full_name)
    )
    if manager_ids is not None:
        managers = managers.where(User.id.in_(manager_ids))
    result["managers"] = [
        {"id": str(u.id), "name": u.full_name} for u in await session.scalars(managers)
    ]
    return result


async def create_transfer(session, actor, payload: TransferCreate, *, recommend=False):
    require(actor, "Transfers.Recommend" if recommend else "Transfers.Create")
    user = await _employee(session, actor, payload.employee_id)
    if recommend and (
        user.reporting_manager_id != actor.id
        or user.id == actor.id
        or user.office_id != actor.office_id
        or (actor.team_id and user.team_id != actor.team_id)
    ):
        raise AppError(status_code=404, code="NOT_FOUND", message="Assigned employee was not found")
    _backdate(actor, payload.effective_date, payload.backdate_reason)
    await _validate(session, actor, user, payload.proposed)
    proposed = payload.proposed.model_dump(mode="json")
    if proposed == _snapshot(user):
        raise AppError(
            status_code=422,
            code="TRANSFER_NO_CHANGE",
            message="Choose at least one assignment change",
        )
    if payload.supersedes_id:
        previous = await _transfer(session, actor, payload.supersedes_id)
        if previous.employee_id != user.id or previous.status != "Approved":
            raise AppError(
                status_code=409,
                code="TRANSFER_SUPERSEDE_INVALID",
                message="Only a scheduled transfer can be superseded",
            )
    row = EmployeeTransfer(
        id=new_uuid(),
        employee_id=user.id,
        requested_by_id=actor.id,
        current_snapshot=_snapshot(user),
        proposed=proposed,
        reason=payload.reason,
        effective_date=payload.effective_date,
        requested_date=today(),
        notes=payload.notes,
        backdate_reason=payload.backdate_reason,
        supersedes_id=payload.supersedes_id,
        status="Draft",
        created_at=now(),
        updated_at=now(),
        lock_version=1,
    )
    session.add(row)
    await session.flush()
    await _event(
        session,
        row,
        actor,
        "recommend" if recommend else "create",
        "Submitted" if recommend else "Draft",
        payload.reason,
    )
    await _commit(session)
    return await get_transfer(session, actor, row.id)


async def edit_transfer(session, actor, transfer_id, payload: TransferUpdate):
    require(actor, "Transfers.Edit")
    # Match approval/apply lock ordering before locking a transfer row.
    await session.execute(select(func.pg_advisory_xact_lock(REPORTING_HIERARCHY_LOCK_KEY)))
    row = await _transfer(session, actor, transfer_id, lock=True)
    if row.status not in {"Draft", "Returned"} or row.lock_version != payload.lock_version:
        raise AppError(
            status_code=409, code="TRANSFER_CONFLICT", message="Only the latest draft can be edited"
        )
    user = await _employee(session, actor, row.employee_id)
    _backdate(actor, payload.effective_date, payload.backdate_reason)
    await _validate(session, actor, user, payload.proposed)
    if payload.proposed.model_dump(mode="json") == _snapshot(user):
        raise AppError(
            status_code=422,
            code="TRANSFER_NO_CHANGE",
            message="Choose at least one assignment change",
        )
    row.current_snapshot = _snapshot(user)
    row.proposed = payload.proposed.model_dump(mode="json")
    row.reason, row.notes = payload.reason, payload.notes
    row.effective_date, row.backdate_reason = payload.effective_date, payload.backdate_reason
    await _event(session, row, actor, "edit", "Draft", payload.reason)
    await _commit(session)
    return await get_transfer(session, actor, transfer_id)


async def _apply(session, actor, row):
    if row.effective_date > today():
        raise AppError(
            status_code=409, code="TRANSFER_NOT_DUE", message="Transfer is not yet effective"
        )
    user = await session.scalar(
        select(User)
        .where(User.id == row.employee_id)
        .options(*user_load_options())
        .with_for_update()
    )
    if _snapshot(user) != row.current_snapshot:
        raise AppError(
            status_code=409,
            code="TRANSFER_ASSIGNMENT_CHANGED",
            message="Current assignment changed; prepare a new reviewed transfer",
        )
    proposed = ProposedAssignment.model_validate(row.proposed)
    await _validate(session, actor, user, proposed)
    await update_user(
        session, actor, user, UserUpdateRequest(**proposed.model_dump()), commit=False
    )
    row.applied_at = now()
    row.application_error = None
    await _event(session, row, actor, "apply", "Applied", row.reason)


async def action_transfer(session, actor, transfer_id, payload: TransferAction):
    action = payload.action
    permissions = {
        "submit": "Transfers.Create",
        "review": "Transfers.Review",
        "approve": "Transfers.Approve",
        "apply": "Transfers.Approve",
        "return": "Transfers.ReturnReject",
        "reject": "Transfers.ReturnReject",
        "cancel": "Transfers.Cancel",
    }
    require(actor, permissions[action])
    if action in {"approve", "apply"}:
        if not is_owner(actor):
            raise AppError(status_code=403, code="FORBIDDEN", message="OWNER approval is required")
        await session.execute(select(func.pg_advisory_xact_lock(REPORTING_HIERARCHY_LOCK_KEY)))
    row = await _transfer(session, actor, transfer_id, lock=True)
    allowed = {
        "submit": {"Draft", "Returned"},
        "review": {"Submitted"},
        "approve": {"Reviewed"},
        "apply": {"Approved"},
        "return": {"Submitted", "Reviewed"},
        "reject": {"Submitted", "Reviewed"},
        "cancel": {"Draft", "Returned", "Submitted", "Reviewed", "Approved"},
    }
    if row.lock_version != payload.lock_version or row.status not in allowed[action]:
        raise AppError(
            status_code=409, code="TRANSFER_CONFLICT", message="Reload the latest transfer"
        )
    if action in {"review", "approve", "return", "reject"} and actor.id in {
        row.employee_id,
        row.requested_by_id,
    }:
        raise AppError(
            status_code=403, code="SELF_APPROVAL_FORBIDDEN", message="Self approval is forbidden"
        )
    if action == "cancel" and row.status == "Approved" and not is_owner(actor):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="OWNER must cancel approved transfers"
        )
    if action == "review":
        row.reviewed_by_id = actor.id
    if action == "approve":
        _backdate(actor, row.effective_date, payload.comment)
        row.approved_by_id = actor.id
        if row.effective_date < today():
            row.backdate_reason = payload.comment
        if row.supersedes_id:
            previous = await _transfer(session, actor, row.supersedes_id, lock=True)
            if previous.status != "Approved" or previous.employee_id != row.employee_id:
                raise AppError(
                    status_code=409,
                    code="TRANSFER_SUPERSEDE_INVALID",
                    message="Previous transfer is no longer scheduled",
                )
            await _event(session, previous, actor, "supersede", "Superseded", payload.comment)
    if action == "apply":
        await _apply(session, actor, row)
    else:
        target = {
            "submit": "Submitted",
            "review": "Reviewed",
            "approve": "Approved",
            "return": "Returned",
            "reject": "Rejected",
            "cancel": "Cancelled",
        }[action]
        await _event(session, row, actor, action, target, payload.comment)
        if action == "approve" and row.effective_date <= today():
            await _apply(session, actor, row)
    await _commit(session)
    return await get_transfer(session, actor, transfer_id)


async def apply_due_transfers(session_factory):
    """Apply approved schedules; failures require an explicit reviewed operator action.

    Every API process can run this safely: the same hierarchy/row/version locks used by
    interactive approval serialize workers. No mutable global queue or automatic retry.
    """
    async with session_factory() as session:
        ids = list(
            await session.scalars(
                select(EmployeeTransfer.id).where(
                    EmployeeTransfer.status == "Approved",
                    EmployeeTransfer.effective_date <= today(),
                    EmployeeTransfer.application_error.is_(None),
                    EmployeeTransfer.archived_at.is_(None),
                )
            )
        )
    for transfer_id in ids:
        async with session_factory() as session:
            await session.execute(select(func.pg_advisory_xact_lock(REPORTING_HIERARCHY_LOCK_KEY)))
            row = await session.scalar(
                select(EmployeeTransfer).where(EmployeeTransfer.id == transfer_id).with_for_update()
            )
            if row.status != "Approved" or row.application_error:
                continue
            approver_id = row.approved_by_id
            try:
                actor = await reload_user(session, approver_id) if approver_id else None
                if (
                    actor is None
                    or actor.account_status != AccountStatus.ACTIVE
                    or not is_owner(actor)
                    or not has_permission(actor, "Transfers.Approve")
                ):
                    raise AppError(
                        status_code=403,
                        code="TRANSFER_APPROVER_UNAVAILABLE",
                        message="Original approval authority is unavailable",
                    )
                await _apply(session, actor, row)
                await _commit(session)
            except AppError as exc:
                await session.rollback()
                # Persist a non-sensitive failure code, never repeatedly retry a failed schedule.
                await session.execute(
                    select(func.pg_advisory_xact_lock(REPORTING_HIERARCHY_LOCK_KEY))
                )
                row = await session.scalar(
                    select(EmployeeTransfer)
                    .where(EmployeeTransfer.id == transfer_id)
                    .with_for_update()
                )
                if row.status == "Approved" and row.application_error is None:
                    row.application_error = exc.code
                    row.updated_at = now()
                    await record_audit(
                        session,
                        action="transfer.application_blocked",
                        entity_type="employee_transfer",
                        entity_id=str(row.id),
                        actor_id=approver_id,
                        target_user_id=row.employee_id,
                        old_values={"status": "Approved"},
                        new_values={"error": exc.code},
                        note="Scheduled transfer not applied; operator review required",
                    )
                    await _commit(session)
