from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.api.v1.pagination import PaginationDep
from nexa_bos_api.attendance.schemas import (
    AttendanceBulkRequest,
    AttendanceCorrectionRequest,
    HolidayCreateRequest,
    HolidayUpdateRequest,
    ImpactRuleRequest,
    LeaveTypeCreateRequest,
    LeaveTypeUpdateRequest,
    ScheduleCreateRequest,
    ScheduleUpdateRequest,
    WorkingDaysUpdate,
)
from nexa_bos_api.attendance.service import (
    attendance_report,
    correct_attendance,
    create_holiday,
    create_leave_type,
    create_schedule,
    day_roster,
    dismiss_reminder,
    employee_attendance_summary,
    filter_options,
    get_record,
    get_working_days,
    list_holidays,
    list_impact_rules,
    list_leave_types,
    list_reminders,
    list_schedules,
    save_attendance,
    send_urgent_reminder,
    set_working_days,
    update_holiday,
    update_leave_type,
    update_schedule,
    upsert_impact_rule,
)
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.permissions import (
    ATTENDANCE_CORRECT,
    ATTENDANCE_MANAGE,
    ATTENDANCE_REPORTS,
    ATTENDANCE_VIEW,
    NOTIFICATIONS_SEND_URGENT,
)

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.get("/working-days")
async def working_days_get(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_VIEW))],
) -> dict[str, object]:
    return await get_working_days(session)


@router.put("/working-days")
async def working_days_put(
    payload: WorkingDaysUpdate,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_MANAGE))],
) -> dict[str, object]:
    return await set_working_days(session, actor, payload.weekdays)


@router.get("/leave-types")
async def leave_types_list(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_VIEW))],
    include_inactive: bool = False,
) -> dict[str, object]:
    return {"items": await list_leave_types(session, include_inactive=include_inactive)}


@router.post("/leave-types")
async def leave_types_create(
    payload: LeaveTypeCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_MANAGE))],
) -> dict[str, object]:
    return await create_leave_type(session, actor, payload)


@router.patch("/leave-types/{leave_type_id}")
async def leave_types_update(
    leave_type_id: UUID,
    payload: LeaveTypeUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_MANAGE))],
) -> dict[str, object]:
    return await update_leave_type(session, actor, leave_type_id, payload)


@router.get("/schedules")
async def schedules_list(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_VIEW))],
) -> dict[str, object]:
    return {"items": await list_schedules(session)}


@router.post("/schedules")
async def schedules_create(
    payload: ScheduleCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_MANAGE))],
) -> dict[str, object]:
    return await create_schedule(session, actor, payload)


@router.patch("/schedules/{schedule_id}")
async def schedules_update(
    schedule_id: UUID,
    payload: ScheduleUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_MANAGE))],
) -> dict[str, object]:
    return await update_schedule(session, actor, schedule_id, payload)


@router.get("/holidays")
async def holidays_list(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_VIEW))],
) -> dict[str, object]:
    return {"items": await list_holidays(session)}


@router.post("/holidays")
async def holidays_create(
    payload: HolidayCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_MANAGE))],
) -> dict[str, object]:
    return await create_holiday(session, actor, payload)


@router.patch("/holidays/{holiday_id}")
async def holidays_update(
    holiday_id: UUID,
    payload: HolidayUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_MANAGE))],
) -> dict[str, object]:
    return await update_holiday(session, actor, holiday_id, payload)


@router.post("/holidays/{holiday_id}/urgent-reminder")
async def holidays_urgent_reminder(
    holiday_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_SEND_URGENT))],
) -> dict[str, object]:
    return await send_urgent_reminder(session, actor, holiday_id)


@router.get("/reminders")
async def reminders_list(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_VIEW))],
) -> dict[str, object]:
    return await list_reminders(session, actor)


@router.post("/reminders/{reminder_id}/dismiss")
async def reminders_dismiss(
    reminder_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_VIEW))],
) -> dict[str, object]:
    return await dismiss_reminder(session, actor, reminder_id)


@router.get("/impact-rules")
async def impact_rules_list(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_VIEW))],
) -> dict[str, object]:
    return {"items": await list_impact_rules(session)}


@router.put("/impact-rules")
async def impact_rules_put(
    payload: ImpactRuleRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_MANAGE))],
) -> dict[str, object]:
    return await upsert_impact_rule(session, actor, payload)


@router.get("/filters")
async def attendance_filters(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_VIEW))],
) -> dict[str, object]:
    return await filter_options(session, actor)


@router.get("/day")
async def attendance_day(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_VIEW))],
    pagination: PaginationDep,
    attendance_date: date,
    office_id: UUID | None = None,
    department_id: UUID | None = None,
) -> dict[str, object]:
    return await day_roster(
        session,
        actor,
        attendance_date,
        office_id=office_id,
        department_id=department_id,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.put("/records")
async def attendance_save(
    payload: AttendanceBulkRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_MANAGE))],
) -> dict[str, object]:
    return await save_attendance(session, actor, payload.attendance_date, payload.entries)


@router.get("/records/{attendance_id}")
async def attendance_get(
    attendance_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_VIEW))],
) -> dict[str, object]:
    return await get_record(session, actor, attendance_id)


@router.post("/records/{attendance_id}/corrections")
async def attendance_correct(
    attendance_id: UUID,
    payload: AttendanceCorrectionRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_CORRECT))],
) -> dict[str, object]:
    return await correct_attendance(session, actor, attendance_id, payload)


@router.get("/reports")
async def attendance_reports(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ATTENDANCE_REPORTS))],
    pagination: PaginationDep,
    date_from: date,
    date_to: date,
    employee_id: UUID | None = None,
    office_id: UUID | None = None,
    department_id: UUID | None = None,
    status: str | None = None,
    leave_type_id: UUID | None = None,
    late: bool | None = None,
    early_exit: bool | None = None,
    incomplete: bool | None = None,
) -> dict[str, object]:
    return await attendance_report(
        session,
        actor,
        date_from=date_from,
        date_to=date_to,
        employee_id=employee_id,
        office_id=office_id,
        department_id=department_id,
        status=status,
        leave_type_id=leave_type_id,
        late=late,
        early_exit=early_exit,
        incomplete=incomplete,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/employees/{employee_id}/summary")
async def attendance_employee_summary(
    employee_id: UUID,
    session: SessionDep,
    actor: CurrentUser,
    date_from: date,
    date_to: date,
) -> dict[str, object]:
    if not (has_permission(actor, ATTENDANCE_VIEW) or has_permission(actor, ATTENDANCE_REPORTS)):
        raise AppError(status_code=403, code="FORBIDDEN", message="Permission denied")
    summary = await employee_attendance_summary(
        session, actor, employee_id, date_from=date_from, date_to=date_to
    )
    if summary is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    return summary
