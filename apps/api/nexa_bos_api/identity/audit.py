from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.identity.models import AuditEvent, new_uuid


async def record_audit(
    session: AsyncSession,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    actor_id: UUID | None = None,
    target_user_id: UUID | None = None,
    old_values: dict[str, Any] | None = None,
    new_values: dict[str, Any] | None = None,
    note: str | None = None,
) -> None:
    session.add(
        AuditEvent(
            id=new_uuid(),
            actor_id=actor_id,
            target_user_id=target_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            old_values=old_values,
            new_values=new_values,
            created_at=datetime.now(UTC),
            note=note,
        )
    )
