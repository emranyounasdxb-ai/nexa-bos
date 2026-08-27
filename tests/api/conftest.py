from __future__ import annotations

import os
from collections.abc import AsyncGenerator

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("LOG_LEVEL", "INFO")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
os.environ.setdefault("BOOTSTRAP_SECRET", "nexa-test-bootstrap-secret")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://nexa:nexa@127.0.0.1:15432/nexa_bos",
)

import pytest
from httpx import ASGITransport, AsyncClient

from nexa_bos_api.core.config import get_settings
from nexa_bos_api.main import app

get_settings.cache_clear()


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as async_client:
            yield async_client
