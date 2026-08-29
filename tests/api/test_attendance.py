from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from helpers import (
    authenticate,
    create_activated_user,
    office_id,
    owner_client,
    spawned_client,
    unique_tag,
)
from nexa_bos_api.attendance.enums import BUSINESS_TZ
from nexa_bos_api.identity.models import AuditEvent
from nexa_bos_api.main import app


async def _attendance_user(
    authed: AsyncClient,
    *,
    permissions: list[str],
    directory_scope: str | None = "company",
    office_id: str | None = None,
    department_id: str | None = None,
    password: str = "UserPass1!",
) -> dict:
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/user-types",
        json={"name": f"ATT {tag}", "code": f"A{tag[:8]}"},
    )
    assert created.status_code == 200, created.text
    type_id = created.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    await authed.put(
        f"/api/v1/user-types/{type_id}/permissions",
        json={"permissions": permissions},
    )
    await authed.put(
        f"/api/v1/user-types/{type_id}/scope",
        json={"visibility_scope": directory_scope},
    )
    return await create_activated_user(
        authed,
        user_type_code=created.json()["code"],
        password=password,
        office_id=office_id,
        department_id=department_id,
    )


async def _department(authed: AsyncClient, office: str) -> dict:
    tag = unique_tag().upper()[:6]
    created = await authed.post(
        "/api/v1/departments",
        json={"name": f"Dept {tag}", "code": f"D{tag}", "office_id": office},
    )
    assert created.status_code == 200, created.text
    return created.json()


async def _ensure_schedule(
    client: AsyncClient,
    *,
    office_id: str,
    department_id: str | None = None,
    kind: str = "normal",
    start_time: str = "09:00",
    end_time: str = "18:00",
    grace_minutes: int = 0,
    ramadan_from: str | None = None,
    ramadan_to: str | None = None,
) -> dict:
    payload = {
        "office_id": office_id,
        "department_id": department_id,
        "kind": kind,
        "start_time": start_time,
        "end_time": end_time,
        "grace_minutes": grace_minutes,
        "ramadan_from": ramadan_from,
        "ramadan_to": ramadan_to,
    }
    created = await client.post("/api/v1/attendance/schedules", json=payload)
    if created.status_code == 200:
        return created.json()
    rows = (await client.get("/api/v1/attendance/schedules")).json()["items"]
    match = next(
        (
            item
            for item in rows
            if item["officeId"] == office_id
            and item["departmentId"] == department_id
            and item["kind"] == kind
        ),
        None,
    )
    assert match, created.text
    updated = await client.patch(f"/api/v1/attendance/schedules/{match['id']}", json=payload)
    assert updated.status_code == 200, updated.text
    return updated.json()


async def _ensure_holiday(client: AsyncClient, holiday_date: str, name: str) -> dict:
    payload = {"holiday_date": holiday_date, "name": name}
    created = await client.post("/api/v1/attendance/holidays", json=payload)
    if created.status_code == 200:
        return created.json()
    rows = (await client.get("/api/v1/attendance/holidays")).json()["items"]
    match = next((item for item in rows if item["holidayDate"] == holiday_date), None)
    assert match, created.text
    updated = await client.patch(f"/api/v1/attendance/holidays/{match['id']}", json={"name": name})
    assert updated.status_code == 200, updated.text
    return updated.json()


async def _save(client: AsyncClient, attendance_date: str, employee_id: str, **fields: object):
    payload = {
        "attendance_date": attendance_date,
        "entries": [{"employee_id": employee_id, **fields}],
    }
    return await client.put("/api/v1/attendance/records", json=payload)


@pytest.mark.asyncio
async def test_attendance_permissions_and_scope_isolation(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    denied = await _attendance_user(authed, permissions=["Users.View"], office_id=dxb)
    viewer = await _attendance_user(
        authed, permissions=["Attendance.View"], directory_scope="office", office_id=dxb
    )
    other = await create_activated_user(authed, office_id=auh)
    async with await spawned_client() as other_client:
        await authenticate(other_client, denied["email"], "UserPass1!")
        assert (
            await other_client.get("/api/v1/attendance/day?attendance_date=2026-08-03")
        ).status_code == 403
        assert (
            await other_client.get(
                "/api/v1/attendance/reports?date_from=2026-08-01&date_to=2026-08-31"
            )
        ).status_code == 403
    async with await spawned_client() as scoped:
        await authenticate(scoped, viewer["email"], "UserPass1!")
        roster = await scoped.get("/api/v1/attendance/day?attendance_date=2026-08-03")
        assert roster.status_code == 200, roster.text
        ids = {item["employeeId"] for item in roster.json()["items"]}
        assert other["id"] not in ids
        filters = (await scoped.get("/api/v1/attendance/filters")).json()
        assert auh not in {item["id"] for item in filters["offices"]}
        hidden = await scoped.get(
            f"/api/v1/attendance/day?attendance_date=2026-08-03&office_id={auh}"
        )
        assert hidden.status_code == 404
        save = await scoped.put(
            "/api/v1/attendance/records",
            json={
                "attendance_date": "2026-08-03",
                "entries": [{"employee_id": viewer["id"], "status": "Present"}],
            },
        )
        assert save.status_code == 403


@pytest.mark.asyncio
async def test_daily_attendance_calculations_and_duplicate_prevention(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    dept = await _department(authed, dxb)
    missing_employee = await create_activated_user(authed, office_id=auh)
    employee = await create_activated_user(authed, office_id=dxb, department_id=dept["id"])
    workday = "2026-08-03"
    missing = await _save(
        authed, workday, missing_employee["id"], status="Present", time_in="09:20", time_out="17:30"
    )
    assert missing.status_code == 200, missing.text
    row = missing.json()["items"][0]
    assert row["calculationState"] == "schedule_missing"
    assert row["isLate"] is False
    office_schedule = await _ensure_schedule(
        authed, office_id=dxb, start_time="09:00", end_time="18:00", grace_minutes=15
    )
    assert office_schedule["graceMinutes"] == 15
    dept_schedule = await _ensure_schedule(
        authed,
        office_id=dxb,
        department_id=dept["id"],
        start_time="08:30",
        end_time="17:00",
        grace_minutes=10,
    )
    assert dept_schedule["startTime"] == "08:30"
    grace_ok = await _save(
        authed, workday, employee["id"], status="Present", time_in="08:40", time_out="17:00"
    )
    assert grace_ok.json()["items"][0]["isLate"] is False
    late = await _save(
        authed, workday, employee["id"], status="Present", time_in="08:41", time_out="16:50"
    )
    late_row = late.json()["items"][0]
    assert late_row["isLate"] is True
    assert late_row["lateMinutes"] == 1
    assert late_row["isEarlyExit"] is True
    assert late_row["earlyExitMinutes"] == 10
    incomplete = await _save(authed, workday, employee["id"], status="Present", time_in="08:30")
    assert incomplete.json()["items"][0]["isIncomplete"] is True
    assert incomplete.json()["items"][0]["timeOut"] is None
    invalid = await _save(
        authed, workday, employee["id"], status="Present", time_in="18:00", time_out="09:00"
    )
    assert invalid.status_code == 422
    friday = await _save(authed, "2026-08-07", employee["id"], status="Weekly Off")
    assert friday.status_code == 200
    assert friday.json()["isWeeklyOff"] is True
    working = (await authed.get("/api/v1/attendance/working-days")).json()
    assert set(working["weekdays"]) == {6, 0, 1, 2, 3}


@pytest.mark.asyncio
async def test_corrections_leave_holiday_and_ramadan(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    employee = await create_activated_user(authed, office_id=dxb)
    await _ensure_schedule(
        authed, office_id=dxb, start_time="09:00", end_time="18:00", grace_minutes=0
    )
    ramadan = await _ensure_schedule(
        authed,
        office_id=dxb,
        kind="ramadan",
        start_time="09:00",
        end_time="15:00",
        grace_minutes=0,
        ramadan_from="2026-03-01",
        ramadan_to="2026-03-30",
    )
    assert ramadan["kind"] == "ramadan"
    created = await _save(
        authed, "2026-03-02", employee["id"], status="Present", time_in="09:00", time_out="14:50"
    )
    row = created.json()["items"][0]
    assert row["isEarlyExit"] is True
    assert row["earlyExitMinutes"] == 10
    assert row["schedule"]["kind"] == "ramadan"
    blank = await authed.post(
        f"/api/v1/attendance/records/{row['id']}/corrections",
        json={"reason": "", "time_out": "15:00"},
    )
    assert blank.status_code == 422
    corrected = await authed.post(
        f"/api/v1/attendance/records/{row['id']}/corrections",
        json={"reason": "Clock-out missed", "time_out": "15:00"},
    )
    assert corrected.status_code == 200, corrected.text
    body = corrected.json()
    assert body["isEarlyExit"] is False
    assert body["corrections"][0]["oldValues"]["earlyExitMinutes"] == 10
    assert body["corrections"][0]["newValues"]["earlyExitMinutes"] == 0
    assert body["corrections"][0]["reason"] == "Clock-out missed"
    types = (await authed.get("/api/v1/attendance/leave-types")).json()["items"]
    annual = next(item for item in types if item["code"] == "ANNUAL")
    system_locked = await authed.patch(
        f"/api/v1/attendance/leave-types/{annual['id']}",
        json={"status": "inactive"},
    )
    assert system_locked.status_code == 403
    custom = await authed.post(
        "/api/v1/attendance/leave-types",
        json={"code": f"C{unique_tag()[:6]}", "name": "Study leave"},
    )
    assert custom.status_code == 200
    leave = await _save(
        authed,
        "2026-08-04",
        employee["id"],
        status="Leave",
        leave_type_id=annual["id"],
    )
    assert leave.status_code == 200, leave.text
    stamp = int(unique_tag()[:6], 16)
    holiday_date = f"2027-{(stamp % 12) + 1:02d}-{(stamp % 28) + 1:02d}"
    holiday = await _ensure_holiday(authed, holiday_date, "National Day")
    assert holiday["name"] == "National Day"
    roster = await authed.get(f"/api/v1/attendance/day?attendance_date={holiday_date}")
    assert roster.json()["officialHoliday"]["name"] == "National Day"
    assert roster.json()["suggestedStatus"] == "Official Holiday"
    marked = await _save(authed, holiday_date, employee["id"], status="Official Holiday")
    assert marked.json()["items"][0]["status"] == "Official Holiday"
    worked = await _save(
        authed,
        holiday_date,
        employee["id"],
        status="Present",
        time_in="11:00",
        time_out="15:00",
    )
    worked_row = worked.json()["items"][0]
    assert worked_row["workedOnHoliday"] is True
    assert worked_row["isLate"] is False
    async with app.state.session_factory() as session:
        events = (
            (
                await session.execute(
                    select(AuditEvent).where(AuditEvent.action == "attendance.correct")
                )
            )
            .scalars()
            .all()
        )
        assert events
        assert events[-1].note == "Clock-out missed"


@pytest.mark.asyncio
async def test_impact_score_reports_reminders_and_business_metrics_untouched(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    employee = await create_activated_user(authed, office_id=dxb)
    types = (await authed.get("/api/v1/attendance/leave-types")).json()["items"]
    unpaid = next(item for item in types if item["code"] == "UNPAID")
    annual = next(item for item in types if item["code"] == "ANNUAL")
    absence = await authed.put(
        "/api/v1/attendance/impact-rules",
        json={"condition": "absence", "method": "points", "value": 5},
    )
    assert absence.status_code == 200
    late_rule = await authed.put(
        "/api/v1/attendance/impact-rules",
        json={"condition": "late", "method": "percentage", "value": 2},
    )
    assert late_rule.status_code == 200
    zero_leave = await authed.put(
        "/api/v1/attendance/impact-rules",
        json={
            "condition": "leave",
            "leave_type_id": annual["id"],
            "method": "points",
            "value": 0,
        },
    )
    assert zero_leave.status_code == 200
    unpaid_leave = await authed.put(
        "/api/v1/attendance/impact-rules",
        json={
            "condition": "leave",
            "leave_type_id": unpaid["id"],
            "method": "points",
            "value": 3,
        },
    )
    assert unpaid_leave.status_code == 200
    await _ensure_schedule(
        authed, office_id=dxb, start_time="09:00", end_time="18:00", grace_minutes=0
    )
    await _save(authed, "2026-08-03", employee["id"], status="Absent")
    await _save(
        authed, "2026-08-04", employee["id"], status="Present", time_in="09:10", time_out="18:00"
    )
    await _save(
        authed,
        "2026-08-05",
        employee["id"],
        status="Leave",
        leave_type_id=annual["id"],
    )
    await _save(
        authed,
        "2026-08-06",
        employee["id"],
        status="Leave",
        leave_type_id=unpaid["id"],
    )
    report = await authed.get(
        "/api/v1/attendance/reports"
        f"?date_from=2026-08-03&date_to=2026-08-06&employee_id={employee['id']}"
    )
    assert report.status_code == 200, report.text
    summary = report.json()["summary"]
    assert summary["absentCount"] == 1
    assert summary["lateCount"] == 1
    assert summary["leaveCount"] == 2
    assert summary["attendanceScore"] == 90
    assert summary["attendanceImpact"] == 10
    profile = await authed.get(
        f"/api/v1/reports/employees/{employee['id']}?period=custom&date_from=2026-08-03&date_to=2026-08-06"
    )
    assert profile.status_code == 200, profile.text
    assert profile.json()["kpis"]["submitted"]["count"] == 0
    assert profile.json()["attendanceSummary"]["attendanceScore"] == 90
    holiday_date = datetime.now(BUSINESS_TZ).date() + timedelta(days=7)
    created = await authed.post(
        "/api/v1/attendance/holidays",
        json={"holiday_date": holiday_date.isoformat(), "name": "Test Holiday"},
    )
    if created.status_code == 409:
        holidays = (await authed.get("/api/v1/attendance/holidays")).json()["items"]
        holiday_id = next(
            item["id"] for item in holidays if item["holidayDate"] == holiday_date.isoformat()
        )
    else:
        assert created.status_code == 200, created.text
        holiday_id = created.json()["id"]
    reminders = await authed.get("/api/v1/attendance/reminders")
    assert reminders.status_code == 200
    assert any(
        item["holiday"]["id"] == holiday_id for item in reminders.json()["items"] if item["holiday"]
    )
    viewer = await _attendance_user(authed, permissions=["Attendance.View"], office_id=dxb)
    async with await spawned_client() as other:
        await authenticate(other, viewer["email"], "UserPass1!")
        urgent = await other.post(f"/api/v1/attendance/holidays/{holiday_id}/urgent-reminder")
        assert urgent.status_code == 403
        reports = await other.get(
            "/api/v1/attendance/reports?date_from=2026-08-01&date_to=2026-08-31"
        )
        assert reports.status_code == 403
    urgent_ok = await authed.post(f"/api/v1/attendance/holidays/{holiday_id}/urgent-reminder")
    assert urgent_ok.status_code == 200
    async with app.state.session_factory() as session:
        events = (
            (
                await session.execute(
                    select(AuditEvent).where(
                        AuditEvent.action == "attendance.holiday_urgent_reminder"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert events
    reporter = await _attendance_user(authed, permissions=["Attendance.Reports"], office_id=dxb)
    async with await spawned_client() as reporter_client:
        await authenticate(reporter_client, reporter["email"], "UserPass1!")
        allowed = await reporter_client.get(
            "/api/v1/attendance/reports?date_from=2026-08-03&date_to=2026-08-06"
        )
        assert allowed.status_code == 200
        manage = await reporter_client.put(
            "/api/v1/attendance/records",
            json={
                "attendance_date": "2026-08-03",
                "entries": [{"employee_id": employee["id"], "status": "Present"}],
            },
        )
        assert manage.status_code == 403
    dashboard = await authed.get("/api/v1/reports/dashboard?period=mtd")
    assert dashboard.status_code == 200
    assert "submitted" in dashboard.json()["kpis"]
