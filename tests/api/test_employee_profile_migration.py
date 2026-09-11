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

_REV_0018 = "0018_catalogue_images"
_REV_0019 = "0019_employee_profiles"
_HEAD_REVISION = "0026_terminate_sessions"
_PROFILE_GRANTS = {
    "OWNER": {
        "UserProfiles.Basic.View",
        "UserProfiles.Basic.Update",
        "UserProfiles.HR.View",
        "UserProfiles.HR.Update",
        "UserProfiles.PRO.View",
        "UserProfiles.PRO.Update",
        "UserDocuments.Upload",
        "UserDocuments.Replace",
        "UserDocuments.View",
        "UserDocuments.Download",
        "UserDocuments.Delete",
        "UserDocuments.History",
        "UserDocuments.Purge",
    },
    "HR": {
        "UserProfiles.Basic.View",
        "UserProfiles.HR.View",
        "UserProfiles.HR.Update",
    },
    "PRO": {
        "UserProfiles.Basic.View",
        "UserProfiles.PRO.View",
        "UserProfiles.PRO.Update",
        "UserDocuments.Upload",
        "UserDocuments.Replace",
        "UserDocuments.View",
        "UserDocuments.Download",
        "UserDocuments.Delete",
        "UserDocuments.History",
    },
}


def _app_database_url() -> str:
    return os.environ["DATABASE_URL"]


def _render_url(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def _run_alembic(
    database_url: str, *arguments: str, expect_success: bool = True
) -> str:
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
    if expect_success:
        assert completed.returncode == 0, output
    else:
        assert completed.returncode != 0, output
    return output


async def _admin_execute(statement: str) -> None:
    engine = create_async_engine(
        make_url(_app_database_url()), isolation_level="AUTOCOMMIT"
    )
    try:
        async with engine.connect() as connection:
            await connection.execute(text(statement))
    finally:
        await engine.dispose()


async def _create_database(prefix: str) -> tuple[str, str]:
    database = f"nexa_bos_test_{prefix}_{uuid4().hex[:12]}"
    await _admin_execute(f'CREATE DATABASE "{database}"')
    return database, _render_url(make_url(_app_database_url()).set(database=database))


async def _drop_database(database: str) -> None:
    await _admin_execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')


async def _seed_historical_identity(
    database_url: str, role_codes: tuple[str, ...]
) -> tuple[dict[str, UUID], UUID | None, UUID | None]:
    now = datetime.now(UTC)
    role_ids = {code: uuid4() for code in role_codes}
    overlap_id = uuid4() if "OWNER" in role_ids else None
    legacy_id = uuid4() if "OWNER" in role_ids else None
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
                            :scope, :scope, :scope, :scope,
                            false, false, false, :now, :now
                        )
                        """
                    ),
                    {
                        "id": role_id,
                        "code": code,
                        "name": f"Existing {code}",
                        "scope": "company" if code == "OWNER" else "own",
                        "now": now,
                    },
                )
            if overlap_id is not None and legacy_id is not None:
                await connection.execute(
                    text(
                        """
                        INSERT INTO permissions (code, description) VALUES
                            ('UserProfiles.Basic.View', 'Existing profile permission'),
                            ('Legacy.Profile.Permission', 'Existing unrelated permission')
                        """
                    )
                )
                await connection.execute(
                    text(
                        """
                        INSERT INTO user_type_permissions (id, user_type_id, permission_code)
                        VALUES
                            (:overlap_id, :owner_id, 'UserProfiles.Basic.View'),
                            (:legacy_id, :owner_id, 'Legacy.Profile.Permission')
                        """
                    ),
                    {
                        "overlap_id": overlap_id,
                        "legacy_id": legacy_id,
                        "owner_id": role_ids["OWNER"],
                    },
                )
    finally:
        await engine.dispose()
    return role_ids, overlap_id, legacy_id


@pytest.mark.asyncio
async def test_0019_assigns_production_shaped_profile_permissions_with_explicit_ids() -> (
    None
):
    database, database_url = await _create_database("m19_existing_roles")
    try:
        _run_alembic(database_url, "upgrade", _REV_0018)
        role_ids, overlap_id, legacy_id = await _seed_historical_identity(
            database_url, ("OWNER", "HR", "PRO")
        )

        _run_alembic(database_url, "upgrade", _REV_0019)

        engine = create_async_engine(database_url)
        try:
            async with engine.connect() as connection:
                revision = await connection.scalar(
                    text("SELECT version_num FROM alembic_version")
                )
                assert revision == _REV_0019
                rows = (
                    await connection.execute(
                        text(
                            """
                            SELECT id, user_type_id, permission_code
                            FROM user_type_permissions
                            WHERE user_type_id = ANY(:role_ids)
                            """
                        ),
                        {"role_ids": list(role_ids.values())},
                    )
                ).all()
        finally:
            await engine.dispose()

        assert all(row.id is not None for row in rows)
        assert len({row.id for row in rows}) == len(rows)
        by_role = {
            code: [row for row in rows if row.user_type_id == role_id]
            for code, role_id in role_ids.items()
        }
        for code, expected in _PROFILE_GRANTS.items():
            actual = [
                row.permission_code
                for row in by_role[code]
                if row.permission_code in expected
            ]
            assert set(actual) == expected
            assert len(actual) == len(expected)
        owner_rows = by_role["OWNER"]
        assert (
            next(
                row.id
                for row in owner_rows
                if row.permission_code == "UserProfiles.Basic.View"
            )
            == overlap_id
        )
        assert (
            next(
                row.id
                for row in owner_rows
                if row.permission_code == "Legacy.Profile.Permission"
            )
            == legacy_id
        )
    finally:
        await _drop_database(database)


@pytest.mark.asyncio
@pytest.mark.parametrize("role_codes", [(), ("OWNER",)])
async def test_0019_handles_missing_hr_and_pro_user_types(
    role_codes: tuple[str, ...],
) -> None:
    database, database_url = await _create_database("m19_missing_roles")
    try:
        _run_alembic(database_url, "upgrade", _REV_0018)
        role_ids, _, _ = await _seed_historical_identity(database_url, role_codes)
        _run_alembic(database_url, "upgrade", _REV_0019)

        engine = create_async_engine(database_url)
        try:
            async with engine.connect() as connection:
                count = await connection.scalar(
                    text("SELECT count(*) FROM user_type_permissions")
                )
                revision = await connection.scalar(
                    text("SELECT version_num FROM alembic_version")
                )
        finally:
            await engine.dispose()
        assert revision == _REV_0019
        assert count == (len(_PROFILE_GRANTS["OWNER"]) + 1 if role_ids else 0)
    finally:
        await _drop_database(database)


@pytest.mark.asyncio
async def test_fresh_database_upgrades_to_head_and_schema_is_current() -> None:
    database, database_url = await _create_database("m19_fresh")
    try:
        _run_alembic(database_url, "upgrade", "head")
        current = _run_alembic(database_url, "current")
        assert f"{_HEAD_REVISION} (head)" in current
        check = _run_alembic(database_url, "check")
        assert "No new upgrade operations detected" in check
    finally:
        await _drop_database(database)
