from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

MASTER_CODE_GENERATION_LOCK_KEY = 4_827_193_614


def normalize_master_code(value: str, *, fallback: str, max_length: int) -> str:
    normalized = re.sub(r"[^A-Z0-9]+", "_", value.strip().upper()).strip("_")
    if not normalized:
        normalized = re.sub(r"[^A-Z0-9]+", "_", fallback.strip().upper()).strip("_")
    return normalized[:max_length].rstrip("_")


async def generate_master_code(
    session: AsyncSession,
    model: type[Any],
    *,
    name: str,
    fallback: str,
    max_length: int,
    scope: Sequence[ColumnElement[bool]] = (),
) -> str:
    """Generate a stable internal code while serializing competing creators."""
    await session.execute(select(func.pg_advisory_xact_lock(MASTER_CODE_GENERATION_LOCK_KEY)))
    base = normalize_master_code(name, fallback=fallback, max_length=max_length)
    candidate = base
    suffix = 2
    while (
        await session.execute(select(model).where(model.code == candidate, *scope).limit(1))
    ).scalar_one_or_none() is not None:
        marker = f"_{suffix}"
        candidate = f"{base[: max_length - len(marker)].rstrip('_')}{marker}"
        suffix += 1
    return candidate
