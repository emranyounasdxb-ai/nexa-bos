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

_REV_0019 = "0019_employee_profiles"
_REV_0020 = "0020_leave_management"
_HEAD_REVISION = "0024_approval_centre"
_LEAVE_PERMISSIONS = {
    "Leave.View",
    "Leave.Request",
    "Leave.CreateForEmployee",
    "Leave.Edit",
    "Leave.ApproveManager",
    "Leave.ApproveHR",
    "Leave.ReturnReject",
    "Leave.Cancel",
    "Leave.History",
    "Leave.Settings",
    "Leave.Override",
}


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
    database = f"nexa_bos_test_leave_{prefix}_{uuid4().hex[:10]}"
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
                            'own', 'own', 'own', 'own',
                            false, false, false, :now, :now
                        )
                        """
                    ),
                    {"id": role_id, "code": code, "name": code, "now": now},
                )
            if "OWNER" in role_ids:
                await connection.execute(
                    text(
                        "INSERT INTO permissions (code, description) "
                        "VALUES ('Leave.View', 'Existing overlap')"
                    )
                )
                await connection.execute(
                    text(
                        "INSERT INTO user_type_permissions "
                        "(id, user_type_id, permission_code) "
                        "VALUES (:id, :role_id, 'Leave.View')"
                    ),
                    {"id": overlap_id, "role_id": role_ids["OWNER"]},
                )
    finally:
        await engine.dispose()
    return role_ids, overlap_id


@pytest.mark.asyncio
async def test_0020_production_shaped_upgrade_is_idempotent_and_preserves_assignments() -> (
    None
):
    database, url = await _new_database("roles")
    try:
        _alembic(url, "upgrade", _REV_0019)
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
        _alembic(url, "upgrade", _REV_0020)
        engine = create_async_engine(url)
        try:
            async with engine.connect() as connection:
                revision = await connection.scalar(
                    text("SELECT version_num FROM alembic_version")
                )
                assignments = (
                    await connection.execute(
                        text(
                            "SELECT id, user_type_id, permission_code "
                            "FROM user_type_permissions "
                            "WHERE permission_code LIKE 'Leave.%'"
                        )
                    )
                ).all()
                leave_types = (
                    await connection.execute(
                        text(
                            "SELECT code, yearly_entitlement, accrual_method "
                            "FROM leave_types WHERE code = ANY(:codes)"
                        ),
                        {
                            "codes": [
                                "ANNUAL",
                                "SICK",
                                "UNPAID",
                                "MATERNITY",
                                "PARENTAL",
                                "BEREAVEMENT",
                                "STUDY",
                                "OTHER",
                            ]
                        },
                    )
                ).all()
        finally:
            await engine.dispose()

        assert revision == _REV_0020
        assert all(row.id is not None for row in assignments)
        assert len({row.id for row in assignments}) == len(assignments)
        owner = [row for row in assignments if row.user_type_id == roles["OWNER"]]
        assert {row.permission_code for row in owner} == _LEAVE_PERMISSIONS
        assert (
            next(row.id for row in owner if row.permission_code == "Leave.View")
            == overlap_id
        )
        assert not [row for row in assignments if row.user_type_id == roles["PRO"]]
        assert len(leave_types) == 8
        assert all(row.yearly_entitlement == 0 for row in leave_types)
        assert all(row.accrual_method == "none" for row in leave_types)
    finally:
        await _drop_database(database)


@pytest.mark.asyncio
@pytest.mark.parametrize("roles", [(), ("OWNER",), ("HR", "PRO")])
async def test_0020_handles_absent_system_user_types(roles: tuple[str, ...]) -> None:
    database, url = await _new_database("missing")
    try:
        _alembic(url, "upgrade", _REV_0019)
        await _seed_roles(url, roles)
        _alembic(url, "upgrade", _REV_0020)
        engine = create_async_engine(url)
        try:
            async with engine.connect() as connection:
                assert (
                    await connection.scalar(
                        text("SELECT version_num FROM alembic_version")
                    )
                    == _REV_0020
                )
                assert (
                    await connection.scalar(text("SELECT count(*) FROM leave_types"))
                    == 8
                )
        finally:
            await engine.dispose()
    finally:
        await _drop_database(database)


@pytest.mark.asyncio
async def test_0020_fresh_database_reaches_head_and_matches_models() -> None:
    database, url = await _new_database("fresh")
    try:
        _alembic(url, "upgrade", "head")
        assert f"{_HEAD_REVISION} (head)" in _alembic(url, "current")
        assert "No new upgrade operations detected" in _alembic(url, "check")
    finally:
        await _drop_database(database)
