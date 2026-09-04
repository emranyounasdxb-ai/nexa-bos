from __future__ import annotations

import os
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from database_safety import SafeTestDatabase, validate_test_database_url
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, text

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("LOG_LEVEL", "INFO")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
os.environ.setdefault("BOOTSTRAP_SECRET", "nexa-test-bootstrap-secret")

SAFE_TEST_DATABASE = validate_test_database_url(os.environ.get("DATABASE_URL"))

from nexa_bos_api.core.config import get_settings  # noqa: E402
from nexa_bos_api.db.session import create_engine, create_session_factory  # noqa: E402
from nexa_bos_api.finance.models import (  # noqa: E402
    FinanceComponent,
    FinancePayout,
    FinancePayoutPeriod,
    FinancePeriodTransition,
)
from nexa_bos_api.main import app  # noqa: E402

get_settings.cache_clear()


async def _verify_connected_test_database(expected: SafeTestDatabase) -> None:
    engine = create_engine(get_settings())
    try:
        async with engine.connect() as connection:
            row = (
                await connection.execute(
                    text(
                        "SELECT current_database(), "
                        "coalesce(inet_server_addr()::text, 'local'), inet_server_port()"
                    )
                )
            ).one()
    finally:
        await engine.dispose()

    actual_database, server_host, server_port = row
    if actual_database != expected.database:
        raise RuntimeError(
            "Connected database does not match the explicitly configured test database"
        )
    print(
        "Test database safety verified: "
        f"database={actual_database}, configured_host={expected.host}, "
        f"configured_port={expected.port}, server_host={server_host}, "
        f"server_port={server_port}"
    )


@pytest_asyncio.fixture(scope="session", loop_scope="session", autouse=True)
async def verify_connected_test_database() -> None:
    await _verify_connected_test_database(SAFE_TEST_DATABASE)


@pytest_asyncio.fixture(autouse=True)
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
