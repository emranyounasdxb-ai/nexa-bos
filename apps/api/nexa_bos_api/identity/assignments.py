from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.identity.enums import AssignmentField
from nexa_bos_api.identity.models import UserAssignmentHistory, new_uuid


def utcnow() -> datetime:
    return datetime.now(UTC)


async def record_assignment(
    session: AsyncSession,
    *,
    user_id: UUID,
    field: AssignmentField,
    value_id: str | None,
    value_label: str | None,
    at: datetime | None = None,
) -> None:
    now = at or utcnow()
    current = (
        await session.execute(
            select(UserAssignmentHistory).where(
                UserAssignmentHistory.user_id == user_id,
                UserAssignmentHistory.field == field,
                UserAssignmentHistory.effective_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if current is not None:
        same_id = (current.value_id or None) == (value_id or None)
        same_label = (current.value_label or None) == (value_label or None)
        if same_id and same_label:
            return
        current.effective_to = now
    session.add(
        UserAssignmentHistory(
            id=new_uuid(),
            user_id=user_id,
            field=field,
            value_id=value_id,
            value_label=value_label,
            effective_from=now,
            effective_to=None,
        )
    )
