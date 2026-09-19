from __future__ import annotations

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field

from nexa_bos_api.api.v1.deps import CurrentUser, require_any_permission, require_permission
from nexa_bos_api.attendance.management_guards import scoped_ids
from nexa_bos_api.attendance.management_service import (
    CSV_HEADERS,
    change_month,
    confirm_import,
    employees,
    load_batch,
    month_state,
    record_approved_leave,
    roster,
    stage_import,
)
from nexa_bos_api.attendance.service import filter_options, list_schedules, utcnow
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission, visibility_scope
from nexa_bos_api.identity.enums import VisibilityScope

router = APIRouter(
    prefix="/management", dependencies=[Depends(require_permission("Attendance.View"))]
)
ViewActor = Annotated[CurrentUser, Depends(require_permission("Attendance.View"))]
UploadActor = Annotated[CurrentUser, Depends(require_permission("Attendance.Upload"))]
ReviewActor = Annotated[
    CurrentUser, Depends(require_any_permission("Attendance.Upload", "Attendance.ConfirmImport"))
]
ConfirmActor = Annotated[CurrentUser, Depends(require_permission("Attendance.ConfirmImport"))]
LeaveActor = Annotated[CurrentUser, Depends(require_permission("Attendance.RecordApprovedLeave"))]
ReportActor = Annotated[CurrentUser, Depends(require_permission("Attendance.Reports"))]


def assert_writer(actor: CurrentUser) -> None:
    if visibility_scope(actor) is VisibilityScope.OFFICE and actor.office_id is None:
        raise AppError(
            status_code=403,
            code="ATTENDANCE_OFFICE_SCOPE_REQUIRED",
            message="Office attendance management requires an assigned office scope.",
        )


class StageRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=2_000_000)


class ConfirmRequest(BaseModel):
    acknowledged_rows: list[int] = Field(default_factory=list, max_length=5000)


class ApprovedLeaveRequest(BaseModel):
    employee_id: UUID
    leave_type_id: UUID
    start_date: date
    end_date: date
    approval_reference: str = Field(min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=4000)


class MonthRequest(BaseModel):
    office_id: UUID
    month: date
    action: Literal["closed", "reopened"]
    reason: str = Field(min_length=1, max_length=2000)


class OfficeHolidayRequest(BaseModel):
    office_id: UUID
    holiday_date: date
    name: str = Field(min_length=1, max_length=200)


@router.get("/options")
async def options(
    session: SessionDep,
    actor: Annotated[
        CurrentUser, Depends(require_any_permission("Attendance.View", "Attendance.Reports"))
    ],
) -> dict:
    data = await filter_options(session, actor)
    offices = {office["id"] for office in data["offices"]}
    data["shifts"] = [row for row in await list_schedules(session) if row["officeId"] in offices]
    from sqlalchemy import select

    from nexa_bos_api.attendance.models import AttendanceRecord
    from nexa_bos_api.identity.models import User

    allowed = await scoped_ids(session, actor)
    query = select(User).where(User.id.in_(select(AttendanceRecord.employee_id)))
    if allowed is not None:
        query = query.where(User.id.in_(allowed))
    history = (await session.scalars(query.order_by(User.full_name))).all()
    data["historyEmployees"] = list(
        {
            row["id"]: row
            for row in [
                *data["employees"],
                *[
                    {
                        "id": str(user.id),
                        "fullName": user.full_name,
                        "employeeCode": user.employee_code,
                        "officeId": str(user.office_id) if user.office_id else None,
                        "departmentId": str(user.department_id) if user.department_id else None,
                    }
                    for user in history
                ],
            ]
        }.values()
    )
    return data


@router.get("/calendar")
async def calendar(session: SessionDep, actor: ViewActor, date_from: date, date_to: date) -> dict:
    if date_to < date_from or (date_to - date_from).days > 365:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_RANGE_INVALID",
            message="Select a valid period of at most one year.",
        )
    from datetime import timedelta

    from sqlalchemy import select

    from nexa_bos_api.attendance.management_guards import storage_ready
    from nexa_bos_api.attendance.management_models import AttendanceOfficeHoliday
    from nexa_bos_api.attendance.service import load_holiday_dates, load_working_weekdays

    options = await filter_options(session, actor)
    offices = {row["id"]: row["name"] for row in options["offices"]}
    working, company = await load_working_weekdays(session), await load_holiday_dates(session)
    office_holidays = (
        {
            (str(row.office_id), row.holiday_date): row.name
            for row in (
                await session.scalars(
                    select(AttendanceOfficeHoliday).where(
                        AttendanceOfficeHoliday.office_id.in_([UUID(key) for key in offices]),
                        AttendanceOfficeHoliday.holiday_date.between(date_from, date_to),
                    )
                )
            ).all()
        }
        if await storage_ready(session)
        else {}
    )
    rows = []
    for offset in range((date_to - date_from).days + 1):
        day = date_from + timedelta(days=offset)
        for identifier, name in offices.items():
            holiday = (
                company[day].name if day in company else office_holidays.get((identifier, day))
            )
            if holiday or working and day.weekday() not in working:
                rows.append(
                    {
                        "date": day.isoformat(),
                        "office": name,
                        "name": holiday or "Week Off",
                        "status": "Holiday" if holiday else "Week Off",
                    }
                )
    return {"items": rows, "workingWeek": sorted(working), "workingDaysConfigured": bool(working)}


@router.get("/roster")
async def get_roster(
    session: SessionDep,
    actor: CurrentUser,
    date_from: date,
    date_to: date,
    office_id: UUID | None = None,
    department_id: UUID | None = None,
    employee_id: UUID | None = None,
    q: str = "",
    shift_id: UUID | None = None,
    status: str | None = None,
    missing_punch: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    if not 1 <= page <= 100000 or not 1 <= page_size <= 100:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_PAGE_INVALID",
            message="Use a valid page and a page size of at most 100.",
        )
    permission = (
        "Attendance.Calendar"
        if employee_id is not None and date_from != date_to
        else "Attendance.Daily"
    )
    if not has_permission(actor, permission):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Attendance view permission is required."
        )
    return await roster(
        session,
        actor,
        date_from=date_from,
        date_to=date_to,
        office_id=office_id,
        department_id=department_id,
        employee_id=employee_id,
        q=q[:200],
        shift_id=shift_id,
        status=status,
        missing_punch=missing_punch,
        page=page,
        page_size=page_size,
    )


@router.get("/imports/template")
async def template(_actor: UploadActor) -> Response:
    from nexa_bos_api.attendance.management_export import csv_bytes

    return Response(
        csv_bytes(CSV_HEADERS, []),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="attendance-template.csv"'},
    )


@router.post("/imports/stage")
async def stage(payload: StageRequest, session: SessionDep, actor: UploadActor) -> dict:
    assert_writer(actor)
    return await stage_import(session, actor, payload.filename, payload.content)


@router.get("/imports/{batch_id}")
async def get_import(batch_id: UUID, session: SessionDep, actor: ReviewActor) -> dict:
    assert_writer(actor)
    from nexa_bos_api.attendance.management_service import serialize_batch

    return serialize_batch(await load_batch(session, actor, batch_id))


@router.get("/imports/{batch_id}/errors")
async def errors(batch_id: UUID, session: SessionDep, actor: ReviewActor) -> Response:
    assert_writer(actor)
    from nexa_bos_api.attendance.management_export import csv_bytes

    batch = await load_batch(session, actor, batch_id)
    rows = [
        {
            **row["values"],
            "Row": row["row"],
            "Classification": row["classification"],
            "Reason": "; ".join(row["reasons"]),
        }
        for row in batch.rows
        if row["classification"] != "Valid"
    ]
    return Response(
        csv_bytes(["Row", *CSV_HEADERS, "Classification", "Reason"], rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{batch.reference}-errors.csv"'},
    )


@router.post("/imports/{batch_id}/confirm")
async def confirm(
    batch_id: UUID, payload: ConfirmRequest, session: SessionDep, actor: ConfirmActor
) -> dict:
    assert_writer(actor)
    return await confirm_import(session, actor, batch_id, payload.acknowledged_rows)


@router.post("/approved-leave")
async def approved_leave(
    payload: ApprovedLeaveRequest, session: SessionDep, actor: LeaveActor
) -> dict:
    assert_writer(actor)
    return await record_approved_leave(
        session,
        actor,
        payload.employee_id,
        payload.leave_type_id,
        payload.start_date,
        payload.end_date,
        payload.approval_reference,
        payload.note,
    )


@router.get("/approved-leave")
async def approved_leave_list(
    session: SessionDep,
    actor: ViewActor,
    date_from: date,
    date_to: date,
    office_id: UUID | None = None,
) -> dict:
    if date_to < date_from or (date_to - date_from).days > 365:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_RANGE_INVALID",
            message="Select a valid date range of at most one year.",
        )
    from nexa_bos_api.attendance.management_guards import storage_ready
    from nexa_bos_api.attendance.management_service import leave_context

    staff = await employees(session, actor, office_id)
    by_id = {str(employee.id): employee for employee in staff}
    rows = await leave_context(
        session,
        [employee.id for employee in staff],
        date_from,
        date_to,
        await storage_ready(session),
    )
    return {
        "items": [
            {
                "employeeId": row["employeeId"],
                "employeeName": by_id[row["employeeId"]].full_name,
                "employeeCode": by_id[row["employeeId"]].employee_code,
                "from": row["from"].isoformat(),
                "to": row["to"].isoformat(),
                "type": row["name"],
                "portion": "Full day" if row["portion"] == "full_day" else "Half day",
            }
            for row in rows
        ]
    }


@router.get("/months")
async def get_month(session: SessionDep, actor: ViewActor, office_id: UUID, month: date) -> dict:
    return await month_state(session, actor, office_id, month)


@router.post("/months")
async def set_month(payload: MonthRequest, session: SessionDep, actor: CurrentUser) -> dict:
    permission = "Attendance.CloseMonth" if payload.action == "closed" else "Attendance.ReopenMonth"
    if not has_permission(actor, permission):
        raise AppError(
            status_code=403,
            code="FORBIDDEN",
            message=(
                "Attendance policy management and the appropriate month permission are required."
            ),
        )
    return await change_month(
        session, actor, payload.office_id, payload.month, payload.action, payload.reason
    )


@router.post("/office-holidays")
async def office_holiday(
    payload: OfficeHolidayRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission("Attendance.ManageHolidays"))],
) -> dict:
    from sqlalchemy import select

    from nexa_bos_api.attendance.management_guards import require_storage
    from nexa_bos_api.attendance.management_models import AttendanceOfficeHoliday
    from nexa_bos_api.attendance.service import _assert_filter_scope
    from nexa_bos_api.identity.audit import record_audit
    from nexa_bos_api.identity.models import Office

    await require_storage(session)
    await _assert_filter_scope(
        session,
        await scoped_ids(session, actor),
        employee_id=None,
        office_id=payload.office_id,
        department_id=None,
    )
    if not await session.get(Office, payload.office_id) or not payload.name.strip():
        raise AppError(
            status_code=422,
            code="ATTENDANCE_HOLIDAY_INVALID",
            message="Select an existing office and a holiday name.",
        )
    row = await session.scalar(
        select(AttendanceOfficeHoliday).where(
            AttendanceOfficeHoliday.office_id == payload.office_id,
            AttendanceOfficeHoliday.holiday_date == payload.holiday_date,
        )
    )
    old = {"name": row.name} if row else None
    if row:
        row.name = payload.name.strip()
    else:
        row = AttendanceOfficeHoliday(
            office_id=payload.office_id,
            holiday_date=payload.holiday_date,
            name=payload.name.strip(),
            actor_id=actor.id,
            created_at=utcnow(),
        )
        session.add(row)
    await session.flush()
    await record_audit(
        session,
        action="attendance.office_holiday.saved",
        entity_type="attendance_holiday",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old,
        new_values={
            "office": str(payload.office_id),
            "date": payload.holiday_date.isoformat(),
            "name": row.name,
        },
    )
    await session.commit()
    return {"message": "Office holiday saved."}


@router.get("/reports", response_model=None)
async def reports(
    session: SessionDep,
    actor: ReportActor,
    date_from: date,
    date_to: date,
    report: str = "monthly",
    office_id: UUID | None = None,
    department_id: UUID | None = None,
    employee_id: UUID | None = None,
    q: str = "",
    shift_id: UUID | None = None,
    status: str | None = None,
    missing_punch: bool = False,
    page: int = 1,
    page_size: int = 20,
    format: Literal["json", "csv", "excel", "pdf", "print"] = "json",
) -> dict | Response:
    from nexa_bos_api.attendance.management_export import render_export, report_data

    if not 1 <= page <= 100000 or not 1 <= page_size <= 100:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_PAGE_INVALID",
            message="Use a valid page and page size.",
        )
    data = await report_data(
        session,
        actor,
        report,
        date_from=date_from,
        date_to=date_to,
        office_id=office_id,
        department_id=department_id,
        employee_id=employee_id,
        q=q[:200],
        shift_id=shift_id,
        status=status,
        missing_punch=missing_punch,
    )
    if format != "json":
        if not has_permission(actor, "Attendance.Export"):
            raise AppError(
                status_code=403,
                code="FORBIDDEN",
                message="Attendance report export permission is required.",
            )
        return render_export(data, format, actor)
    total = len(data["rows"])
    return {
        **data,
        "rows": data["rows"][(page - 1) * page_size : page * page_size],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }
