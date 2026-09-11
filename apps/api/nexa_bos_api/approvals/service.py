from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import selectinload

from nexa_bos_api.approvals.schemas import QueueFilters
from nexa_bos_api.attendance.enums import BUSINESS_TZ
from nexa_bos_api.contracts import service as contracts
from nexa_bos_api.contracts.models import EmploymentContract
from nexa_bos_api.contracts.schemas import ContractAction, ContractDecision
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import has_permission, is_owner, visible_user_ids
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus
from nexa_bos_api.identity.models import User, new_uuid
from nexa_bos_api.identity.users_service import user_load_options
from nexa_bos_api.leave import service as leave
from nexa_bos_api.leave.models import LeaveRequest
from nexa_bos_api.leave.schemas import LeaveAction, LeaveCancellationDecision, LeaveDecision
from nexa_bos_api.notifications.models import Notification, NotificationDelivery
from nexa_bos_api.offboarding import service as exits
from nexa_bos_api.offboarding.models import EmployeeExit
from nexa_bos_api.offboarding.schemas import ExitAction
from nexa_bos_api.transfers import service as transfers
from nexa_bos_api.transfers.models import EmployeeTransfer
from nexa_bos_api.transfers.schemas import TransferAction

MODELS = {
    "Leave": LeaveRequest,
    "Contracts": EmploymentContract,
    "Transfers": EmployeeTransfer,
    "Exit": EmployeeExit,
}
PENDING = {
    "Submitted",
    "Manager Approved",
    "Cancellation Pending",
    "Pending Approval",
    "Reviewed",
    "Notice Period",
    "Clearance in Progress",
    "Ready to Close",
}
LINKS = {"Leave": "/leave", "Contracts": "/contracts", "Transfers": "/transfers", "Exit": "/exits"}


def today():
    return datetime.now(BUSINESS_TZ).date()


def require(actor, code):
    if not has_permission(actor, code):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Approval access is not permitted"
        )


def requester_id(module, row):
    return row.created_by_id if module == "Contracts" else row.requested_by_id


def visible(actor, module, row, ids):
    in_scope = ids is None or row.employee_id in ids
    if module == "Leave":
        return has_permission(actor, "Leave.View") and (
            (has_permission(actor, "Leave.ApproveHR") and in_scope)
            or is_owner(actor)
            or (
                has_permission(actor, "Leave.ApproveManager")
                and row.employee.reporting_manager_id == actor.id
            )
        )
    permission = {
        "Contracts": "Contracts.View",
        "Transfers": "Transfers.View",
        "Exit": "Exits.View",
    }[module]
    return has_permission(actor, permission) and in_scope


def actions(actor, module, row, ids):
    if (
        not has_permission(actor, "Approvals.View")
        or not has_permission(actor, "Approvals.Decide")
        or not visible(actor, module, row, ids)
        or actor.id in {row.employee_id, requester_id(module, row)}
    ):
        return []
    result = []

    def can(code):
        return has_permission(actor, code)

    status = row.status
    if module == "Leave":
        manager = row.employee.reporting_manager_id == actor.id and can("Leave.ApproveManager")
        hr = can("Leave.ApproveHR")
        if status == "Cancellation Pending":
            if can("Leave.Cancel"):
                if (
                    is_owner(actor)
                    or (
                        hr
                        and (
                            not row.employee.reporting_manager_id
                            or row.cancellation_manager_approved_at
                        )
                    )
                    or (manager and not hr and not row.cancellation_manager_approved_at)
                ):
                    result.append("approve")
                if hr or is_owner(actor):
                    result.append("reject")
        else:
            if (status == "Submitted" and manager) or (status == "Manager Approved" and hr):
                result.append("approve")
            if (
                status in {"Submitted", "Manager Approved"}
                and can("Leave.ReturnReject")
                and (manager or hr or is_owner(actor))
            ):
                result += ["reject", "return"]
            if (
                is_owner(actor)
                and can("Leave.Override")
                and status in {"Draft", "Submitted", "Manager Approved", "Returned"}
            ):
                result.append("override")
    elif module == "Contracts" and status == "Pending Approval":
        if is_owner(actor) and can("Contracts.Approve"):
            result.append("approve")
        if can("Contracts.ReturnReject"):
            result += ["reject", "return"]
    elif module == "Transfers":
        if (status == "Submitted" and can("Transfers.Review")) or (
            status == "Reviewed" and is_owner(actor) and can("Transfers.Approve")
        ):
            result.append("approve")
        if status in {"Submitted", "Reviewed"} and can("Transfers.ReturnReject"):
            result += ["reject", "return"]
    elif module == "Exit":
        if (status == "Submitted" and can("Exits.Progress")) or (
            status == "Ready to Close" and is_owner(actor) and can("Exits.Approve")
        ):
            result.append("approve")
        if status == "Submitted" and can("Exits.ReturnReject"):
            result += ["reject", "return"]
    return result


def due_date(module, row):
    if module in {"Leave", "Contracts"}:
        return row.start_date
    return row.effective_date if module == "Transfers" else row.last_working_date


async def records(session, actor):
    ids = await visible_user_ids(session, actor)
    result = []
    for module, model in MODELS.items():
        query = (
            select(model)
            .options(selectinload(model.employee).selectinload(User.department))
            .where(model.archived_at.is_(None))
        )
        # A direct reporting-manager assignment, not a role name or descendant tree,
        # is the only manager approval scope.
        if module == "Leave" and not (has_permission(actor, "Leave.ApproveHR") or is_owner(actor)):
            query = query.join(User, User.id == model.employee_id).where(
                User.reporting_manager_id == actor.id
            )
        elif ids is not None:
            query = query.where(model.employee_id.in_(ids))
        if module != "Leave" and not has_permission(
            actor,
            {"Contracts": "Contracts.View", "Transfers": "Transfers.View", "Exit": "Exits.View"}[
                module
            ],
        ):
            continue
        for row in await session.scalars(query):
            if visible(actor, module, row, ids):
                result.append((module, row))
    return result, ids


async def queue(session, actor, filters):
    require(actor, "Approvals.View")
    rows, ids = await records(session, actor)
    people = list(
        await session.scalars(
            select(User)
            .options(*user_load_options())
            .where(User.account_status == AccountStatus.ACTIVE)
        )
    )
    scopes = {
        person.id: await visible_user_ids(session, person)
        for person in people
        if has_permission(person, "Approvals.Decide")
    }
    names = {person.id: person.full_name for person in people}
    items = []
    for module, row in rows:
        approvers = [
            person
            for person in people
            if person.id in scopes and actions(person, module, row, scopes[person.id])
        ]
        if (
            filters.module
            and filters.module != module
            or filters.status
            and (
                row.status not in PENDING
                if filters.status == "Pending"
                else filters.status != row.status
            )
            or filters.employee
            and filters.employee != row.employee_id
            or filters.requester
            and filters.requester != requester_id(module, row)
            or filters.approver
            and filters.approver not in {person.id for person in approvers}
            or filters.department
            and filters.department != row.employee.department_id
            or filters.date_from
            and row.created_at.astimezone(BUSINESS_TZ).date() < filters.date_from
            or filters.date_to
            and row.created_at.astimezone(BUSINESS_TZ).date() > filters.date_to
        ):
            continue
        due = due_date(module, row)
        items.append(
            {
                "id": str(row.id),
                "module": module,
                "status": row.status,
                "employeeId": str(row.employee_id),
                "employee": row.employee.full_name,
                "requesterId": str(requester_id(module, row)),
                "requester": names.get(requester_id(module, row), "Inactive requester"),
                "department": row.employee.department.name if row.employee.department else None,
                "departmentId": str(row.employee.department_id)
                if row.employee.department_id
                else None,
                "approvers": [
                    {"id": str(person.id), "name": person.full_name} for person in approvers
                ],
                "dueDate": due.isoformat(),
                "createdAt": row.created_at.isoformat(),
                "overdue": row.status in PENDING and due < today(),
                "lockVersion": row.lock_version,
                "actions": actions(actor, module, row, ids),
                "href": LINKS[module],
            }
        )
    return {"items": sorted(items, key=lambda row: row["createdAt"], reverse=True)}


async def decide(session, actor, module, record_id, data):
    require(actor, "Approvals.View")
    require(actor, "Approvals.Decide")
    model = MODELS[module]
    # Underlying services acquire their established locks in their established
    # order. This lookup never takes an inverse lock ahead of those services.
    row = await session.scalar(
        select(model)
        .options(selectinload(model.employee))
        .where(model.id == record_id, model.archived_at.is_(None))
    )
    ids = await visible_user_ids(session, actor)
    if row is None or not visible(actor, module, row, ids):
        raise AppError(status_code=404, code="NOT_FOUND", message="Approval was not found")
    if row.lock_version != data.lock_version:
        raise AppError(
            status_code=409, code="APPROVAL_CONFLICT", message="Reload the latest request"
        )
    if data.action not in actions(actor, module, row, ids):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="This independent decision is not permitted"
        )
    args = {"lock_version": data.lock_version, "comment": data.comment}
    # Do not let this unlocked summary object mask the fresh locked version
    # loaded by the existing workflow service during simultaneous decisions.
    employee = row.employee
    session.expunge(row)
    # The preliminary scope summary must not pin an outdated manager/office
    # assignment in the identity map when the workflow reloads its employee.
    session.expunge(employee)
    if module == "Leave":
        if row.status == "Cancellation Pending":
            await leave.decide_cancellation(
                session,
                actor,
                record_id,
                LeaveCancellationDecision(**args, approve=data.action == "approve"),
            )
        elif data.action in {"return", "reject"}:
            await leave.decide(
                session, actor, record_id, LeaveDecision(**args, decision=data.action)
            )
        else:
            action = (
                "owner-override"
                if data.action == "override"
                else "manager-approve"
                if row.status == "Submitted"
                else "hr-approve"
            )
            await leave.transition(
                session,
                actor,
                record_id,
                action,
                LeaveAction(
                    **args, exception_reason=data.comment if data.action == "override" else None
                ),
            )
    elif module == "Contracts":
        if data.action == "approve":
            await contracts.activate_contract(session, actor, record_id, ContractAction(**args))
        else:
            await contracts.decide_contract(
                session, actor, record_id, ContractDecision(**args, decision=data.action)
            )
    elif module == "Transfers":
        action = (
            ("review" if row.status == "Submitted" else "approve")
            if data.action == "approve"
            else data.action
        )
        await transfers.action_transfer(
            session, actor, record_id, TransferAction(**args, action=action)
        )
    else:
        action = (
            ("notice" if row.status == "Submitted" else "complete")
            if data.action == "approve"
            else data.action
        )
        await exits.action(session, actor, record_id, ExitAction(**args, action=action))
    return {"saved": True}


async def reminders(session, actor):
    require(actor, "Approvals.View")
    created = 0
    for row in (await queue(session, actor, QueueFilters(status="Pending")))["items"]:
        if not row["overdue"] or (not row["actions"] and not is_owner(actor)):
            continue
        key = f"hr.approval:{actor.id}:{row['module']}:{row['id']}:{row['lockVersion']}"
        notification_id = await session.scalar(
            insert(Notification)
            .values(
                id=new_uuid(),
                category="system",
                severity="warning",
                title="Overdue HR workflow",
                message=(
                    "An authorized HR workflow has passed its effective/request date. "
                    "Review the Approval Centre."
                ),
                acknowledgement_required=False,
                source_event_type="hr.approval.overdue",
                source_event_key=key,
                deduplication_key=key,
                contextual_link="/approvals",
                created_by_id=actor.id,
                created_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing(index_elements=[Notification.deduplication_key])
            .returning(Notification.id)
        )
        if notification_id:
            session.add(
                NotificationDelivery(
                    id=new_uuid(),
                    notification_id=notification_id,
                    recipient_id=actor.id,
                    delivered_at=datetime.now(UTC),
                )
            )
            created += 1
    if created:
        await record_audit(
            session,
            action="approval.reminders.generated",
            entity_type="approval_centre",
            entity_id=str(actor.id),
            actor_id=actor.id,
            new_values={"count": created},
        )
    await session.commit()
    return {"created": created}


async def dashboard(session, actor):
    require(actor, "Approvals.View")
    rows, _ = await records(session, actor)
    current = today()
    return {
        "onLeave": sum(
            module == "Leave"
            and row.status in {"HR Approved", "Cancellation Pending"}
            and row.start_date <= current <= row.end_date
            for module, row in rows
        ),
        "pendingApprovals": sum(row.status in PENDING for _, row in rows),
        "expiringContracts": sum(
            module == "Contracts"
            and row.status == "Active"
            and row.end_date is not None
            and current <= row.end_date <= current + timedelta(days=90)
            for module, row in rows
        ),
        "transfersInProgress": sum(
            module == "Transfers" and row.status in {"Submitted", "Reviewed", "Approved"}
            for module, row in rows
        ),
        "exitsInProgress": sum(
            module == "Exit" and row.status not in {"Completed", "Cancelled"}
            for module, row in rows
        ),
    }


async def personal(session, actor):
    # Never accept an employee id from the client. Each section retains its module permission.
    result = {"balances": None, "requests": [], "contract": None, "transfers": [], "exits": []}
    if has_permission(actor, "Leave.View"):
        result["balances"] = (await leave.balances(session, actor, actor.id, today().year))["items"]
        result["requests"] = [
            {
                "id": str(row.id),
                "status": row.status,
                "startDate": row.start_date.isoformat(),
                "endDate": row.end_date.isoformat(),
            }
            for row in await session.scalars(
                select(LeaveRequest)
                .where(LeaveRequest.employee_id == actor.id, LeaveRequest.archived_at.is_(None))
                .order_by(LeaveRequest.created_at.desc())
            )
        ]
    if has_permission(actor, "Contracts.ViewOwn"):
        record = await contracts.own_active_contract(session, actor)
        if record:
            result["contract"] = {
                key: record[key]
                for key in ("id", "contractNumber", "status", "startDate", "endDate")
            }
    for module, permission, key in [
        ("Transfers", "Transfers.ViewOwn", "transfers"),
        ("Exit", "Exits.ViewOwn", "exits"),
    ]:
        if has_permission(actor, permission):
            model = MODELS[module]
            result[key] = [
                {"id": str(row.id), "status": row.status}
                for row in await session.scalars(
                    select(model)
                    .where(model.employee_id == actor.id, model.archived_at.is_(None))
                    .order_by(model.created_at.desc())
                )
            ]
    return result
