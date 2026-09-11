from __future__ import annotations

import os
import subprocess
import sys
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from nexa_bos_api.core.config import API_ROOT
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import create_async_engine

_REV_0020 = "0020_leave_management"
_REV_0021 = "0021_contract_register"
_CONTRACT_PERMISSIONS = {
    "Contracts.ViewOwn",
    "Contracts.View",
    "Contracts.Create",
    "Contracts.Edit",
    "Contracts.Approve",
    "Contracts.ReturnReject",
    "Contracts.Cancel",
    "Contracts.History",
    "Contracts.Settings",
}
_HR_PERMISSIONS = _CONTRACT_PERMISSIONS - {"Contracts.Approve"}


def _database_url() -> str:
    return os.environ["DATABASE_URL"]


def _render_url(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def _alembic(database_url: str, *arguments: str) -> str:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    env["APP_ENV"] = "test"
    completed = subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=API_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    output = f"{completed.stdout}\n{completed.stderr}"
    assert completed.returncode == 0, output
    return output


async def _admin(statement: str) -> None:
    engine = create_async_engine(
        make_url(_database_url()), isolation_level="AUTOCOMMIT"
    )
    try:
        async with engine.connect() as connection:
            await connection.execute(text(statement))
    finally:
        await engine.dispose()


async def _new_database(prefix: str) -> tuple[str, str]:
    database = f"nexa_bos_test_contract_{prefix}_{uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{database}"')
    return database, _render_url(make_url(_database_url()).set(database=database))


async def _drop_database(database: str) -> None:
    await _admin(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')


async def _seed_roles(
    database_url: str, codes: tuple[str, ...]
) -> tuple[dict[str, UUID], UUID]:
    role_ids = {code: uuid4() for code in codes}
    overlap_id = uuid4()
    now = datetime.now(UTC)
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as connection:
            for code, role_id in role_ids.items():
                await connection.execute(
                    text(
                        """
                        INSERT INTO user_types (
                            id, code, name, description, is_system, status,
                            visibility_scope, customer_visibility_scope,
                            application_visibility_scope, reporting_visibility_scope,
                            mfa_required, can_be_reporting_manager, can_be_case_owner,
                            created_at, updated_at
                        ) VALUES (
                            :id, :code, :name, NULL, true, 'active',
                            'own', 'own', 'own', 'own', false, false, false, :now, :now
                        )
                        """
                    ),
                    {"id": role_id, "code": code, "name": code, "now": now},
                )
            if "OWNER" in role_ids:
                await connection.execute(
                    text(
                        "INSERT INTO permissions (code, description) "
                        "VALUES ('Contracts.ViewOwn', 'Existing overlap')"
                    )
                )
                await connection.execute(
                    text(
                        "INSERT INTO user_type_permissions "
                        "(id, user_type_id, permission_code) "
                        "VALUES (:id, :role_id, 'Contracts.ViewOwn')"
                    ),
                    {"id": overlap_id, "role_id": role_ids["OWNER"]},
                )
    finally:
        await engine.dispose()
    return role_ids, overlap_id


@pytest.mark.asyncio
async def test_0021_production_shaped_upgrade_preserves_existing_assignments() -> None:
    database, url = await _new_database("roles")
    try:
        _alembic(url, "upgrade", _REV_0020)
        roles, overlap_id = await _seed_roles(
            url,
            (
                "OWNER",
                "HR",
                "PRO",
                "GM",
                "BDM",
                "SM",
                "COD",
                "TL",
                "SE",
                "OM",
                "ITM",
                "AUDITOR",
            ),
        )
        _alembic(url, "upgrade", _REV_0021)
        engine = create_async_engine(url)
        try:
            async with engine.connect() as connection:
                revision = await connection.scalar(
                    text("SELECT version_num FROM alembic_version")
                )
                rows = (
                    await connection.execute(
                        text(
                            "SELECT id, user_type_id, permission_code FROM user_type_permissions "
                            "WHERE permission_code LIKE 'Contracts.%'"
                        )
                    )
                ).all()
        finally:
            await engine.dispose()

        assert revision == _REV_0021
        assert all(row.id is not None for row in rows)
        assert len({row.id for row in rows}) == len(rows)
        assert len({(row.user_type_id, row.permission_code) for row in rows}) == len(
            rows
        )
        owner_rows = [row for row in rows if row.user_type_id == roles["OWNER"]]
        assert {row.permission_code for row in owner_rows} == _CONTRACT_PERMISSIONS
        assert (
            next(
                row.id
                for row in owner_rows
                if row.permission_code == "Contracts.ViewOwn"
            )
            == overlap_id
        )
        assert {
            row.permission_code for row in rows if row.user_type_id == roles["HR"]
        } == _HR_PERMISSIONS
        assert not [row for row in rows if row.user_type_id == roles["PRO"]]
        for code in ("GM", "BDM", "SM", "COD", "TL", "SE", "OM", "ITM", "AUDITOR"):
            assert {
                row.permission_code for row in rows if row.user_type_id == roles[code]
            } == {"Contracts.ViewOwn"}
    finally:
        await _drop_database(database)


@pytest.mark.asyncio
@pytest.mark.parametrize("roles", [(), ("OWNER",), ("HR", "PRO")])
async def test_0021_handles_absent_system_user_types(roles: tuple[str, ...]) -> None:
    database, url = await _new_database("missing")
    try:
        _alembic(url, "upgrade", _REV_0020)
        await _seed_roles(url, roles)
        _alembic(url, "upgrade", _REV_0021)
        engine = create_async_engine(url)
        try:
            async with engine.connect() as connection:
                assert (
                    await connection.scalar(
                        text("SELECT version_num FROM alembic_version")
                    )
                    == _REV_0021
                )
                assert (
                    await connection.scalar(text("SELECT count(*) FROM contract_types"))
                    == 0
                )
        finally:
            await engine.dispose()
    finally:
        await _drop_database(database)


@pytest.mark.asyncio
async def test_0021_fresh_database_reaches_head_and_matches_models() -> None:
    database, url = await _new_database("fresh")
    try:
        _alembic(url, "upgrade", "head")
        assert "0026_terminate_sessions (head)" in _alembic(url, "current")
        assert "No new upgrade operations detected" in _alembic(url, "check")
    finally:
        await _drop_database(database)
