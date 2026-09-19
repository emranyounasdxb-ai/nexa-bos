from __future__ import annotations

import csv
import hashlib
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from io import StringIO
from pathlib import PurePath
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.attendance.calc import business_today, select_schedule
from nexa_bos_api.attendance.enums import AttendanceStatus
from nexa_bos_api.attendance.management_guards import (
    assert_month_open,
    latest_month,
    lock_month,
    require_storage,
    scoped_ids,
    storage_ready,
)
from nexa_bos_api.attendance.management_models import (
    AttendanceImportBatch,
    AttendanceLeaveEvidence,
    AttendanceMonthEvent,
    AttendanceOfficeHoliday,
    AttendanceProvenance,
)
from nexa_bos_api.attendance.models import AttendanceRecord, LeaveType
from nexa_bos_api.attendance.schemas import AttendanceEntry
from nexa_bos_api.attendance.service import (
    _assert_employee_visible,
    _assert_filter_scope,
    _load_employee,
    _scoped_record_query,
    _worked_minutes,
    load_holiday_dates,
    load_schedules,
    load_working_weekdays,
    save_attendance,
    serialize_record,
    utcnow,
)
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus
from nexa_bos_api.identity.models import Office, User, new_uuid
from nexa_bos_api.leave.enums import APPROVED_STATUSES
from nexa_bos_api.leave.models import LeaveRequest

CSV_HEADERS = ["Employee Code", "Attendance Date", "Time In", "Time Out", "Status", "Notes"]


def actor_snapshot(actor: User) -> dict:
    return {
        "userId": str(actor.id),
        "name": actor.full_name,
        "employeeCode": actor.employee_code,
        "designation": actor.designation.name if actor.designation else None,
        "office": actor.office.name if actor.office else None,
        "officeId": str(actor.office_id) if actor.office_id else None,
    }


async def save_provenance(
    session: AsyncSession,
    actor: User,
    employee: User,
    record: AttendanceRecord,
    source: str,
    batch_id: UUID | None,
) -> None:
    if await storage_ready(session):
        session.add(
            AttendanceProvenance(
                attendance_id=record.id,
                source=source,
                office_id=employee.office_id,
                batch_id=batch_id,
                actor_snapshot=actor_snapshot(actor),
                created_at=utcnow(),
            )
        )


async def employees(
    session: AsyncSession,
    actor: User,
    office_id: UUID | None = None,
    department_id: UUID | None = None,
    employee_id: UUID | None = None,
    *,
    include_inactive: bool = False,
) -> list[User]:
    allowed = await scoped_ids(session, actor)
    await _assert_filter_scope(
        session, allowed, employee_id=employee_id, office_id=office_id, department_id=department_id
    )
    query = (
        select(User)
        .options(
            selectinload(User.office), selectinload(User.department), selectinload(User.designation)
        )
        .order_by(User.full_name, User.id)
    )
    if not include_inactive:
        query = query.where(User.account_status == AccountStatus.ACTIVE)
    if allowed is not None:
        query = query.where(User.id.in_(allowed))
    if office_id:
        query = query.where(User.office_id == office_id)
    if department_id:
        query = query.where(User.department_id == department_id)
    if employee_id:
        query = query.where(User.id == employee_id)
    return list((await session.scalars(query)).all())


async def leave_context(
    session: AsyncSession, employee_ids: list[UUID], start: date, end: date, ready: bool
) -> list[dict]:
    # Deliberately select no medical/private request reasons or attachments.
    requests = (
        await session.execute(
            select(
                LeaveRequest.employee_id,
                LeaveRequest.start_date,
                LeaveRequest.end_date,
                LeaveRequest.leave_type_id,
                LeaveRequest.portion,
                LeaveType.name,
            )
            .join(LeaveType, LeaveType.id == LeaveRequest.leave_type_id)
            .where(
                LeaveRequest.employee_id.in_(employee_ids),
                LeaveRequest.status.in_(APPROVED_STATUSES),
                LeaveRequest.start_date <= end,
                LeaveRequest.end_date >= start,
            )
        )
    ).all()
    rows = [
        {
            "employeeId": str(row.employee_id),
            "from": row.start_date,
            "to": row.end_date,
            "leaveTypeId": str(row.leave_type_id),
            "name": row.name,
            "portion": row.portion,
        }
        for row in requests
    ]
    if ready:
        evidence = (
            await session.execute(
                select(AttendanceLeaveEvidence, LeaveType.name)
                .join(LeaveType, LeaveType.id == AttendanceLeaveEvidence.leave_type_id)
                .where(
                    AttendanceLeaveEvidence.employee_id.in_(employee_ids),
                    AttendanceLeaveEvidence.start_date <= end,
                    AttendanceLeaveEvidence.end_date >= start,
                )
            )
        ).all()
        rows += [
            {
                "employeeId": str(row.employee_id),
                "from": row.start_date,
                "to": row.end_date,
                "leaveTypeId": str(row.leave_type_id),
                "name": name,
                "portion": "full_day",
            }
            for row, name in evidence
        ]
    return rows


async def roster(
    session: AsyncSession,
    actor: User,
    *,
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
    all_rows: bool = False,
    include_inactive: bool = False,
) -> dict:
    if date_to < date_from or (date_to - date_from).days > 365:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_RANGE_INVALID",
            message="Select a date range of at most one year.",
        )
    staff = await employees(
        session,
        actor,
        office_id,
        department_id,
        employee_id,
        include_inactive=include_inactive or bool(employee_id) or date_to < business_today(),
    )
    if len(staff) * ((date_to - date_from).days + 1) > 100000:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_RANGE_TOO_LARGE",
            message="Select a shorter period or one employee.",
        )
    ids = [employee.id for employee in staff]
    records = list(
        (
            await session.scalars(
                _scoped_record_query(set(ids), date_from=date_from, date_to=date_to)
            )
        ).all()
    )
    by_day = {(record.employee_id, record.attendance_date): record for record in records}
    schedules = await load_schedules(session)
    holidays = await load_holiday_dates(session)
    working = await load_working_weekdays(session)
    ready = await storage_ready(session)
    leave = await leave_context(session, ids, date_from, date_to, ready)
    office_holidays = {}
    provenance = {}
    closed_months = {}
    if ready:
        office_ids = {employee.office_id for employee in staff if employee.office_id}
        office_holidays = {
            (row.office_id, row.holiday_date): row.name
            for row in (
                await session.scalars(
                    select(AttendanceOfficeHoliday).where(
                        AttendanceOfficeHoliday.office_id.in_(office_ids),
                        AttendanceOfficeHoliday.holiday_date.between(date_from, date_to),
                    )
                )
            ).all()
        }
        provenance = {
            row.attendance_id: row
            for row in (
                await session.scalars(
                    select(AttendanceProvenance).where(
                        AttendanceProvenance.attendance_id.in_([record.id for record in records])
                    )
                )
            ).all()
        }
        for month_event in (
            await session.scalars(
                select(AttendanceMonthEvent)
                .where(
                    AttendanceMonthEvent.office_id.in_(office_ids),
                    AttendanceMonthEvent.month.between(
                        date_from.replace(day=1), date_to.replace(day=1)
                    ),
                )
                .order_by(AttendanceMonthEvent.created_at, AttendanceMonthEvent.id)
            )
        ).all():
            closed_months[(month_event.office_id, month_event.month)] = (
                month_event.action == "closed"
            )
    today = business_today()
    rows = []
    for day_offset in range((date_to - date_from).days + 1):
        day = date_from + timedelta(days=day_offset)
        for employee in staff:
            if (
                employee.joining_date
                and day < employee.joining_date
                or employee.last_working_date
                and day > employee.last_working_date
            ):
                continue
            record = by_day.get((employee.id, day))
            if employee.joining_date is None and record is None and day != today:
                continue
            origin = provenance.get(record.id) if record else None
            if (
                origin
                and origin.office_id
                and actor.user_type
                and actor.user_type.code == "ADMIN_OFFICER"
                and origin.office_id != actor.office_id
            ):
                continue
            schedule = select_schedule(
                schedules,
                office_id=employee.office_id,
                department_id=employee.department_id,
                on_date=day,
            )
            holiday = holidays.get(day)
            holiday_name = (
                holiday.name if holiday else office_holidays.get((employee.office_id, day))
            )
            weekly_off = bool(working and day.weekday() not in working and not holiday_name)
            known_off = bool(
                holiday_name
                or weekly_off
                or record
                and record.status in {"Official Holiday", "Weekly Off"}
            )
            applicable = [
                item
                for item in leave
                if item["employeeId"] == str(employee.id) and item["from"] <= day <= item["to"]
            ]
            full_leave = any(item["portion"] == "full_day" for item in applicable)
            half_leave = bool(applicable and not full_leave)
            expected = (
                None
                if not working
                else 0.0
                if known_off or full_leave or record and record.status == "Leave"
                else 0.5
                if half_leave
                else 1.0
            )
            missing = bool(
                day <= today
                and (
                    (
                        record
                        and record.status == "Present"
                        and (not record.time_in or not record.time_out)
                    )
                    or (not record and expected and not full_leave)
                )
            )
            display_status = (
                "Holiday"
                if holiday_name and not record
                else "Week Off"
                if weekly_off and not record
                else "Leave"
                if applicable and not record
                else "Missing Punch"
                if missing
                else "Late"
                if record and record.is_late
                else "Holiday"
                if record and record.status == "Official Holiday"
                else "Week Off"
                if record and record.status == "Weekly Off"
                else record.status
                if record
                else "Not recorded"
            )
            exceptions = []
            if missing:
                exceptions.append("Missing punch" if record else "Attendance not recorded")
            if record and record.is_early_exit:
                exceptions.append("Early departure")
            if record and record.calculation_state == "schedule_missing":
                exceptions.append("Shift not configured")
            if record and applicable and record.status != "Leave" and full_leave:
                exceptions.append("Recorded attendance overlaps approved leave")
            if record and record.status == "Present" and (holiday_name or weekly_off):
                exceptions.append("Worked on holiday/week off")
            worked = _worked_minutes(record.time_in, record.time_out) if record else None
            rows.append(
                {
                    "employeeId": str(employee.id),
                    "employeeCode": employee.employee_code,
                    "employeeName": employee.full_name,
                    "officeId": str(employee.office_id) if employee.office_id else None,
                    "office": employee.office.name if employee.office else "Not recorded",
                    "department": employee.department.name
                    if employee.department
                    else "Not recorded",
                    "attendanceDate": day.isoformat(),
                    "shiftId": str(schedule.id) if schedule else None,
                    "shift": f"{schedule.start_time:%H:%M} – {schedule.end_time:%H:%M}"
                    if schedule
                    else "Not configured",
                    "status": display_status,
                    "recordedStatus": record.status if record else None,
                    "timeIn": record.time_in.strftime("%H:%M")
                    if record and record.time_in
                    else None,
                    "timeOut": record.time_out.strftime("%H:%M")
                    if record and record.time_out
                    else None,
                    "workedMinutes": worked,
                    "lateMinutes": record.late_minutes if record else 0,
                    "missingPunch": missing,
                    "leaveHoliday": holiday_name or "Week Off"
                    if weekly_off
                    else holiday_name
                    or ", ".join(
                        item["name"] + (" (half day)" if item["portion"] != "full_day" else "")
                        for item in applicable
                    )
                    or "—",
                    "approvedLeave": full_leave or half_leave,
                    "leaveWeight": 1 if full_leave else 0.5 if half_leave else 0,
                    "holidayWeekOff": known_off,
                    "expected": expected,
                    "exception": "; ".join(exceptions),
                    "source": "Correction"
                    if record and record.corrections
                    else origin.source
                    if origin
                    else "Not recorded",
                    "lastUpdated": record.updated_at.isoformat() if record else None,
                    "monthClosed": closed_months.get(
                        (employee.office_id, day.replace(day=1)), False
                    ),
                    "record": serialize_record(record) if record else None,
                }
            )
    # Summary covers the authorized period before display-only status/search filters.
    expected_known = bool(working)
    expected = sum(row["expected"] or 0 for row in rows) if expected_known else None
    present = (
        sum(row["expected"] or 0 for row in rows if row["recordedStatus"] == "Present")
        if expected_known
        else None
    )
    summary = {
        "totalActiveStaff": sum(
            employee.account_status == AccountStatus.ACTIVE
            and (employee.joining_date is None or employee.joining_date <= today)
            and (employee.last_working_date is None or employee.last_working_date >= today)
            for employee in staff
        ),
        "expected": expected,
        "present": present,
        "absent": sum(row["expected"] or 0 for row in rows if row["recordedStatus"] == "Absent"),
        "late": sum(row["record"] is not None and row["record"]["isLate"] for row in rows),
        "approvedLeave": sum(row["leaveWeight"] for row in rows if not row["holidayWeekOff"]),
        "holidayWeekOff": sum(row["holidayWeekOff"] for row in rows),
        "missingPunch": sum(row["missingPunch"] for row in rows),
        "attendancePercent": round(present / expected * 100, 2) if expected else None,
    }
    if q:
        rows = [
            row
            for row in rows
            if q.lower() in f"{row['employeeName']} {row['employeeCode']}".lower()
        ]
    if shift_id:
        rows = [row for row in rows if row["shiftId"] == str(shift_id)]
    if status:
        rows = [row for row in rows if row["status"] == status or row["recordedStatus"] == status]
    if missing_punch:
        rows = [row for row in rows if row["missingPunch"]]
    total = len(rows)
    return {
        "items": rows if all_rows else rows[(page - 1) * page_size : page * page_size],
        "summary": summary,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "storageReady": ready,
        "workingDaysConfigured": expected_known,
        "timezone": "Asia/Dubai",
    }


async def validate_rows(session: AsyncSession, actor: User, raw_rows: list[dict]) -> list[dict]:
    staff = await employees(session, actor)
    codes = {
        (employee.employee_code or "").casefold(): employee
        for employee in staff
        if employee.employee_code
    }
    # No lookup of out-of-scope employee identity; unknown/inactive/other-office rows fail closed.
    working = await load_working_weekdays(session)
    holidays = await load_holiday_dates(session)
    ready = await storage_ready(session)
    existing = {
        (record.employee_id, record.attendance_date)
        for record in (
            await session.scalars(
                select(AttendanceRecord).where(
                    AttendanceRecord.employee_id.in_([employee.id for employee in staff])
                )
            )
        ).all()
    }
    parsed_dates = []
    for row in raw_rows:
        try:
            parsed_dates.append(date.fromisoformat(str(row.get("Attendance Date", ""))))
        except ValueError:
            pass
    leave = await leave_context(
        session,
        [employee.id for employee in staff],
        min(parsed_dates) if parsed_dates else business_today(),
        max(parsed_dates) if parsed_dates else business_today(),
        ready,
    )
    office_holidays = (
        {
            (row.office_id, row.holiday_date)
            for row in (await session.scalars(select(AttendanceOfficeHoliday))).all()
        }
        if ready
        else set()
    )
    duplicates = Counter(
        (
            str(row.get("Employee Code", "")).strip().casefold(),
            str(row.get("Attendance Date", "")).strip(),
        )
        for row in raw_rows
    )
    results = []
    for index, raw in enumerate(raw_rows, 2):
        errors, warnings = [], []
        code = str(raw.get("Employee Code", "")).strip()
        employee = codes.get(code.casefold())
        if not employee:
            errors.append("Employee code is unknown, inactive or outside your permitted office.")
        if duplicates[(code.casefold(), str(raw.get("Attendance Date", "")).strip())] > 1:
            errors.append("Duplicate employee/date in this file.")
        on_date = None
        time_in = time_out = None
        try:
            value = str(raw.get("Attendance Date", "")).strip()
            on_date = date.fromisoformat(value)
            if value != on_date.isoformat():
                raise ValueError()
            if on_date > business_today():
                errors.append("Future attendance dates cannot be imported.")
        except ValueError:
            errors.append("Attendance Date must be YYYY-MM-DD.")
        for column in ("Time In", "Time Out"):
            value = str(raw.get(column, "")).strip()
            if value:
                try:
                    clock = datetime.strptime(value, "%H:%M").time()
                    if column == "Time In":
                        time_in = clock
                    else:
                        time_out = clock
                except ValueError:
                    errors.append(f"{column} must be HH:mm in 24-hour time.")
        status_value = str(raw.get("Status", "")).strip()
        if status_value not in {status.value for status in AttendanceStatus}:
            errors.append("Status must be Present, Absent, Leave, Official Holiday or Weekly Off.")
        if time_out and not time_in or time_in and time_out and time_out < time_in:
            errors.append("Time Out cannot precede Time In or exist without it.")
        if status_value != "Present" and (time_in or time_out):
            errors.append("Punches are only permitted for Present attendance.")
        if status_value == "Present" and (not time_in or not time_out):
            warnings.append("Missing punch; no time will be invented.")
        applicable = []
        if employee and on_date:
            if (
                employee.joining_date
                and on_date < employee.joining_date
                or employee.last_working_date
                and on_date > employee.last_working_date
            ):
                errors.append("Date is outside this employee's recorded employment period.")
            if (employee.id, on_date) in existing:
                errors.append("Attendance already exists. Use the correction workflow.")
            applicable = [
                row
                for row in leave
                if row["employeeId"] == str(employee.id) and row["from"] <= on_date <= row["to"]
            ]
            if (
                applicable
                and any(row["portion"] == "full_day" for row in applicable)
                and status_value != "Leave"
            ):
                errors.append("Conflicts with approved leave.")
            elif applicable and status_value == "Present":
                warnings.append("Approved half-day leave applies; review these punches.")
            holiday = on_date in holidays or (employee.office_id, on_date) in office_holidays
            off = bool(working and on_date.weekday() not in working)
            if holiday or off:
                if status_value in {"Absent", "Leave"}:
                    errors.append(
                        "Holiday/week off must not be counted as an absence or leave day."
                    )
                elif status_value == "Present":
                    warnings.append(
                        "Present on a holiday/week off; explicitly confirm work was performed."
                    )
            if status_value == "Official Holiday" and not holiday:
                errors.append("No applicable official holiday is configured.")
            if status_value == "Weekly Off" and (not off or holiday):
                errors.append("This is not a configured weekly off.")
            month = await latest_month(session, employee.office_id, on_date)
            if month and month.action == "closed":
                errors.append("Attendance month is closed.")
        if status_value == "Leave" and not applicable:
            errors.append("Record already approved leave in Leave & Holidays first.")
        if len(str(raw.get("Notes", ""))) > 4000:
            errors.append("Notes must be at most 4,000 characters.")
        results.append(
            {
                "row": index,
                "classification": "Error" if errors else "Warning" if warnings else "Valid",
                "reasons": errors + warnings,
                "values": {key: str(raw.get(key, "")) for key in CSV_HEADERS},
                "employeeId": str(employee.id) if employee else None,
                "employeeName": employee.full_name if employee else None,
                "officeId": str(employee.office_id) if employee and employee.office_id else None,
                "leaveTypeId": applicable[0]["leaveTypeId"] if applicable else None,
            }
        )
    return results


def serialize_batch(batch: AttendanceImportBatch) -> dict:
    counts = Counter(row["classification"] for row in batch.rows)
    return {
        "id": str(batch.id),
        "reference": batch.reference,
        "filename": batch.filename,
        "uploader": batch.uploader_snapshot,
        "createdAt": batch.created_at.isoformat(),
        "confirmedAt": batch.confirmed_at.isoformat() if batch.confirmed_at else None,
        "confirmedBy": batch.confirmation_snapshot,
        "counts": {key: counts[key] for key in ("Valid", "Warning", "Error")},
        "rows": batch.rows,
        "results": batch.results or [],
    }


async def stage_import(session: AsyncSession, actor: User, filename: str, content: str) -> dict:
    await require_storage(session)
    if len(content.encode("utf-8")) > 2_000_000:
        raise AppError(
            status_code=413, code="ATTENDANCE_FILE_TOO_LARGE", message="CSV must be at most 2 MB."
        )
    reader = csv.DictReader(StringIO(content.lstrip("\ufeff")), strict=True)
    try:
        headings = reader.fieldnames
    except csv.Error as error:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_CSV_INVALID",
            message="CSV headings have invalid quoting.",
        ) from error
    if headings != CSV_HEADERS:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_TEMPLATE_REQUIRED",
            message="Use the downloadable CSV template without changing its column headings.",
        )
    rows = []
    try:
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise csv.Error("Invalid number of columns")
            rows.append(row)
            if len(rows) > 5000:
                raise AppError(
                    status_code=413,
                    code="ATTENDANCE_ROWS_LIMIT",
                    message="Import at most 5,000 rows per file.",
                )
    except csv.Error as error:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_CSV_INVALID",
            message="CSV has invalid quoting or column counts.",
        ) from error
    if not rows:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_EMPTY_FILE",
            message="CSV contains no attendance rows.",
        )
    fingerprint = hashlib.sha256(content.lstrip("\ufeff").encode()).hexdigest()
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"),
        {
            "key": int.from_bytes(
                hashlib.sha256(f"attendance-import:{actor.id}:{fingerprint}".encode()).digest()[:8],
                "big",
                signed=True,
            )
        },
    )
    prior = await session.scalar(
        select(AttendanceImportBatch).where(
            AttendanceImportBatch.uploader_id == actor.id,
            AttendanceImportBatch.fingerprint == fingerprint,
        )
    )
    if prior:
        if prior.confirmed_at:
            raise AppError(
                status_code=409,
                code="ATTENDANCE_ALREADY_IMPORTED",
                message="This file has already been imported.",
            )
        fresh = await validate_rows(session, actor, rows)
        result = serialize_batch(prior)
        result["rows"] = fresh
        counts = Counter(row["classification"] for row in fresh)
        result["counts"] = {key: counts[key] for key in ("Valid", "Warning", "Error")}
        return result
    results = await validate_rows(session, actor, rows)
    now, identifier = utcnow(), new_uuid()
    batch = AttendanceImportBatch(
        id=identifier,
        reference=f"ATT-IMP-{now:%Y%m%d}-{identifier.hex[:8].upper()}",
        filename=PurePath(filename.replace("\\", "/")).name[:255] or "attendance.csv",
        fingerprint=fingerprint,
        office_id=actor.office_id,
        uploader_id=actor.id,
        uploader_snapshot=actor_snapshot(actor),
        rows=results,
        created_at=now,
    )
    session.add(batch)
    await record_audit(
        session,
        action="attendance.import.staged",
        entity_type="attendance_import",
        entity_id=str(identifier),
        actor_id=actor.id,
        new_values={"reference": batch.reference, "rowCount": len(rows)},
    )
    await session.commit()
    return serialize_batch(batch)


async def load_batch(
    session: AsyncSession, actor: User, batch_id: UUID, *, lock: bool = False
) -> AttendanceImportBatch:
    await require_storage(session)
    query = select(AttendanceImportBatch).where(AttendanceImportBatch.id == batch_id)
    if lock:
        query = query.with_for_update()
    batch = await session.scalar(query)
    if batch is None or batch.uploader_id != actor.id:
        raise AppError(status_code=404, code="NOT_FOUND", message="Import was not found.")
    return batch


async def confirm_import(
    session: AsyncSession, actor: User, batch_id: UUID, acknowledged_rows: list[int]
) -> dict:
    batch = await load_batch(session, actor, batch_id, lock=True)
    if batch.confirmed_at:
        raise AppError(
            status_code=409,
            code="ATTENDANCE_ALREADY_IMPORTED",
            message="This import was already confirmed.",
        )
    checked = await validate_rows(session, actor, [row["values"] for row in batch.rows])
    if any(row["classification"] == "Error" for row in checked):
        raise AppError(
            status_code=409,
            code="ATTENDANCE_IMPORT_CONFLICT",
            message=(
                "Rows now contain errors or existing attendance. Correct the file and "
                "re-upload; nothing was imported."
            ),
        )
    if any(
        row["classification"] == "Warning" and row["row"] not in acknowledged_rows
        for row in checked
    ):
        raise AppError(
            status_code=422,
            code="ATTENDANCE_WARNINGS_REQUIRED",
            message="Explicitly acknowledge every warning row before Confirm Import.",
        )
    original_scope = [(row["employeeId"], row["officeId"], row["leaveTypeId"]) for row in checked]
    # Lock all months in one deterministic order; revalidate after locks to prevent races.
    months = sorted(
        {(row["officeId"], row["values"]["Attendance Date"][:7]) for row in checked},
        key=lambda value: (str(value[0]), value[1]),
    )
    for office, month in months:
        await assert_month_open(
            session, UUID(office) if office else None, date.fromisoformat(month + "-01")
        )
    checked = await validate_rows(session, actor, [row["values"] for row in batch.rows])
    if any(
        row["classification"] == "Error"
        or row["classification"] == "Warning"
        and row["row"] not in acknowledged_rows
        for row in checked
    ):
        raise AppError(
            status_code=409,
            code="ATTENDANCE_IMPORT_CHANGED",
            message=(
                "Attendance or policies changed during confirmation. Refresh and "
                "re-upload; nothing was imported."
            ),
        )
    if original_scope != [
        (row["employeeId"], row["officeId"], row["leaveTypeId"]) for row in checked
    ]:
        raise AppError(
            status_code=409,
            code="ATTENDANCE_IMPORT_CHANGED",
            message=(
                "Employee scope or approved leave changed during confirmation. "
                "Re-upload; nothing was imported."
            ),
        )
    grouped: dict[date, list[AttendanceEntry]] = defaultdict(list)
    for row in checked:
        values = row["values"]
        grouped[date.fromisoformat(values["Attendance Date"].strip())].append(
            AttendanceEntry(
                employee_id=UUID(row["employeeId"]),
                status=AttendanceStatus(values["Status"].strip()),
                time_in=time.fromisoformat(values["Time In"].strip())
                if values["Time In"].strip()
                else None,
                time_out=time.fromisoformat(values["Time Out"].strip())
                if values["Time Out"].strip()
                else None,
                notes=values["Notes"],
                leave_type_id=UUID(row["leaveTypeId"])
                if values["Status"].strip() == "Leave" and row["leaveTypeId"]
                else None,
            )
        )
    saved = []
    for day, entries in sorted(grouped.items()):
        await save_attendance(
            session, actor, day, entries, commit=False, source="CSV import", batch_id=batch.id
        )
        saved.extend(
            {
                "row": row["row"],
                "employeeCode": row["values"]["Employee Code"],
                "date": day.isoformat(),
                "result": "Imported",
                "classification": row["classification"],
                "reasons": row["reasons"],
                "warningsAcknowledged": row["row"] in acknowledged_rows,
            }
            for row in checked
            if row["values"]["Attendance Date"].strip() == day.isoformat()
        )
    batch.confirmed_at = utcnow()
    batch.confirmed_by_id = actor.id
    batch.confirmation_snapshot = actor_snapshot(actor)
    batch.results = saved
    await record_audit(
        session,
        action="attendance.import.confirmed",
        entity_type="attendance_import",
        entity_id=str(batch.id),
        actor_id=actor.id,
        new_values={"reference": batch.reference, "count": len(saved)},
    )
    await session.commit()
    return serialize_batch(batch)


async def record_approved_leave(
    session: AsyncSession,
    actor: User,
    employee_id: UUID,
    leave_type_id: UUID,
    start: date,
    end: date,
    reference: str,
    note: str | None,
) -> dict:
    await require_storage(session)
    if end < start or (end - start).days > 365 or not reference.strip():
        raise AppError(
            status_code=422,
            code="ATTENDANCE_LEAVE_INVALID",
            message="Provide a valid range of at most one year and the real approval reference.",
        )
    employee = await _load_employee(session, employee_id)
    await _assert_employee_visible(session, actor, employee)
    if not employee.office_id:
        raise AppError(
            status_code=422,
            code="ATTENDANCE_OFFICE_REQUIRED",
            message="Employee needs an assigned office.",
        )
    from nexa_bos_api.attendance.service import _leave_type

    await _leave_type(session, leave_type_id)
    for offset in range((end - start).days + 1):
        await assert_month_open(session, employee.office_id, start + timedelta(days=offset))
    overlap = await leave_context(session, [employee_id], start, end, True)
    if overlap:
        raise AppError(
            status_code=409,
            code="ATTENDANCE_LEAVE_EXISTS",
            message="Approved leave already covers part of this range. Use its existing record.",
        )
    conflicts = await session.scalar(
        select(AttendanceRecord.id)
        .where(
            AttendanceRecord.employee_id == employee_id,
            AttendanceRecord.attendance_date.between(start, end),
            AttendanceRecord.status != "Leave",
        )
        .limit(1)
    )
    if conflicts:
        raise AppError(
            status_code=409,
            code="ATTENDANCE_LEAVE_CONFLICT",
            message=(
                "Existing attendance conflicts with these dates. Correct it with a reason first."
            ),
        )
    evidence = AttendanceLeaveEvidence(
        employee_id=employee_id,
        leave_type_id=leave_type_id,
        office_id=employee.office_id,
        start_date=start,
        end_date=end,
        approval_reference=reference.strip(),
        note=note.strip() if note else None,
        actor_id=actor.id,
        actor_snapshot=actor_snapshot(actor),
        created_at=utcnow(),
    )
    session.add(evidence)
    await session.flush()
    await record_audit(
        session,
        action="attendance.approved_leave.recorded",
        entity_type="attendance_leave",
        entity_id=str(evidence.id),
        actor_id=actor.id,
        target_user_id=employee_id,
        new_values={
            "from": start.isoformat(),
            "to": end.isoformat(),
            "approvalReference": reference.strip(),
        },
    )
    await session.commit()
    return {
        "message": (
            "Already approved leave recorded for attendance. "
            "Leave approvals and balances were not changed."
        )
    }


async def month_state(session: AsyncSession, actor: User, office_id: UUID, month: date) -> dict:
    await _assert_filter_scope(
        session,
        await scoped_ids(session, actor),
        employee_id=None,
        office_id=office_id,
        department_id=None,
    )
    row = await latest_month(session, office_id, month)
    return {
        "closed": bool(row and row.action == "closed"),
        "month": month.replace(day=1).isoformat(),
        "reason": row.reason if row else None,
        "performedBy": row.actor_snapshot if row else None,
        "at": row.created_at.isoformat() if row else None,
        "storageReady": await storage_ready(session),
    }


async def change_month(
    session: AsyncSession, actor: User, office_id: UUID, month: date, action: str, reason: str
) -> dict:
    await require_storage(session)
    if not reason.strip() or month.replace(day=1) > business_today().replace(day=1):
        raise AppError(
            status_code=422,
            code="ATTENDANCE_MONTH_REASON",
            message="A reason and a current or past month are required.",
        )
    if not await session.get(Office, office_id):
        raise AppError(status_code=404, code="NOT_FOUND", message="Office was not found.")
    await month_state(session, actor, office_id, month)
    await lock_month(session, office_id, month)
    prior = await latest_month(session, office_id, month)
    if (
        action == "reopened"
        and (not prior or prior.action != "closed")
        or action == "closed"
        and prior
        and prior.action == "closed"
    ):
        raise AppError(
            status_code=409,
            code="ATTENDANCE_MONTH_STATE",
            message="The month is already in the requested state.",
        )
    event = AttendanceMonthEvent(
        office_id=office_id,
        month=month.replace(day=1),
        action=action,
        reason=reason.strip(),
        actor_id=actor.id,
        actor_snapshot=actor_snapshot(actor),
        created_at=utcnow(),
    )
    session.add(event)
    await record_audit(
        session,
        action=f"attendance.month.{action}",
        entity_type="attendance_month",
        entity_id=f"{office_id}:{month:%Y-%m}",
        actor_id=actor.id,
        note=reason.strip(),
    )
    await session.commit()
    return await month_state(session, actor, office_id, month)


async def validate_manual_context(
    session: AsyncSession, actor: User, employee: User, on_date: date, entry: AttendanceEntry
) -> None:
    from nexa_bos_api.identity.access import has_permission

    context = await leave_context(
        session, [employee.id], on_date, on_date, await storage_ready(session)
    )
    if (
        any(row["portion"] == "full_day" for row in context)
        and entry.status != AttendanceStatus.LEAVE
    ):
        raise AppError(
            status_code=409,
            code="ATTENDANCE_APPROVED_LEAVE_CONFLICT",
            message="Approved leave covers this date. Attendance cannot silently replace it.",
        )
    if (
        entry.status == AttendanceStatus.LEAVE
        and not context
        and has_permission(actor, "Attendance.ManageOffice")
        and not has_permission(actor, "Attendance.Manage")
    ):
        raise AppError(
            status_code=422,
            code="ATTENDANCE_APPROVAL_REFERENCE_REQUIRED",
            message=(
                "Record the already approved leave and its real approval reference "
                "in Leave & Holidays first."
            ),
        )
    working, holidays = await load_working_weekdays(session), await load_holiday_dates(session)
    from nexa_bos_api.attendance.service import _office_holiday

    holiday = on_date in holidays or await _office_holiday(session, employee.office_id, on_date)
    off = bool(working and on_date.weekday() not in working)
    if entry.status in {AttendanceStatus.ABSENT, AttendanceStatus.LEAVE} and (holiday or off):
        raise AppError(
            status_code=422,
            code="ATTENDANCE_NONWORKING_DAY",
            message="Holidays and weekly offs cannot be counted as absent or leave days.",
        )
    if (
        entry.status == AttendanceStatus.OFFICIAL_HOLIDAY
        and not holiday
        or entry.status == AttendanceStatus.WEEKLY_OFF
        and (not off or holiday)
    ):
        raise AppError(
            status_code=422,
            code="ATTENDANCE_NONWORKING_STATUS",
            message="The selected status does not match the configured holiday or working week.",
        )
