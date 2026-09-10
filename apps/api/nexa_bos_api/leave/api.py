from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse

from nexa_bos_api.api.v1.deps import CurrentUser, require_any_permission, require_permission
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.permissions import (
    LEAVE_APPROVE_HR,
    LEAVE_APPROVE_MANAGER,
    LEAVE_CANCEL,
    LEAVE_CREATE_FOR_EMPLOYEE,
    LEAVE_EDIT,
    LEAVE_OVERRIDE,
    LEAVE_REQUEST,
    LEAVE_RETURN_REJECT,
    LEAVE_SETTINGS,
    LEAVE_VIEW,
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
from nexa_bos_api.leave.service import (
    add_balance_adjustment,
    attachment_file,
    balances,
    cancel_request,
    configure_leave_type,
    create_request,
    decide,
    decide_cancellation,
    get_request,
    list_employee_options,
    list_leave_types,
    list_requests,
    team_calendar,
    transition,
    update_request,
    upload_attachment,
)

router = APIRouter(prefix="/leave", tags=["leave"])
LeaveAttachmentFile = Annotated[UploadFile, File()]


@router.get("/employees")
async def leave_employees(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_CREATE_FOR_EMPLOYEE))],
) -> dict[str, object]:
    return {"items": await list_employee_options(session)}


@router.get("/types")
async def leave_types(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_VIEW))],
    include_inactive: bool = False,
) -> dict[str, object]:
    return {"items": await list_leave_types(session, include_inactive=include_inactive)}


@router.patch("/types/{leave_type_id}")
async def leave_type_configure(
    leave_type_id: UUID,
    payload: LeaveTypeConfig,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_SETTINGS))],
) -> dict[str, object]:
    return await configure_leave_type(session, actor, leave_type_id, payload)


@router.get("/requests")
async def requests_list(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_VIEW))],
    status: str | None = None,
    employee_id: UUID | None = None,
) -> dict[str, object]:
    return {"items": await list_requests(session, actor, status=status, employee_id=employee_id)}


@router.post("/requests")
async def requests_create(
    payload: LeaveRequestCreate,
    session: SessionDep,
    actor: Annotated[
        CurrentUser,
        Depends(require_any_permission(LEAVE_REQUEST, LEAVE_CREATE_FOR_EMPLOYEE)),
    ],
) -> dict[str, object]:
    return await create_request(session, actor, payload)


@router.get("/requests/{request_id}")
async def requests_get(
    request_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_VIEW))],
) -> dict[str, object]:
    return await get_request(session, actor, request_id)


@router.patch("/requests/{request_id}")
async def requests_update(
    request_id: UUID,
    payload: LeaveRequestUpdate,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_any_permission(LEAVE_REQUEST, LEAVE_EDIT))],
) -> dict[str, object]:
    return await update_request(session, actor, request_id, payload)


@router.post("/requests/{request_id}/submit")
async def requests_submit(
    request_id: UUID,
    payload: LeaveAction,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_any_permission(LEAVE_REQUEST, LEAVE_EDIT))],
) -> dict[str, object]:
    return await transition(session, actor, request_id, "submit", payload)


@router.post("/requests/{request_id}/manager-approve")
async def requests_manager_approve(
    request_id: UUID,
    payload: LeaveAction,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_APPROVE_MANAGER))],
) -> dict[str, object]:
    return await transition(session, actor, request_id, "manager-approve", payload)


@router.post("/requests/{request_id}/hr-approve")
async def requests_hr_approve(
    request_id: UUID,
    payload: LeaveAction,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_APPROVE_HR))],
) -> dict[str, object]:
    return await transition(session, actor, request_id, "hr-approve", payload)


@router.post("/requests/{request_id}/owner-override")
async def requests_owner_override(
    request_id: UUID,
    payload: LeaveAction,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_OVERRIDE))],
) -> dict[str, object]:
    return await transition(session, actor, request_id, "owner-override", payload)


@router.post("/requests/{request_id}/decision")
async def requests_decide(
    request_id: UUID,
    payload: LeaveDecision,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_RETURN_REJECT))],
) -> dict[str, object]:
    return await decide(session, actor, request_id, payload)


@router.post("/requests/{request_id}/cancel")
async def requests_cancel(
    request_id: UUID,
    payload: LeaveCancellation,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_CANCEL))],
) -> dict[str, object]:
    return await cancel_request(session, actor, request_id, payload)


@router.post("/requests/{request_id}/cancellation-decision")
async def requests_cancellation_decide(
    request_id: UUID,
    payload: LeaveCancellationDecision,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_CANCEL))],
) -> dict[str, object]:
    return await decide_cancellation(session, actor, request_id, payload)


@router.post("/requests/{request_id}/attachment")
async def requests_attachment_upload(
    request_id: UUID,
    session: SessionDep,
    actor: Annotated[
        CurrentUser,
        Depends(require_any_permission(LEAVE_REQUEST, LEAVE_EDIT, LEAVE_CREATE_FOR_EMPLOYEE)),
    ],
    upload: LeaveAttachmentFile,
    reason: str | None = Form(default=None),
) -> dict[str, object]:
    return await upload_attachment(session, actor, request_id, upload, reason=reason)


@router.get("/requests/{request_id}/attachments/{attachment_id}/file")
async def requests_attachment_download(
    request_id: UUID,
    attachment_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_VIEW))],
) -> FileResponse:
    path, content_type, filename = await attachment_file(session, actor, request_id, attachment_id)
    return FileResponse(path, media_type=content_type, filename=filename)


@router.get("/employees/{employee_id}/balances")
async def employee_balances(
    employee_id: UUID,
    year: int,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_VIEW))],
) -> dict[str, object]:
    return await balances(session, actor, employee_id, year)


@router.post("/balance-adjustments")
async def balance_adjustments_create(
    payload: LeaveBalanceAdjustmentCreate,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_SETTINGS))],
) -> dict[str, object]:
    return await add_balance_adjustment(session, actor, payload)


@router.get("/team-calendar")
async def leave_team_calendar(
    date_from: date,
    date_to: date,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(LEAVE_VIEW))],
) -> dict[str, object]:
    return {"items": await team_calendar(session, actor, start=date_from, end=date_to)}
