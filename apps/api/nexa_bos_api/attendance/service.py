from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Select, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.attendance.calc import (
    business_today,
    calculate_attendance,
    select_schedule,
)
from nexa_bos_api.attendance.enums import (
    WEEKDAY_NAMES,
    AttendanceStatus,
    ImpactCondition,
    ImpactMethod,
    ReminderKind,
    ScheduleKind,
)
from nexa_bos_api.attendance.models import (
    AttendanceCorrection,
    AttendanceImpactRule,
    AttendanceRecord,
    AttendanceSchedule,
    CompanyWorkingDay,
    HolidayReminder,
    HolidayReminderDismissal,
    LeaveType,
    OfficialHoliday,
)
from nexa_bos_api.attendance.schemas import (
    AttendanceCorrectionRequest,
    AttendanceEntry,
    HolidayCreateRequest,
    HolidayUpdateRequest,
    ImpactRuleRequest,
    LeaveTypeCreateRequest,
    LeaveTypeUpdateRequest,
    ScheduleCreateRequest,
    ScheduleUpdateRequest,
)
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import can_view_user, visible_user_ids
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus, MasterStatus
from nexa_bos_api.identity.models import Department, Office, User, new_uuid


def utcnow() -> datetime:
    return datetime.now(UTC)


def _time_iso(value: time | None) -> str | None:
    return value.strftime("%H:%M") if value else None


def _decimal_value(value: Decimal | float | int) -> float:
    return float(value)


async def visible_employee_ids(session: AsyncSession, actor: User) -> set[UUID] | None:
    return await visible_user_ids(session, actor)


async def _assert_employee_visible(session: AsyncSession, actor: User, employee: User) -> None:
    if not await can_view_user(session, actor, employee):
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")


async def _load_employee(session: AsyncSession, employee_id: UUID) -> User:
    employee = (
        await session.execute(
            select(User)
            .options(
                selectinload(User.office),
                selectinload(User.department),
                selectinload(User.designation),
            )
            .where(User.id == employee_id)
        )
    ).scalar_one_or_none()
    if employee is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    return employee


def serialize_leave_type(row: LeaveType) -> dict[str, object]:
    return {
        "id": str(row.id),
        "code": row.code,
        "name": row.name,
        "isSystem": row.is_system,
        "status": row.status,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


def serialize_schedule(row: AttendanceSchedule) -> dict[str, object]:
    return {
        "id": str(row.id),
        "officeId": str(row.office_id),
        "departmentId": str(row.department_id) if row.department_id else None,
        "kind": row.kind,
        "startTime": _time_iso(row.start_time),
        "endTime": _time_iso(row.end_time),
        "graceMinutes": row.grace_minutes,
        "ramadanFrom": row.ramadan_from.isoformat() if row.ramadan_from else None,
        "ramadanTo": row.ramadan_to.isoformat() if row.ramadan_to else None,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


def serialize_holiday(row: OfficialHoliday) -> dict[str, object]:
    return {
        "id": str(row.id),
        "holidayDate": row.holiday_date.isoformat(),
        "name": row.name,
        "notes": row.notes,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


def serialize_impact_rule(row: AttendanceImpactRule) -> dict[str, object]:
    return {
        "id": str(row.id),
        "condition": row.condition,
        "leaveTypeId": str(row.leave_type_id) if row.leave_type_id else None,
        "leaveType": serialize_leave_type(row.leave_type) if row.leave_type else None,
        "method": row.method,
        "value": _decimal_value(row.value),
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


def serialize_correction(row: AttendanceCorrection) -> dict[str, object]:
    return {
        "id": str(row.id),
        "attendanceId": str(row.attendance_id),
        "actorId": str(row.actor_id),
        "actorName": row.actor.full_name if row.actor else None,
        "reason": row.reason,
        "oldValues": row.old_values,
        "newValues": row.new_values,
        "createdAt": row.created_at.isoformat(),
    }


def serialize_record(row: AttendanceRecord) -> dict[str, object]:
    employee = row.employee
    return {
        "id": str(row.id),
        "employeeId": str(row.employee_id),
        "employeeCode": employee.employee_code if employee else None,
        "fullName": employee.full_name if employee else None,
        "officeId": str(employee.office_id) if employee and employee.office_id else None,
        "officeName": employee.office.name if employee and employee.office else None,
        "departmentId": str(employee.department_id)
        if employee and employee.department_id
        else None,
        "departmentName": employee.department.name if employee and employee.department else None,
        "attendanceDate": row.attendance_date.isoformat(),
        "status": row.status,
        "timeIn": _time_iso(row.time_in),
        "timeOut": _time_iso(row.time_out),
        "notes": row.notes,
        "leaveTypeId": str(row.leave_type_id) if row.leave_type_id else None,
        "leaveType": serialize_leave_type(row.leave_type) if row.leave_type else None,
        "isLate": row.is_late,
        "lateMinutes": row.late_minutes,
        "isEarlyExit": row.is_early_exit,
        "earlyExitMinutes": row.early_exit_minutes,
        "isIncomplete": row.is_incomplete,
        "calculationState": row.calculation_state,
        "scheduleId": str(row.schedule_id) if row.schedule_id else None,
        "schedule": serialize_schedule(row.schedule) if row.schedule else None,
        "workedOnHoliday": row.worked_on_holiday,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
        "corrections": [serialize_correction(item) for item in row.corrections],
    }


def _record_snapshot(row: AttendanceRecord) -> dict[str, object]:
    return {
        "status": row.status,
        "timeIn": _time_iso(row.time_in),
        "timeOut": _time_iso(row.time_out),
        "notes": row.notes,
        "leaveTypeId": str(row.leave_type_id) if row.leave_type_id else None,
        "isLate": row.is_late,
        "lateMinutes": row.late_minutes,
        "isEarlyExit": row.is_early_exit,
        "earlyExitMinutes": row.early_exit_minutes,
        "isIncomplete": row.is_incomplete,
        "calculationState": row.calculation_state,
        "workedOnHoliday": row.worked_on_holiday,
    }


async def load_working_weekdays(session: AsyncSession) -> set[int]:
    rows = (await session.execute(select(CompanyWorkingDay))).scalars().all()
    return {row.weekday for row in rows}


async def load_holiday_dates(session: AsyncSession) -> dict[date, OfficialHoliday]:
    rows = (await session.execute(select(OfficialHoliday))).scalars().all()
    return {row.holiday_date: row for row in rows}


async def load_schedules(session: AsyncSession) -> list[AttendanceSchedule]:
    return list((await session.execute(select(AttendanceSchedule))).scalars().all())


def suggested_status(
    on_date: date,
    *,
    working_days: set[int],
    holidays: dict[date, OfficialHoliday],
) -> AttendanceStatus | None:
    if on_date in holidays:
        return AttendanceStatus.OFFICIAL_HOLIDAY
    if working_days and on_date.weekday() not in working_days:
        return AttendanceStatus.WEEKLY_OFF
    return None


def date_is_weekly_off(
    on_date: date, working_days: set[int], *, holiday: OfficialHoliday | None = None
) -> bool:
    if holiday is not None or not working_days:
        return False
    return on_date.weekday() not in working_days


def _validate_times(time_in: time | None, time_out: time | None) -> None:
    if time_out is not None and time_in is None:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_TIME_INVALID",
            message="Time Out cannot be set without Time In",
        )
    if time_in is not None and time_out is not None and time_out < time_in:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_TIME_INVALID",
            message="Time Out cannot be earlier than Time In",
        )


async def _leave_type(session: AsyncSession, leave_type_id: UUID | None) -> LeaveType | None:
    if leave_type_id is None:
        return None
    row = await session.get(LeaveType, leave_type_id)
    if row is None or row.status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=422, code="LEAVE_TYPE_INVALID", message="Leave type is not available"
        )
    return row


async def apply_calculation(
    session: AsyncSession,
    record: AttendanceRecord,
    employee: User,
    *,
    schedules: list[AttendanceSchedule] | None = None,
    holidays: dict[date, OfficialHoliday] | None = None,
) -> None:
    holiday_map = holidays if holidays is not None else await load_holiday_dates(session)
    schedule_rows = schedules if schedules is not None else await load_schedules(session)
    schedule = select_schedule(
        schedule_rows,
        office_id=employee.office_id,
        department_id=employee.department_id,
        on_date=record.attendance_date,
    )
    result = calculate_attendance(
        status=AttendanceStatus(record.status),
        time_in=record.time_in,
        time_out=record.time_out,
        schedule=schedule,
        is_official_holiday=record.attendance_date in holiday_map,
    )
    record.is_late = result.is_late
    record.late_minutes = result.late_minutes
    record.is_early_exit = result.is_early_exit
    record.early_exit_minutes = result.early_exit_minutes
    record.is_incomplete = result.is_incomplete
    record.calculation_state = result.calculation_state
    record.schedule_id = result.schedule_id
    record.worked_on_holiday = result.worked_on_holiday


async def get_working_days(session: AsyncSession) -> dict[str, object]:
    weekdays = sorted(await load_working_weekdays(session))
    return {
        "weekdays": weekdays,
        "names": [WEEKDAY_NAMES[day] for day in weekdays],
        "timezone": "Asia/Dubai",
    }


async def set_working_days(
    session: AsyncSession, actor: User, weekdays: list[int]
) -> dict[str, object]:
    unique = sorted({int(day) for day in weekdays})
    if any(day < 0 or day > 6 for day in unique):
        raise AppError(
            status_code=422,
            code="WORKING_DAY_INVALID",
            message="Weekdays must be integers 0 (Monday) through 6 (Sunday)",
        )
    existing = list((await session.execute(select(CompanyWorkingDay))).scalars().all())
    old = sorted(row.weekday for row in existing)
    for row in existing:
        await session.delete(row)
    for day in unique:
        session.add(CompanyWorkingDay(weekday=day))
    await record_audit(
        session,
        action="attendance.working_days",
        entity_type="company_working_days",
        entity_id="company",
        actor_id=actor.id,
        old_values={"weekdays": old},
        new_values={"weekdays": unique},
    )
    await session.commit()
    return await get_working_days(session)


async def list_leave_types(
    session: AsyncSession, *, include_inactive: bool = False
) -> list[dict[str, object]]:
    stmt: Select[tuple[LeaveType]] = select(LeaveType).order_by(LeaveType.code)
    if not include_inactive:
        stmt = stmt.where(LeaveType.status == MasterStatus.ACTIVE)
    rows = (await session.execute(stmt)).scalars().all()
    return [serialize_leave_type(row) for row in rows]


async def create_leave_type(
    session: AsyncSession, actor: User, payload: LeaveTypeCreateRequest
) -> dict[str, object]:
    code = payload.code.strip().upper()
    existing = (
        await session.execute(select(LeaveType).where(LeaveType.code == code))
    ).scalar_one_or_none()
    if existing:
        raise AppError(
            status_code=409, code="LEAVE_TYPE_DUPLICATE", message="Leave type code must be unique"
        )
    now = utcnow()
    row = LeaveType(
        id=new_uuid(),
        code=code,
        name=payload.name.strip(),
        is_system=False,
        status=MasterStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await record_audit(
        session,
        action="attendance.leave_type_create",
        entity_type="leave_type",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values={"code": row.code, "name": row.name},
    )
    await session.commit()
    await session.refresh(row)
    return serialize_leave_type(row)


async def update_leave_type(
    session: AsyncSession, actor: User, leave_type_id: UUID, payload: LeaveTypeUpdateRequest
) -> dict[str, object]:
    row = await session.get(LeaveType, leave_type_id)
    if row is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Leave type was not found")
    if row.is_system and payload.status == MasterStatus.INACTIVE:
        raise AppError(
            status_code=403,
            code="SYSTEM_LEAVE_TYPE_LOCKED",
            message="System leave types cannot be deactivated or deleted",
        )
    old = {"name": row.name, "status": row.status}
    if payload.name:
        row.name = payload.name.strip()
    if payload.status:
        if payload.status not in {MasterStatus.ACTIVE, MasterStatus.INACTIVE}:
            raise AppError(
                status_code=422, code="LEAVE_TYPE_INVALID", message="Invalid leave type status"
            )
        row.status = payload.status
    row.updated_at = utcnow()
    await record_audit(
        session,
        action="attendance.leave_type_update",
        entity_type="leave_type",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old,
        new_values={"name": row.name, "status": row.status},
    )
    await session.commit()
    await session.refresh(row)
    return serialize_leave_type(row)


async def list_schedules(session: AsyncSession) -> list[dict[str, object]]:
    rows = (
        (await session.execute(select(AttendanceSchedule).order_by(AttendanceSchedule.created_at)))
        .scalars()
        .all()
    )
    return [serialize_schedule(row) for row in rows]


def _validate_schedule_times(
    start: time, end: time, kind: str, ramadan_from: date | None, ramadan_to: date | None
) -> None:
    if end <= start:
        raise AppError(
            status_code=422,
            code="SCHEDULE_TIME_INVALID",
            message="Schedule end time must be after start time",
        )
    if kind == ScheduleKind.RAMADAN:
        if ramadan_from is None or ramadan_to is None:
            raise AppError(
                status_code=422,
                code="RAMADAN_DATES_REQUIRED",
                message="Ramadan schedules require explicit effective from and to dates",
            )
        if ramadan_to < ramadan_from:
            raise AppError(
                status_code=422,
                code="RAMADAN_DATES_INVALID",
                message="Ramadan effective to date must be on or after the from date",
            )
    elif ramadan_from is not None or ramadan_to is not None:
        raise AppError(
            status_code=422,
            code="RAMADAN_DATES_INVALID",
            message="Ramadan dates apply only to Ramadan schedules",
        )


async def _assert_office_department(
    session: AsyncSession, office_id: UUID, department_id: UUID | None
) -> None:
    office = await session.get(Office, office_id)
    if office is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Office was not found")
    if department_id is None:
        return
    department = await session.get(Department, department_id)
    if department is None or department.office_id != office_id:
        raise AppError(
            status_code=422,
            code="DEPARTMENT_OFFICE_MISMATCH",
            message="Department must belong to the selected office",
        )


async def create_schedule(
    session: AsyncSession, actor: User, payload: ScheduleCreateRequest
) -> dict[str, object]:
    await _assert_office_department(session, payload.office_id, payload.department_id)
    _validate_schedule_times(
        payload.start_time, payload.end_time, payload.kind, payload.ramadan_from, payload.ramadan_to
    )
    if payload.kind == ScheduleKind.NORMAL:
        existing = (
            await session.execute(
                select(AttendanceSchedule).where(
                    AttendanceSchedule.office_id == payload.office_id,
                    AttendanceSchedule.kind == ScheduleKind.NORMAL,
                    AttendanceSchedule.department_id.is_(None)
                    if payload.department_id is None
                    else AttendanceSchedule.department_id == payload.department_id,
                )
            )
        ).scalar_one_or_none()
        if existing:
            raise AppError(
                status_code=409,
                code="SCHEDULE_DUPLICATE",
                message="A normal schedule already exists for this office or department",
            )
    now = utcnow()
    row = AttendanceSchedule(
        id=new_uuid(),
        office_id=payload.office_id,
        department_id=payload.department_id,
        kind=payload.kind,
        start_time=payload.start_time,
        end_time=payload.end_time,
        grace_minutes=payload.grace_minutes,
        ramadan_from=payload.ramadan_from if payload.kind == ScheduleKind.RAMADAN else None,
        ramadan_to=payload.ramadan_to if payload.kind == ScheduleKind.RAMADAN else None,
        created_at=now,
        updated_at=now,
        created_by_id=actor.id,
    )
    session.add(row)
    await record_audit(
        session,
        action="attendance.schedule_create",
        entity_type="attendance_schedule",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values=serialize_schedule(row),
    )
    await session.commit()
    await session.refresh(row)
    return serialize_schedule(row)


async def update_schedule(
    session: AsyncSession, actor: User, schedule_id: UUID, payload: ScheduleUpdateRequest
) -> dict[str, object]:
    row = await session.get(AttendanceSchedule, schedule_id)
    if row is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Schedule was not found")
    old = serialize_schedule(row)
    if payload.start_time is not None:
        row.start_time = payload.start_time
    if payload.end_time is not None:
        row.end_time = payload.end_time
    if payload.grace_minutes is not None:
        row.grace_minutes = payload.grace_minutes
    if payload.ramadan_from is not None:
        row.ramadan_from = payload.ramadan_from
    if payload.ramadan_to is not None:
        row.ramadan_to = payload.ramadan_to
    _validate_schedule_times(
        row.start_time, row.end_time, row.kind, row.ramadan_from, row.ramadan_to
    )
    row.updated_at = utcnow()
    await record_audit(
        session,
        action="attendance.schedule_update",
        entity_type="attendance_schedule",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old,
        new_values=serialize_schedule(row),
    )
    await session.commit()
    await session.refresh(row)
    return serialize_schedule(row)


async def list_holidays(session: AsyncSession) -> list[dict[str, object]]:
    rows = (
        (await session.execute(select(OfficialHoliday).order_by(OfficialHoliday.holiday_date)))
        .scalars()
        .all()
    )
    today = business_today()
    items = []
    for row in rows:
        payload = serialize_holiday(row)
        payload["isUpcoming"] = row.holiday_date >= today
        payload["automaticReminderDue"] = (
            timedelta(days=0) <= (row.holiday_date - today) <= timedelta(days=7)
        )
        items.append(payload)
    return items


async def create_holiday(
    session: AsyncSession, actor: User, payload: HolidayCreateRequest
) -> dict[str, object]:
    existing = (
        await session.execute(
            select(OfficialHoliday).where(OfficialHoliday.holiday_date == payload.holiday_date)
        )
    ).scalar_one_or_none()
    if existing:
        raise AppError(
            status_code=409,
            code="HOLIDAY_DUPLICATE",
            message="An Official Holiday already exists on this date",
        )
    now = utcnow()
    row = OfficialHoliday(
        id=new_uuid(),
        holiday_date=payload.holiday_date,
        name=payload.name.strip(),
        notes=payload.notes.strip() if payload.notes else None,
        created_at=now,
        updated_at=now,
        created_by_id=actor.id,
        updated_by_id=actor.id,
    )
    session.add(row)
    await record_audit(
        session,
        action="attendance.holiday_create",
        entity_type="official_holiday",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values=serialize_holiday(row),
    )
    await session.commit()
    await session.refresh(row)
    return serialize_holiday(row)


async def update_holiday(
    session: AsyncSession, actor: User, holiday_id: UUID, payload: HolidayUpdateRequest
) -> dict[str, object]:
    row = await session.get(OfficialHoliday, holiday_id)
    if row is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Official Holiday was not found")
    old = serialize_holiday(row)
    if payload.name:
        row.name = payload.name.strip()
    if payload.notes is not None:
        row.notes = payload.notes.strip() or None
    row.updated_at = utcnow()
    row.updated_by_id = actor.id
    await record_audit(
        session,
        action="attendance.holiday_update",
        entity_type="official_holiday",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old,
        new_values=serialize_holiday(row),
    )
    await session.commit()
    await session.refresh(row)
    return serialize_holiday(row)


async def list_impact_rules(session: AsyncSession) -> list[dict[str, object]]:
    rows = (
        (
            await session.execute(
                select(AttendanceImpactRule)
                .options(selectinload(AttendanceImpactRule.leave_type))
                .order_by(AttendanceImpactRule.condition)
            )
        )
        .scalars()
        .all()
    )
    return [serialize_impact_rule(row) for row in rows]


async def upsert_impact_rule(
    session: AsyncSession, actor: User, payload: ImpactRuleRequest
) -> dict[str, object]:
    if payload.condition is ImpactCondition.LEAVE and payload.leave_type_id is None:
        raise AppError(
            status_code=422,
            code="LEAVE_TYPE_REQUIRED",
            message="Leave impact rules require a leave type",
        )
    if payload.condition is not ImpactCondition.LEAVE and payload.leave_type_id is not None:
        raise AppError(
            status_code=422,
            code="LEAVE_TYPE_INVALID",
            message="Leave type applies only to leave impact rules",
        )
    if payload.leave_type_id:
        await _leave_type(session, payload.leave_type_id)
    existing = (
        await session.execute(
            select(AttendanceImpactRule)
            .options(selectinload(AttendanceImpactRule.leave_type))
            .where(
                AttendanceImpactRule.condition == payload.condition,
                AttendanceImpactRule.leave_type_id.is_(None)
                if payload.leave_type_id is None
                else AttendanceImpactRule.leave_type_id == payload.leave_type_id,
            )
        )
    ).scalar_one_or_none()
    now = utcnow()
    if existing:
        old = serialize_impact_rule(existing)
        existing.method = payload.method
        existing.value = payload.value
        existing.updated_at = now
        row = existing
        action = "attendance.impact_rule_update"
    else:
        old = None
        row = AttendanceImpactRule(
            id=new_uuid(),
            condition=payload.condition,
            leave_type_id=payload.leave_type_id,
            method=payload.method,
            value=payload.value,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        action = "attendance.impact_rule_create"
    await session.flush()
    await record_audit(
        session,
        action=action,
        entity_type="attendance_impact_rule",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old,
        new_values={
            "condition": row.condition,
            "method": row.method,
            "value": _decimal_value(row.value),
        },
    )
    await session.commit()
    loaded = (
        await session.execute(
            select(AttendanceImpactRule)
            .options(selectinload(AttendanceImpactRule.leave_type))
            .where(AttendanceImpactRule.id == row.id)
        )
    ).scalar_one()
    return serialize_impact_rule(loaded)


def _apply_entry_status(entry: AttendanceEntry) -> None:
    if entry.status is AttendanceStatus.LEAVE and entry.leave_type_id is None:
        raise AppError(
            status_code=422,
            code="LEAVE_TYPE_REQUIRED",
            message="Leave type is required when status is Leave",
        )
    if entry.status is not AttendanceStatus.LEAVE:
        entry.leave_type_id = None


async def day_roster(
    session: AsyncSession,
    actor: User,
    on_date: date,
    *,
    office_id: UUID | None = None,
    department_id: UUID | None = None,
) -> dict[str, object]:
    allowed = await visible_employee_ids(session, actor)
    stmt = (
        select(User)
        .options(
            selectinload(User.office), selectinload(User.department), selectinload(User.designation)
        )
        .where(User.joining_date <= on_date)
        .where(or_(User.last_working_date.is_(None), User.last_working_date >= on_date))
        .order_by(User.full_name)
    )
    if allowed is not None:
        stmt = stmt.where(User.id.in_(allowed))
    if office_id is not None:
        if allowed is not None:
            visible_offices = {
                row[0]
                for row in (
                    await session.execute(select(User.office_id).where(User.id.in_(allowed)))
                ).all()
                if row[0]
            }
            if office_id not in visible_offices:
                raise AppError(status_code=404, code="NOT_FOUND", message="Office was not found")
        stmt = stmt.where(User.office_id == office_id)
    if department_id is not None:
        if allowed is not None:
            visible_depts = {
                row[0]
                for row in (
                    await session.execute(select(User.department_id).where(User.id.in_(allowed)))
                ).all()
                if row[0]
            }
            if department_id not in visible_depts:
                raise AppError(
                    status_code=404, code="NOT_FOUND", message="Department was not found"
                )
        stmt = stmt.where(User.department_id == department_id)
    employees = list((await session.execute(stmt)).scalars().all())
    employee_ids = [row.id for row in employees]
    records = (
        (
            await session.execute(
                select(AttendanceRecord)
                .options(
                    selectinload(AttendanceRecord.employee).selectinload(User.office),
                    selectinload(AttendanceRecord.employee).selectinload(User.department),
                    selectinload(AttendanceRecord.leave_type),
                    selectinload(AttendanceRecord.schedule),
                    selectinload(AttendanceRecord.corrections).selectinload(
                        AttendanceCorrection.actor
                    ),
                )
                .where(
                    AttendanceRecord.attendance_date == on_date,
                    AttendanceRecord.employee_id.in_(employee_ids) if employee_ids else False,
                )
            )
        )
        .scalars()
        .all()
        if employee_ids
        else []
    )
    by_employee = {row.employee_id: row for row in records}
    working_days = await load_working_weekdays(session)
    holidays = await load_holiday_dates(session)
    holiday = holidays.get(on_date)
    suggested = suggested_status(on_date, working_days=working_days, holidays=holidays)
    items = []
    for employee in employees:
        record = by_employee.get(employee.id)
        items.append(
            {
                "employeeId": str(employee.id),
                "employeeCode": employee.employee_code,
                "fullName": employee.full_name,
                "officeId": str(employee.office_id) if employee.office_id else None,
                "officeName": employee.office.name if employee.office else None,
                "departmentId": str(employee.department_id) if employee.department_id else None,
                "departmentName": employee.department.name if employee.department else None,
                "suggestedStatus": suggested,
                "record": serialize_record(record) if record else None,
            }
        )
    return {
        "date": on_date.isoformat(),
        "timezone": "Asia/Dubai",
        "officialHoliday": serialize_holiday(holiday) if holiday else None,
        "isWeeklyOff": date_is_weekly_off(on_date, working_days, holiday=holiday),
        "suggestedStatus": suggested,
        "items": items,
    }


async def save_attendance(
    session: AsyncSession,
    actor: User,
    attendance_date: date,
    entries: list[AttendanceEntry],
) -> dict[str, object]:
    holidays = await load_holiday_dates(session)
    schedules = await load_schedules(session)
    working_days = await load_working_weekdays(session)
    saved: list[AttendanceRecord] = []
    for entry in entries:
        _apply_entry_status(entry)
        _validate_times(entry.time_in, entry.time_out)
        employee = await _load_employee(session, entry.employee_id)
        await _assert_employee_visible(session, actor, employee)
        if entry.leave_type_id:
            await _leave_type(session, entry.leave_type_id)
        existing = (
            await session.execute(
                select(AttendanceRecord).where(
                    AttendanceRecord.employee_id == employee.id,
                    AttendanceRecord.attendance_date == attendance_date,
                )
            )
        ).scalar_one_or_none()
        now = utcnow()
        if existing:
            old = _record_snapshot(existing)
            existing.status = entry.status
            existing.time_in = entry.time_in
            existing.time_out = entry.time_out
            existing.notes = entry.notes.strip() if entry.notes else None
            existing.leave_type_id = entry.leave_type_id
            existing.updated_at = now
            existing.updated_by_id = actor.id
            await apply_calculation(
                session, existing, employee, schedules=schedules, holidays=holidays
            )
            await record_audit(
                session,
                action="attendance.update",
                entity_type="attendance",
                entity_id=str(existing.id),
                actor_id=actor.id,
                target_user_id=employee.id,
                old_values=old,
                new_values=_record_snapshot(existing),
            )
            saved.append(existing)
        else:
            record = AttendanceRecord(
                id=new_uuid(),
                employee_id=employee.id,
                attendance_date=attendance_date,
                status=entry.status,
                time_in=entry.time_in,
                time_out=entry.time_out,
                notes=entry.notes.strip() if entry.notes else None,
                leave_type_id=entry.leave_type_id,
                created_at=now,
                updated_at=now,
                created_by_id=actor.id,
                updated_by_id=actor.id,
                calculation_state="ok",
            )
            await apply_calculation(
                session, record, employee, schedules=schedules, holidays=holidays
            )
            session.add(record)
            await record_audit(
                session,
                action="attendance.create",
                entity_type="attendance",
                entity_id=str(record.id),
                actor_id=actor.id,
                target_user_id=employee.id,
                new_values=_record_snapshot(record),
            )
            saved.append(record)
    await session.commit()
    ids = [row.id for row in saved]
    loaded = (
        (
            await session.execute(
                select(AttendanceRecord)
                .options(
                    selectinload(AttendanceRecord.employee).selectinload(User.office),
                    selectinload(AttendanceRecord.employee).selectinload(User.department),
                    selectinload(AttendanceRecord.leave_type),
                    selectinload(AttendanceRecord.schedule),
                    selectinload(AttendanceRecord.corrections).selectinload(
                        AttendanceCorrection.actor
                    ),
                )
                .where(AttendanceRecord.id.in_(ids))
            )
        )
        .scalars()
        .all()
    )
    return {
        "date": attendance_date.isoformat(),
        "isWeeklyOff": date_is_weekly_off(
            attendance_date, working_days, holiday=holidays.get(attendance_date)
        ),
        "officialHoliday": serialize_holiday(holidays[attendance_date])
        if attendance_date in holidays
        else None,
        "items": [serialize_record(row) for row in loaded],
    }


async def get_record(session: AsyncSession, actor: User, attendance_id: UUID) -> dict[str, object]:
    row = (
        await session.execute(
            select(AttendanceRecord)
            .options(
                selectinload(AttendanceRecord.employee).selectinload(User.office),
                selectinload(AttendanceRecord.employee).selectinload(User.department),
                selectinload(AttendanceRecord.leave_type),
                selectinload(AttendanceRecord.schedule),
                selectinload(AttendanceRecord.corrections).selectinload(AttendanceCorrection.actor),
            )
            .where(AttendanceRecord.id == attendance_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Attendance record was not found")
    await _assert_employee_visible(session, actor, row.employee)
    return serialize_record(row)


async def correct_attendance(
    session: AsyncSession,
    actor: User,
    attendance_id: UUID,
    payload: AttendanceCorrectionRequest,
) -> dict[str, object]:
    reason = payload.reason.strip()
    if not reason:
        raise AppError(
            status_code=422,
            code="CORRECTION_REASON_REQUIRED",
            message="A correction reason is required",
        )
    row = (
        await session.execute(
            select(AttendanceRecord)
            .options(
                selectinload(AttendanceRecord.employee), selectinload(AttendanceRecord.corrections)
            )
            .where(AttendanceRecord.id == attendance_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Attendance record was not found")
    await _assert_employee_visible(session, actor, row.employee)
    old = _record_snapshot(row)
    status = payload.status or AttendanceStatus(row.status)
    time_in = (
        None
        if payload.clear_time_in
        else (payload.time_in if payload.time_in is not None else row.time_in)
    )
    time_out = (
        None
        if payload.clear_time_out
        else (payload.time_out if payload.time_out is not None else row.time_out)
    )
    leave_type_id = row.leave_type_id
    if payload.status is AttendanceStatus.LEAVE or (
        payload.status is None and row.status == AttendanceStatus.LEAVE
    ):
        if payload.leave_type_id is not None:
            leave_type_id = payload.leave_type_id
        if leave_type_id is None:
            raise AppError(
                status_code=422,
                code="LEAVE_TYPE_REQUIRED",
                message="Leave type is required when status is Leave",
            )
    elif payload.status is not None:
        leave_type_id = None
    if leave_type_id:
        await _leave_type(session, leave_type_id)
    _validate_times(time_in, time_out)
    row.status = status
    row.time_in = time_in
    row.time_out = time_out
    if payload.notes is not None:
        row.notes = payload.notes.strip() or None
    row.leave_type_id = leave_type_id
    row.updated_at = utcnow()
    row.updated_by_id = actor.id
    await apply_calculation(session, row, row.employee)
    new = _record_snapshot(row)
    correction = AttendanceCorrection(
        id=new_uuid(),
        attendance_id=row.id,
        actor_id=actor.id,
        reason=reason,
        old_values=old,
        new_values=new,
        created_at=utcnow(),
    )
    session.add(correction)
    await record_audit(
        session,
        action="attendance.correct",
        entity_type="attendance",
        entity_id=str(row.id),
        actor_id=actor.id,
        target_user_id=row.employee_id,
        old_values=old,
        new_values=new,
        note=reason,
    )
    from nexa_bos_api.notifications.enums import NotificationEventType
    from nexa_bos_api.notifications.service import dispatch_source_event

    await dispatch_source_event(
        session,
        event_type=NotificationEventType.ATTENDANCE_RECORD_CORRECTED,
        source_event_key=str(correction.id),
        affected_user_id=row.employee_id,
        linked_entity_type="attendance_record",
        linked_entity_id=str(row.id),
        contextual_link="/attendance",
        actor_id=actor.id,
    )
    await session.commit()
    session.expire(row, ["corrections"])
    return await get_record(session, actor, row.id)


async def ensure_automatic_reminders(session: AsyncSession, today: date | None = None) -> None:
    as_of = today or business_today()
    window_start = as_of
    window_end = as_of + timedelta(days=7)
    holidays = (
        (
            await session.execute(
                select(OfficialHoliday).where(
                    OfficialHoliday.holiday_date >= window_start,
                    OfficialHoliday.holiday_date <= window_end,
                )
            )
        )
        .scalars()
        .all()
    )
    existing = {
        row.holiday_id
        for row in (
            await session.execute(
                select(HolidayReminder).where(HolidayReminder.kind == ReminderKind.AUTOMATIC)
            )
        )
        .scalars()
        .all()
    }
    now = utcnow()
    for holiday in holidays:
        days_until = (holiday.holiday_date - as_of).days
        if 0 <= days_until <= 7 and holiday.id not in existing:
            inserted_id = await session.scalar(
                insert(HolidayReminder)
                .values(
                    id=new_uuid(),
                    holiday_id=holiday.id,
                    kind=ReminderKind.AUTOMATIC,
                    created_at=now,
                    actor_id=None,
                )
                .on_conflict_do_nothing(
                    index_elements=[HolidayReminder.holiday_id],
                    index_where=HolidayReminder.kind == ReminderKind.AUTOMATIC,
                )
                .returning(HolidayReminder.id)
            )
            if inserted_id is None:
                continue
            from nexa_bos_api.notifications.service import dispatch_holiday_reminder

            await dispatch_holiday_reminder(
                session,
                holiday_id=holiday.id,
                holiday_name=holiday.name,
                holiday_date=holiday.holiday_date.isoformat(),
                kind=ReminderKind.AUTOMATIC,
                actor_id=None,
            )


async def list_reminders(session: AsyncSession, actor: User) -> dict[str, object]:
    await ensure_automatic_reminders(session)
    await session.commit()
    dismissed = {
        row.reminder_id
        for row in (
            await session.execute(
                select(HolidayReminderDismissal).where(HolidayReminderDismissal.user_id == actor.id)
            )
        )
        .scalars()
        .all()
    }
    today = business_today()
    window_end = today + timedelta(days=7)
    rows = (
        (
            await session.execute(
                select(HolidayReminder)
                .join(OfficialHoliday, HolidayReminder.holiday_id == OfficialHoliday.id)
                .options(selectinload(HolidayReminder.holiday))
                .where(
                    or_(
                        OfficialHoliday.holiday_date.between(today, window_end),
                        (HolidayReminder.kind == ReminderKind.URGENT)
                        & (OfficialHoliday.holiday_date >= today),
                    )
                )
                .order_by(HolidayReminder.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    items = []
    seen_holidays: set[UUID] = set()
    for row in rows:
        if row.id in dismissed:
            continue
        holiday = row.holiday
        if holiday is None or holiday.id in seen_holidays:
            continue
        seen_holidays.add(holiday.id)
        items.append(
            {
                "id": str(row.id),
                "kind": row.kind,
                "createdAt": row.created_at.isoformat(),
                "holiday": serialize_holiday(holiday),
                "daysUntil": (holiday.holiday_date - today).days,
            }
        )
        from nexa_bos_api.notifications.service import dispatch_holiday_reminder

        await dispatch_holiday_reminder(
            session,
            holiday_id=holiday.id,
            holiday_name=holiday.name,
            holiday_date=holiday.holiday_date.isoformat(),
            kind=row.kind,
            actor_id=row.actor_id,
        )
    await session.commit()
    return {"items": items, "timezone": "Asia/Dubai"}


async def send_urgent_reminder(
    session: AsyncSession, actor: User, holiday_id: UUID
) -> dict[str, object]:
    holiday = await session.get(OfficialHoliday, holiday_id)
    if holiday is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Official Holiday was not found")
    row = HolidayReminder(
        id=new_uuid(),
        holiday_id=holiday.id,
        kind=ReminderKind.URGENT,
        created_at=utcnow(),
        actor_id=actor.id,
    )
    session.add(row)
    from nexa_bos_api.notifications.service import dispatch_holiday_reminder

    await dispatch_holiday_reminder(
        session,
        holiday_id=holiday.id,
        holiday_name=holiday.name,
        holiday_date=holiday.holiday_date.isoformat(),
        kind=ReminderKind.URGENT,
        actor_id=actor.id,
    )
    await record_audit(
        session,
        action="attendance.holiday_urgent_reminder",
        entity_type="official_holiday",
        entity_id=str(holiday.id),
        actor_id=actor.id,
        new_values={"holidayDate": holiday.holiday_date.isoformat(), "name": holiday.name},
    )
    await session.commit()
    return {"id": str(row.id), "kind": row.kind, "holiday": serialize_holiday(holiday)}


async def dismiss_reminder(
    session: AsyncSession, actor: User, reminder_id: UUID
) -> dict[str, object]:
    reminder = await session.get(HolidayReminder, reminder_id)
    if reminder is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Reminder was not found")
    existing = (
        await session.execute(
            select(HolidayReminderDismissal).where(
                HolidayReminderDismissal.reminder_id == reminder_id,
                HolidayReminderDismissal.user_id == actor.id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(
            HolidayReminderDismissal(
                id=new_uuid(),
                reminder_id=reminder_id,
                user_id=actor.id,
                dismissed_at=utcnow(),
            )
        )
    from nexa_bos_api.notifications.service import mark_holiday_reminder_read

    await mark_holiday_reminder_read(
        session,
        actor_id=actor.id,
        holiday_id=reminder.holiday_id,
        kind=reminder.kind,
    )
    await session.commit()
    return {"ok": True}


def _matching_rules(
    record: AttendanceRecord, rules: list[AttendanceImpactRule]
) -> list[AttendanceImpactRule]:
    matched: list[AttendanceImpactRule] = []
    if record.status == AttendanceStatus.ABSENT:
        return [row for row in rules if row.condition == ImpactCondition.ABSENCE]
    if record.status == AttendanceStatus.LEAVE:
        return [
            row
            for row in rules
            if row.condition == ImpactCondition.LEAVE and row.leave_type_id == record.leave_type_id
        ]
    if record.is_incomplete:
        matched.extend(row for row in rules if row.condition == ImpactCondition.INCOMPLETE)
    if record.is_late:
        matched.extend(row for row in rules if row.condition == ImpactCondition.LATE)
    if record.is_early_exit:
        matched.extend(row for row in rules if row.condition == ImpactCondition.EARLY_EXIT)
    return matched


def compute_score(
    records: list[AttendanceRecord], rules: list[AttendanceImpactRule]
) -> dict[str, object]:
    score = 100.0
    applied: list[dict[str, object]] = []
    for record in records:
        for rule in _matching_rules(record, rules):
            value = float(_decimal_value(rule.value))
            before = score
            if rule.method == ImpactMethod.PERCENTAGE:
                score -= score * (value / 100.0)
            else:
                score -= value
            score = max(0.0, score)
            applied.append(
                {
                    "attendanceId": str(record.id),
                    "date": record.attendance_date.isoformat(),
                    "condition": rule.condition,
                    "method": rule.method,
                    "value": value,
                    "scoreBefore": round(before, 2),
                    "scoreAfter": round(score, 2),
                }
            )
    score = max(0.0, round(score, 2))
    return {"score": score, "impact": round(100.0 - score, 2), "applied": applied}


def _avg_time(values: list[time]) -> str | None:
    if not values:
        return None
    total = sum(item.hour * 60 + item.minute for item in values)
    avg = int(round(total / len(values)))
    return f"{avg // 60:02d}:{avg % 60:02d}"


def summarize_records(
    records: list[AttendanceRecord], rules: list[AttendanceImpactRule]
) -> dict[str, object]:
    present = [row for row in records if row.status == AttendanceStatus.PRESENT]
    absent = [row for row in records if row.status == AttendanceStatus.ABSENT]
    leave = [row for row in records if row.status == AttendanceStatus.LEAVE]
    late = [row for row in present if row.is_late]
    early = [row for row in present if row.is_early_exit]
    incomplete = [row for row in present if row.is_incomplete]
    expected = len(present) + len(absent) + len(leave)
    attendance_pct = round((len(present) / expected) * 100, 2) if expected else None
    late_minutes = [row.late_minutes for row in late]
    early_minutes = [row.early_exit_minutes for row in early]
    score = compute_score(records, rules)
    return {
        "presentCount": len(present),
        "absentCount": len(absent),
        "leaveCount": len(leave),
        "lateCount": len(late),
        "averageLateMinutes": round(sum(late_minutes) / len(late_minutes), 2)
        if late_minutes
        else 0,
        "averageTimeIn": _avg_time([row.time_in for row in present if row.time_in]),
        "averageTimeOut": _avg_time([row.time_out for row in present if row.time_out]),
        "earlyExitCount": len(early),
        "earlyExitMinutes": sum(early_minutes),
        "incompleteCount": len(incomplete),
        "attendancePercent": attendance_pct,
        "attendanceScore": score["score"],
        "attendanceImpact": score["impact"],
        "impactBreakdown": score["applied"],
        "officialHolidayCount": len(
            [row for row in records if row.status == AttendanceStatus.OFFICIAL_HOLIDAY]
        ),
        "weeklyOffCount": len(
            [row for row in records if row.status == AttendanceStatus.WEEKLY_OFF]
        ),
        "workedOnHolidayCount": len([row for row in records if row.worked_on_holiday]),
    }


def _scoped_record_query(
    allowed: set[UUID] | None,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    employee_id: UUID | None = None,
    office_id: UUID | None = None,
    department_id: UUID | None = None,
    status: str | None = None,
    leave_type_id: UUID | None = None,
    late: bool | None = None,
    early_exit: bool | None = None,
    incomplete: bool | None = None,
) -> Select[tuple[AttendanceRecord]]:
    stmt = (
        select(AttendanceRecord)
        .join(User, User.id == AttendanceRecord.employee_id)
        .options(
            selectinload(AttendanceRecord.employee).selectinload(User.office),
            selectinload(AttendanceRecord.employee).selectinload(User.department),
            selectinload(AttendanceRecord.leave_type),
            selectinload(AttendanceRecord.schedule),
            selectinload(AttendanceRecord.corrections).selectinload(AttendanceCorrection.actor),
        )
        .order_by(AttendanceRecord.attendance_date, User.full_name)
    )
    if allowed is not None:
        stmt = stmt.where(AttendanceRecord.employee_id.in_(allowed))
    if date_from:
        stmt = stmt.where(AttendanceRecord.attendance_date >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceRecord.attendance_date <= date_to)
    if employee_id:
        stmt = stmt.where(AttendanceRecord.employee_id == employee_id)
    if office_id:
        stmt = stmt.where(User.office_id == office_id)
    if department_id:
        stmt = stmt.where(User.department_id == department_id)
    if status:
        stmt = stmt.where(AttendanceRecord.status == status)
    if leave_type_id:
        stmt = stmt.where(AttendanceRecord.leave_type_id == leave_type_id)
    if late is True:
        stmt = stmt.where(AttendanceRecord.is_late.is_(True))
    if early_exit is True:
        stmt = stmt.where(AttendanceRecord.is_early_exit.is_(True))
    if incomplete is True:
        stmt = stmt.where(AttendanceRecord.is_incomplete.is_(True))
    return stmt


async def _assert_filter_scope(
    session: AsyncSession,
    allowed: set[UUID] | None,
    *,
    employee_id: UUID | None,
    office_id: UUID | None,
    department_id: UUID | None,
) -> None:
    if allowed is None:
        if employee_id:
            employee = await session.get(User, employee_id)
            if employee is None:
                raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
        return
    if employee_id and employee_id not in allowed:
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    if office_id:
        offices = {
            row[0]
            for row in (
                await session.execute(select(User.office_id).where(User.id.in_(allowed)))
            ).all()
            if row[0]
        }
        if office_id not in offices:
            raise AppError(status_code=404, code="NOT_FOUND", message="Office was not found")
    if department_id:
        depts = {
            row[0]
            for row in (
                await session.execute(select(User.department_id).where(User.id.in_(allowed)))
            ).all()
            if row[0]
        }
        if department_id not in depts:
            raise AppError(status_code=404, code="NOT_FOUND", message="Department was not found")


async def attendance_report(
    session: AsyncSession,
    actor: User,
    *,
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
    if date_to < date_from:
        raise AppError(
            status_code=422,
            code="DATE_RANGE_INVALID",
            message="To date must be on or after From date",
        )
    allowed = await visible_employee_ids(session, actor)
    await _assert_filter_scope(
        session, allowed, employee_id=employee_id, office_id=office_id, department_id=department_id
    )
    records = list(
        (
            await session.execute(
                _scoped_record_query(
                    allowed,
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
                )
            )
        )
        .scalars()
        .all()
    )
    rules = list(
        (
            await session.execute(
                select(AttendanceImpactRule).options(selectinload(AttendanceImpactRule.leave_type))
            )
        )
        .scalars()
        .all()
    )
    return {
        "period": {"from": date_from.isoformat(), "to": date_to.isoformat()},
        "summary": summarize_records(records, rules),
        "items": [serialize_record(row) for row in records],
        "count": len(records),
    }


async def employee_attendance_summary(
    session: AsyncSession,
    actor: User,
    employee_id: UUID,
    *,
    date_from: date,
    date_to: date,
) -> dict[str, object] | None:
    if not await can_view_user(session, actor, await _load_employee(session, employee_id)):
        return None
    allowed = await visible_employee_ids(session, actor)
    if allowed is not None and employee_id not in allowed:
        return None
    records = list(
        (
            await session.execute(
                _scoped_record_query(
                    allowed, date_from=date_from, date_to=date_to, employee_id=employee_id
                )
            )
        )
        .scalars()
        .all()
    )
    rules = list((await session.execute(select(AttendanceImpactRule))).scalars().all())
    return summarize_records(records, rules)


async def filter_options(session: AsyncSession, actor: User) -> dict[str, object]:
    allowed = await visible_employee_ids(session, actor)
    stmt = (
        select(User)
        .options(selectinload(User.office), selectinload(User.department))
        .where(User.account_status == AccountStatus.ACTIVE)
        .order_by(User.full_name)
    )
    if allowed is not None:
        stmt = stmt.where(User.id.in_(allowed))
    employees = list((await session.execute(stmt)).scalars().all())
    offices: dict[UUID, Office] = {}
    departments: dict[UUID, Department] = {}
    for employee in employees:
        if employee.office_id and employee.office:
            offices[employee.office_id] = employee.office
        if employee.department_id and employee.department:
            departments[employee.department_id] = employee.department
    leave_types = await list_leave_types(session)
    return {
        "offices": [
            {"id": str(row.id), "code": row.code, "name": row.name} for row in offices.values()
        ],
        "departments": [
            {
                "id": str(row.id),
                "code": row.code,
                "name": row.name,
                "officeId": str(row.office_id),
            }
            for row in departments.values()
        ],
        "employees": [
            {
                "id": str(row.id),
                "fullName": row.full_name,
                "employeeCode": row.employee_code,
                "officeId": str(row.office_id) if row.office_id else None,
                "departmentId": str(row.department_id) if row.department_id else None,
            }
            for row in employees
        ],
        "leaveTypes": leave_types,
        "statuses": [item.value for item in AttendanceStatus],
        "timezone": "Asia/Dubai",
    }
