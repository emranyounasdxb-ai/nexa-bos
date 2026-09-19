from __future__ import annotations

from datetime import date
from hashlib import sha256
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.attendance.management_models import AttendanceMonthEvent
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import visible_user_ids
from nexa_bos_api.identity.models import User


async def storage_ready(session: AsyncSession) -> bool:
    return bool(
        await session.scalar(
            text(
                "SELECT to_regclass('attendance_import_batches') IS NOT NULL "
                "AND to_regclass('attendance_month_events') IS NOT NULL "
                "AND to_regclass('attendance_leave_evidence') IS NOT NULL "
                "AND to_regclass('attendance_provenance') IS NOT NULL "
                "AND to_regclass('attendance_office_holidays') IS NOT NULL"
            )
        )
    )


async def require_storage(session: AsyncSession) -> None:
    if not await storage_ready(session):
        raise AppError(
            status_code=503,
            code="ATTENDANCE_SETUP_REQUIRED",
            message=(
                "Attendance imports, recorded leave and month closing require the prepared "
                "database update. Existing attendance remains available."
            ),
        )


async def scoped_ids(session: AsyncSession, actor: User) -> set[UUID] | None:
    # Action grants never select or expand the configured record scope.
    return await visible_user_ids(session, actor)


async def lock_month(session: AsyncSession, office_id: UUID | None, on_date: date) -> None:
    key = int.from_bytes(
        sha256(f"attendance:{office_id}:{on_date:%Y-%m}".encode()).digest()[:8], "big", signed=True
    )
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


async def latest_month(
    session: AsyncSession, office_id: UUID | None, on_date: date
) -> AttendanceMonthEvent | None:
    if office_id is None or not await storage_ready(session):
        return None
    return await session.scalar(
        select(AttendanceMonthEvent)
        .where(
            AttendanceMonthEvent.office_id == office_id,
            AttendanceMonthEvent.month == on_date.replace(day=1),
        )
        .order_by(AttendanceMonthEvent.created_at.desc(), AttendanceMonthEvent.id.desc())
        .limit(1)
    )


async def assert_month_open(session: AsyncSession, office_id: UUID | None, on_date: date) -> None:
    await lock_month(session, office_id, on_date)
    latest = await latest_month(session, office_id, on_date)
    if latest and latest.action == "closed":
        raise AppError(
            status_code=409,
            code="ATTENDANCE_MONTH_CLOSED",
            message=(
                "This attendance month is closed. An authorized HR administrator must "
                "reopen it with a reason before corrections or entries can be saved."
            ),
        )
