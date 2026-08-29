from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession


async def seed_attendance(_session: AsyncSession) -> None:
    """Working days and leave types are configured explicitly. No catalog is seeded."""
