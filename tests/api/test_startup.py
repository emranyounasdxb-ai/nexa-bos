from __future__ import annotations

import subprocess
from unittest.mock import AsyncMock, Mock

import pytest
from httpx import ASGITransport, AsyncClient
from nexa_bos_api import main as application_module
from nexa_bos_api import startup
from nexa_bos_api.core.config import Settings, get_settings
from nexa_bos_api.db.session import create_engine
from nexa_bos_api.identity.models import Permission
from nexa_bos_api.identity.permissions import ALL_PERMISSION_CODES
from pydantic import ValidationError
from sqlalchemy import select, text


@pytest.mark.parametrize("migrate", [True, False])
def test_container_startup_explicit_migration_switch(monkeypatch, migrate: bool) -> None:
    settings = get_settings().model_copy(update={"run_migrations_on_startup": migrate})
    monkeypatch.setattr(startup, "get_settings", lambda: settings)
    calls = []
    monkeypatch.setattr(
        startup.subprocess, "run", lambda *args, **kwargs: calls.append((args, kwargs))
    )
    monkeypatch.setattr(startup.uvicorn, "run", lambda *args, **kwargs: calls.append("serve"))
    startup.main()
    expected = [((["alembic", "upgrade", "head"],), {"check": True})] if migrate else []
    assert calls == [*expected, "serve"]


def test_migration_failure_never_starts_server(monkeypatch) -> None:
    settings = get_settings().model_copy(update={"run_migrations_on_startup": True})
    monkeypatch.setattr(startup, "get_settings", lambda: settings)
    monkeypatch.setattr(
        startup.subprocess,
        "run",
        Mock(side_effect=subprocess.CalledProcessError(1, ["alembic", "upgrade", "head"])),
    )
    serve = Mock()
    monkeypatch.setattr(startup.uvicorn, "run", serve)
    with pytest.raises(subprocess.CalledProcessError):
        startup.main()
    serve.assert_not_called()


def test_startup_defaults_and_invalid_configuration(monkeypatch) -> None:
    monkeypatch.delenv("RUN_MIGRATIONS_ON_STARTUP", raising=False)
    monkeypatch.delenv("BOOTSTRAP_ON_STARTUP", raising=False)
    defaults = Settings(_env_file=None)
    assert defaults.run_migrations_on_startup is True
    assert defaults.bootstrap_on_startup is True
    monkeypatch.setenv("RUN_MIGRATIONS_ON_STARTUP", "false")
    monkeypatch.setenv("BOOTSTRAP_ON_STARTUP", "false")
    disabled = Settings(_env_file=None)
    assert disabled.run_migrations_on_startup is False
    assert disabled.bootstrap_on_startup is False
    monkeypatch.setenv("BOOTSTRAP_ON_STARTUP", "ambiguous")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize("bootstrap", [True, False])
async def test_startup_modes_keep_database_and_api_operational(
    monkeypatch, bootstrap: bool
) -> None:
    settings = get_settings().model_copy(update={"bootstrap_on_startup": bootstrap})
    monkeypatch.setattr(application_module, "get_settings", lambda: settings)
    real_bootstrap = application_module.bootstrap_identity
    bootstrap_call = AsyncMock(wraps=real_bootstrap)
    monkeypatch.setattr(application_module, "bootstrap_identity", bootstrap_call)
    engine = create_engine(settings)

    # Full-table fingerprints stay inside the database; no row values or secrets are returned.
    async def fingerprint() -> list:
        async with engine.connect() as connection:
            tables = (
                (
                    await connection.execute(
                        text(
                            "SELECT tablename FROM pg_tables "
                            "WHERE schemaname='public' ORDER BY tablename"
                        )
                    )
                )
                .scalars()
                .all()
            )
            return [
                (
                    name,
                    await connection.scalar(
                        text(
                            f"SELECT md5(coalesce(string_agg(h, chr(10) ORDER BY h), '')) "
                            f'FROM (SELECT md5(row_to_json(r)::text) h FROM "{name}" r) hashes'
                        )
                    ),
                )
                for name in tables
            ]

    try:
        before = await fingerprint()
        app = application_module.create_app()
        async with app.router.lifespan_context(app):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                assert (await client.get("/api/v1/health")).status_code == 200
                assert (await client.get("/api/v1/ready")).json() == {"status": "ready"}
                assert (await client.get("/api/v1/auth/me")).status_code == 401
            async with app.state.session_factory() as session:
                assert set((await session.execute(select(Permission.code))).scalars()) == set(
                    ALL_PERMISSION_CODES
                )
        if bootstrap:
            bootstrap_call.assert_awaited_once()
        else:
            bootstrap_call.assert_not_awaited()
            assert await fingerprint() == before
    finally:
        await engine.dispose()
