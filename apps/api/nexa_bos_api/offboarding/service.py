from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.exc import StaleDataError

from nexa_bos_api.assets.models import AssetAllocation
from nexa_bos_api.attendance.enums import BUSINESS_TZ
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import has_permission, is_owner, visible_user_ids
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus, EmploymentStatus
from nexa_bos_api.identity.models import User, new_uuid
from nexa_bos_api.identity.schemas import UserUpdateRequest
from nexa_bos_api.identity.users_service import (
    REPORTING_HIERARCHY_LOCK_KEY,
    reload_user,
    update_user,
    user_load_options,
)
from nexa_bos_api.offboarding.models import EmployeeExit, ExitClearance, ExitEvent

CHECKLIST = {
    "manager": "Manager handover",
    "assets": "Company assets",
    "it": "IT access",
    "finance": "Finance clearance",
    "hr": "HR documents",
    "approval": "Final approval",
}
DONE = {"Cleared", "Not applicable"}


def now():
    return datetime.now(UTC)


def today():
    return datetime.now(BUSINESS_TZ).date()


def require(actor, permission):
    if not has_permission(actor, permission):
        raise AppError(status_code=403, code="FORBIDDEN", message="Exit action is not permitted")


def conflict(message="Reload the latest exit"):
    return AppError(status_code=409, code="EXIT_CONFLICT", message=message)


async def commit(session):
    try:
        await session.commit()
    except (IntegrityError, StaleDataError) as exc:
        await session.rollback()
        raise conflict() from exc


def stmt():
    return (
        select(EmployeeExit)
        .execution_options(populate_existing=True)
        .options(
            selectinload(EmployeeExit.employee).options(*user_load_options()),
            selectinload(EmployeeExit.requester).options(*user_load_options()),
            selectinload(EmployeeExit.checklist)
            .selectinload(ExitClearance.assignee)
            .options(*user_load_options()),
            selectinload(EmployeeExit.events)
            .selectinload(ExitEvent.actor)
            .options(*user_load_options()),
        )
    )


async def scope(session, actor):
    clauses = []
    if has_permission(actor, "Exits.View"):
        ids = await visible_user_ids(session, actor)
        if ids is None:
            return True
        clauses.append(EmployeeExit.employee_id.in_(ids))
    if has_permission(actor, "Exits.ViewOwn"):
        clauses.append(EmployeeExit.employee_id == actor.id)
    if has_permission(actor, "Exits.Clearance"):
        clauses.append(
            EmployeeExit.id.in_(
                select(ExitClearance.exit_id).where(ExitClearance.assignee_id == actor.id)
            )
        )
    return or_(*clauses) if clauses else False


async def get(session, actor, exit_id, *, lock=False):
    query = stmt().where(
        EmployeeExit.id == exit_id, EmployeeExit.archived_at.is_(None), await scope(session, actor)
    )
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query)
    if row is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Exit was not found")
    return row


def snapshot(row):
    return {
        "status": row.status,
        "exitType": row.exit_type,
        "noticeDate": row.notice_date.isoformat(),
        "lastWorkingDate": row.last_working_date.isoformat(),
        "reason": row.reason,
        "settlementStatus": row.settlement_status,
        "settlementReference": row.settlement_reference,
        "checklist": [
            {
                "key": item.key,
                "assigneeId": str(item.assignee_id) if item.assignee_id else None,
                "status": item.status,
                "note": item.note,
            }
            for item in row.checklist
        ],
    }


async def event(session, row, actor, action, before, comment):
    row.updated_at = now()
    after = snapshot(row)
    session.add(
        ExitEvent(
            id=new_uuid(),
            exit_id=row.id,
            actor_id=actor.id,
            action=action,
            before=before,
            after=after,
            comment=comment,
            created_at=now(),
        )
    )
    await record_audit(
        session,
        action=f"exit.{action}",
        entity_type="employee_exit",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        old_values=before,
        new_values=after,
        note=comment,
    )


async def operational_scope(session, actor, row, *, enforce=False):
    ids = await visible_user_ids(session, actor)
    allowed = has_permission(actor, "Exits.View") and (ids is None or row.employee_id in ids)
    if enforce and not allowed:
        raise AppError(
            status_code=404, code="NOT_FOUND", message="Exit was not found in operational scope"
        )
    return allowed


async def payload(session, row, actor):
    operational = await operational_scope(session, actor, row)
    own = row.employee_id == actor.id
    return {
        "id": str(row.id),
        "employeeId": str(row.employee_id),
        "employee": row.employee.full_name,
        "employeeCode": row.employee.employee_code,
        "requestedById": str(row.requested_by_id),
        "requester": row.requester.full_name,
        "exitType": row.exit_type,
        "status": row.status,
        "requestDate": row.request_date.isoformat(),
        "noticeDate": row.notice_date.isoformat(),
        "lastWorkingDate": row.last_working_date.isoformat(),
        "reason": row.reason if operational or own else None,
        "lockVersion": row.lock_version,
        "settlementStatus": row.settlement_status if operational else None,
        "settlementReference": row.settlement_reference if operational else None,
        "checklist": [
            {
                "key": item.key,
                "label": CHECKLIST[item.key],
                "assigneeId": str(item.assignee_id) if item.assignee_id else None,
                "assignee": item.assignee.full_name if item.assignee else None,
                "status": item.status,
                "note": item.note if operational or item.assignee_id == actor.id else None,
                "updatedAt": item.updated_at.isoformat(),
            }
            for item in row.checklist
            if operational or own or item.assignee_id == actor.id
        ],
        "history": [
            {
                "id": str(e.id),
                "action": e.action,
                "actor": e.actor.full_name,
                "comment": e.comment,
                "createdAt": e.created_at.isoformat(),
                "before": e.before,
                "after": e.after,
            }
            for e in row.events
        ]
        if operational and has_permission(actor, "Exits.History")
        else [],
    }


async def detail(session, actor, exit_id):
    return await payload(session, await get(session, actor, exit_id), actor)


async def listing(session, actor, status=None):
    query = (
        stmt()
        .where(EmployeeExit.archived_at.is_(None), await scope(session, actor))
        .order_by(EmployeeExit.created_at.desc())
    )
    if status:
        query = query.where(EmployeeExit.status == status)
    return [await payload(session, row, actor) for row in await session.scalars(query)]


async def options(session, actor):
    require(actor, "Exits.Create" if not has_permission(actor, "Exits.Assign") else "Exits.Assign")
    ids = await visible_user_ids(session, actor)
    query = (
        select(User)
        .options(*user_load_options())
        .where(User.account_status == AccountStatus.ACTIVE)
        .order_by(User.full_name)
    )
    if ids is not None:
        query = query.where(User.id.in_(ids))
    users = list(await session.scalars(query))
    return {
        "employees": [{"id": str(u.id), "name": u.full_name} for u in users if not is_owner(u)],
        "assignees": [
            {"id": str(u.id), "name": u.full_name, "finalApprover": is_owner(u)}
            for u in users
            if has_permission(u, "Exits.Clearance") or is_owner(u)
        ],
    }


async def employee(session, actor, employee_id):
    if has_permission(actor, "Exits.Create"):
        ids = await visible_user_ids(session, actor)
        if ids is not None and employee_id not in ids:
            raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    elif employee_id != actor.id:
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    user = await reload_user(session, employee_id)
    if user is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    if is_owner(user):
        raise AppError(
            status_code=403, code="OWNER_PROTECTED", message="OWNER cannot be offboarded"
        )
    if user.account_status != AccountStatus.ACTIVE:
        raise conflict("Employee must be active to initiate exit")
    return user


async def create(session, actor, data):
    if not has_permission(actor, "Exits.Create"):
        require(actor, "Exits.Request")
        if data.exit_type != "Resignation":
            raise AppError(
                status_code=403, code="FORBIDDEN", message="Employees may request resignation only"
            )
    await employee(session, actor, data.employee_id)
    row = EmployeeExit(
        id=new_uuid(),
        employee_id=data.employee_id,
        requested_by_id=actor.id,
        exit_type=data.exit_type,
        status="Draft",
        request_date=today(),
        notice_date=data.notice_date,
        last_working_date=data.last_working_date,
        reason=data.reason,
        settlement_status="Not recorded",
        created_at=now(),
        updated_at=now(),
        lock_version=1,
        checklist=[],
    )
    session.add(row)
    for index, key in enumerate(CHECKLIST):
        row.checklist.append(
            ExitClearance(
                id=new_uuid(), key=key, position=index, status="Pending", updated_at=now()
            )
        )
    try:
        await session.flush()
        await event(session, row, actor, "create", {}, data.reason)
        await commit(session)
    except IntegrityError as exc:
        await session.rollback()
        raise conflict("An open exit already exists") from exc
    return await detail(session, actor, row.id)


def version(row, expected):
    if row.lock_version != expected:
        raise conflict()


async def edit(session, actor, exit_id, data):
    row = await get(session, actor, exit_id, lock=True)
    version(row, data.lock_version)
    if row.status != "Draft" or data.employee_id != row.employee_id:
        raise conflict("Only the current draft can be corrected")
    if not has_permission(actor, "Exits.Edit"):
        require(actor, "Exits.Request")
        if (
            row.employee_id != actor.id
            or row.requested_by_id != actor.id
            or data.exit_type != "Resignation"
        ):
            raise AppError(
                status_code=403,
                code="FORBIDDEN",
                message="Only your resignation draft may be edited",
            )
    else:
        await operational_scope(session, actor, row, enforce=True)
    before = snapshot(row)
    row.exit_type, row.notice_date, row.last_working_date, row.reason = (
        data.exit_type,
        data.notice_date,
        data.last_working_date,
        data.reason,
    )
    await event(session, row, actor, "edit", before, data.reason)
    await commit(session)
    return await detail(session, actor, exit_id)


async def clear_item(session, actor, exit_id, key, data):
    require(actor, "Exits.Clearance")
    row = await get(session, actor, exit_id, lock=True)
    version(row, data.lock_version)
    if row.status != "Clearance in Progress":
        raise conflict("Clearance updates require Clearance in Progress")
    item = next((item for item in row.checklist if item.key == key), None)
    if item is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Clearance item was not found")
    before = snapshot(row)
    if "assignee_id" in data.model_fields_set:
        require(actor, "Exits.Assign")
        await operational_scope(session, actor, row, enforce=True)
        if data.status is not None:
            raise AppError(
                status_code=422,
                code="ASSIGN_THEN_CLEAR",
                message="Assign and clear in separate audited actions",
            )
        assignee = await reload_user(session, data.assignee_id) if data.assignee_id else None
        if (
            assignee is None
            or assignee.account_status != AccountStatus.ACTIVE
            or not has_permission(assignee, "Exits.Clearance")
            or assignee.id == row.employee_id
        ):
            raise AppError(
                status_code=422,
                code="ASSIGNEE_INVALID",
                message="Choose an active authorized independent assignee",
            )
        ids = await visible_user_ids(session, actor)
        if ids is not None and assignee.id not in ids:
            raise AppError(status_code=404, code="NOT_FOUND", message="Assignee was not found")
        if key == "approval" and (not is_owner(assignee) or assignee.id == row.requested_by_id):
            raise AppError(
                status_code=422,
                code="APPROVER_INVALID",
                message="Final approval needs independent OWNER",
            )
        if (
            key == "manager"
            and row.employee.reporting_manager_id
            and row.employee.reporting_manager_id != assignee.id
        ):
            raise AppError(
                status_code=422,
                code="MANAGER_INVALID",
                message="Assign the employee's reporting manager",
            )
        item.assignee_id, item.status = assignee.id, "Pending"
    else:
        if item.assignee_id != actor.id or actor.id == row.employee_id:
            raise AppError(
                status_code=403,
                code="FORBIDDEN",
                message="Only the assigned clearance operator may decide",
            )
        if data.status is None:
            raise AppError(
                status_code=422,
                code="CLEARANCE_STATUS_REQUIRED",
                message="Choose a clearance status",
            )
        if (
            key == "manager"
            and row.employee.reporting_manager_id is None
            and data.status == "Cleared"
        ):
            raise AppError(
                status_code=422,
                code="MANAGER_NOT_ASSIGNED",
                message="Record not applicable with a reason when no manager is assigned",
            )
        if key == "approval":
            require(actor, "Exits.Approve")
            if (
                not is_owner(actor)
                or actor.id == row.requested_by_id
                or data.status == "Not applicable"
            ):
                raise AppError(
                    status_code=403,
                    code="SELF_APPROVAL_FORBIDDEN",
                    message="Independent final OWNER approval is required",
                )
        item.status = data.status
    item.note, item.updated_at = data.note, now()
    await event(session, row, actor, f"clearance.{key}", before, data.note)
    await commit(session)
    return await detail(session, actor, exit_id)


async def settlement(session, actor, exit_id, data):
    require(actor, "Exits.Edit")
    row = await get(session, actor, exit_id, lock=True)
    await operational_scope(session, actor, row, enforce=True)
    version(row, data.lock_version)
    if row.status in {"Completed", "Cancelled", "Ready to Close"}:
        raise conflict("Settlement reference is locked in this state")
    before = snapshot(row)
    row.settlement_status, row.settlement_reference = data.status, data.reference
    await event(session, row, actor, "settlement", before, data.comment)
    await commit(session)
    return await detail(session, actor, exit_id)


async def action(session, actor, exit_id, data):
    kind = data.action
    if kind == "complete":
        await session.execute(select(func.pg_advisory_xact_lock(REPORTING_HIERARCHY_LOCK_KEY)))
    row = await get(session, actor, exit_id, lock=True)
    version(row, data.lock_version)
    states = {
        "submit": {"Draft"},
        "notice": {"Submitted"},
        "clearance": {"Notice Period"},
        "ready": {"Clearance in Progress"},
        "complete": {"Ready to Close"},
        "cancel": {
            "Draft",
            "Submitted",
            "Notice Period",
            "Clearance in Progress",
            "Ready to Close",
        },
        "return": {"Submitted"},
        "reject": {"Submitted"},
        "reopen": {"Completed"},
    }
    if row.status not in states[kind]:
        raise conflict("Decision is not available in this state")
    own_request = row.employee_id == actor.id and row.requested_by_id == actor.id
    if kind == "submit":
        if not has_permission(actor, "Exits.Create"):
            require(actor, "Exits.Request")
            if not own_request:
                raise AppError(
                    status_code=403, code="FORBIDDEN", message="Only your request may be submitted"
                )
    elif kind == "cancel" and own_request and row.status in {"Draft", "Submitted"}:
        require(actor, "Exits.Request")
    else:
        require(
            actor,
            "Exits.Approve"
            if kind in {"complete", "reopen"}
            else "Exits.ReturnReject"
            if kind in {"return", "reject"}
            else "Exits.Cancel"
            if kind == "cancel"
            else "Exits.Progress",
        )
        await operational_scope(session, actor, row, enforce=True)
        if actor.id == row.employee_id:
            raise AppError(
                status_code=403,
                code="SELF_APPROVAL_FORBIDDEN",
                message="Independent exit processing is required",
            )
    if kind in {"complete", "reopen"} and not is_owner(actor):
        raise AppError(status_code=403, code="FORBIDDEN", message="OWNER decision is required")
    if (
        kind in {"notice", "ready", "complete", "return", "reject"}
        and actor.id == row.requested_by_id
    ):
        raise AppError(
            status_code=403,
            code="SELF_APPROVAL_FORBIDDEN",
            message="Requester cannot approve own preparation",
        )
    if kind in {"ready", "complete"} and any(
        item.status not in DONE or item.assignee_id is None for item in row.checklist
    ):
        raise conflict("All assigned clearance items and final approval must be complete")
    before = snapshot(row)
    if kind == "complete":
        if row.last_working_date > today():
            raise conflict("Last working date has not arrived")
        target = await session.scalar(
            select(User)
            .where(User.id == row.employee_id)
            .options(*user_load_options())
            .with_for_update()
        )
        if is_owner(target):
            raise AppError(
                status_code=403, code="OWNER_PROTECTED", message="OWNER cannot be offboarded"
            )
        outstanding = await session.scalar(
            select(func.count())
            .select_from(AssetAllocation)
            .where(
                AssetAllocation.employee_id == row.employee_id,
                AssetAllocation.return_date.is_(None),
            )
        )
        if outstanding:
            raise conflict("Return outstanding assets through the existing Asset workflow first")
        employment = (
            EmploymentStatus.RESIGNED
            if row.exit_type == "Resignation"
            else EmploymentStatus.TERMINATED
            if row.exit_type == "Termination"
            else EmploymentStatus.INACTIVE
        )
        await update_user(
            session,
            actor,
            target,
            UserUpdateRequest(
                employment_status=employment, last_working_date=row.last_working_date
            ),
            commit=False,
        )
        row.completed_at = now()
    if kind == "reopen":
        # Reopening the case is not authority to reactivate the employee or old sessions.
        for item in row.checklist:
            item.status, item.note, item.updated_at = "Pending", None, now()
    row.status = {
        "submit": "Submitted",
        "notice": "Notice Period",
        "clearance": "Clearance in Progress",
        "ready": "Ready to Close",
        "complete": "Completed",
        "cancel": "Cancelled",
        "return": "Draft",
        "reject": "Cancelled",
        "reopen": "Clearance in Progress",
    }[kind]
    await event(session, row, actor, kind, before, data.comment)
    await commit(session)
    return await detail(session, actor, exit_id)
