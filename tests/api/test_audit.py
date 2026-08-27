from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from helpers import owner_client
from nexa_bos_api.db.session import create_engine, create_session_factory
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.identity.models import AuditEvent


@pytest.mark.asyncio
async def test_audit_records_are_immutable(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    history = await authed.get(f"/api/v1/users/{owner['id']}/history")
    assert history.status_code == 200
    events = history.json()["events"]
    assert events
    engine = create_engine(get_settings())
    factory = create_session_factory(engine)
    from uuid import UUID

    async with factory() as session:
        row = (
            await session.execute(select(AuditEvent).where(AuditEvent.id == UUID(events[0]["id"])))
        ).scalar_one()
        row.action = "tampered"
        with pytest.raises(RuntimeError, match="immutable"):
            await session.commit()
        await session.rollback()
    await engine.dispose()
