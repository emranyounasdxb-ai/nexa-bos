from __future__ import annotations

import pytest
from database_safety import validate_test_database_url


@pytest.mark.parametrize(
    ("database_url", "message"),
    [
        (None, "explicitly set"),
        ("postgresql+asyncpg://nexa:nexa@127.0.0.1:15432/nexa_bos_test_guard", "15432"),
        ("postgresql+asyncpg://nexa:nexa@127.0.0.1:25432/nexa_bos", "canonical database"),
        ("postgresql+asyncpg://nexa:nexa@127.0.0.1:25432/sandbox", "'test' segment"),
    ],
)
@pytest.mark.asyncio
async def test_database_safety_rejects_unsafe_urls(database_url: str | None, message: str) -> None:
    with pytest.raises(RuntimeError, match=message):
        validate_test_database_url(database_url)


@pytest.mark.asyncio
async def test_database_safety_accepts_disposable_database() -> None:
    safe = validate_test_database_url(
        "postgresql+asyncpg://nexa:nexa@127.0.0.1:25432/nexa_bos_test_guard_20260904"
    )

    assert safe.database == "nexa_bos_test_guard_20260904"
    assert safe.host == "127.0.0.1"
    assert safe.port == 25432
