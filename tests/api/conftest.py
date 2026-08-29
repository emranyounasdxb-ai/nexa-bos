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
from nexa_bos_api.db.session import create_engine, create_session_factory
from nexa_bos_api.finance.models import (
    FinanceComponent,
    FinancePayout,
    FinancePayoutPeriod,
    FinancePeriodTransition,
)
from nexa_bos_api.main import app
from sqlalchemy import delete

get_settings.cache_clear()


@pytest.fixture(autouse=True)
async def isolate_finance_period_chains(
    request: pytest.FixtureRequest,
) -> AsyncGenerator[None]:
    """Finance tests own independent chronological period chains."""
    if not request.node.path.name.startswith("test_finance"):
        yield
        return
    engine = create_engine(get_settings())
    session_factory = create_session_factory(engine)
    try:
        async with session_factory() as session:
            await session.execute(delete(FinanceComponent))
            await session.execute(delete(FinancePayout))
            await session.execute(delete(FinancePeriodTransition))
            await session.execute(delete(FinancePayoutPeriod))
            await session.commit()
    finally:
        await engine.dispose()
    yield


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient]:
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as async_client:
            yield async_client
