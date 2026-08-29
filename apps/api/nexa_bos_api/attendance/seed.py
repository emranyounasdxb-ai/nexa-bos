from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.attendance.enums import DEFAULT_WORKING_WEEKDAYS, SYSTEM_LEAVE_TYPES
from nexa_bos_api.attendance.models import CompanyWorkingDay, LeaveType
from nexa_bos_api.identity.enums import MasterStatus
from nexa_bos_api.identity.models import new_uuid


async def seed_attendance(session: AsyncSession) -> None:
    now = datetime.now(UTC)
    existing_days = {
        row.weekday for row in (await session.execute(select(CompanyWorkingDay))).scalars().all()
    }
    if not existing_days:
        for weekday in DEFAULT_WORKING_WEEKDAYS:
            session.add(CompanyWorkingDay(weekday=weekday))
    existing_leave = {
        row.code: row for row in (await session.execute(select(LeaveType))).scalars().all()
    }
    for code, name in SYSTEM_LEAVE_TYPES:
        current = existing_leave.get(code)
        if current is None:
            session.add(
                LeaveType(
                    id=new_uuid(),
                    code=code,
                    name=name,
                    is_system=True,
                    status=MasterStatus.ACTIVE,
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            current.is_system = True
            if current.status != MasterStatus.ACTIVE:
                current.status = MasterStatus.ACTIVE
            current.updated_at = now
