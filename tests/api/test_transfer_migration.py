from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from database_safety import validate_test_database_url
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from test_contract_migration import _alembic, _drop_database, _new_database

PERMISSIONS = {
    "Transfers.ViewOwn",
    "Transfers.View",
    "Transfers.Create",
    "Transfers.Recommend",
    "Transfers.Edit",
    "Transfers.Review",
    "Transfers.Approve",
    "Transfers.ReturnReject",
    "Transfers.Cancel",
    "Transfers.History",
}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "codes", [("OWNER", "HR", "PRO", "TL", "SE", "UX00000001"), ("OWNER",), ("HR", "PRO"), ()]
)
async def test_transfer_production_shaped_upgrade_preserves_grants(codes):
    database, url = await _new_database("transfer")
    engine = create_async_engine(url)
    try:
        guard = validate_test_database_url(url)
        async with engine.connect() as connection:
            identity = (
                await connection.execute(
                    text(
                        "SELECT current_database(), host(inet_server_addr()), "
                        "inet_server_port(), current_setting('server_version')"
                    )
                )
            ).one()
            assert (
                identity[0] == database and identity[2] == 5432 and identity[3].startswith("18.6")
            )
            print(f"Guard PASS: host={guard.host} port={guard.port} database={guard.database}")
        _alembic(url, "upgrade", "0021_contract_register")
        ids = {code: uuid4() for code in codes}
        overlap = uuid4()
        async with engine.begin() as connection:
            for code, role_id in ids.items():
                await connection.execute(
                    text("""
                    INSERT INTO user_types (id, code, name, is_system, status, mfa_required,
                    can_be_reporting_manager, can_be_case_owner, created_at, updated_at)
                    VALUES (:id, :code, :code, true, 'active', false, false, false, :now, :now)
                """),
                    {"id": role_id, "code": code, "now": datetime.now(UTC)},
                )
            if "OWNER" in ids:
                await connection.execute(
                    text(
                        "INSERT INTO permissions (code, description) "
                        "VALUES ('Transfers.ViewOwn', 'Overlap')"
                    )
                )
                await connection.execute(
                    text(
                        "INSERT INTO user_type_permissions (id, user_type_id, permission_code) "
                        "VALUES (:id, :role, 'Transfers.ViewOwn')"
                    ),
                    {"id": overlap, "role": ids["OWNER"]},
                )
        _alembic(url, "upgrade", "0022_employee_transfers")
        _alembic(url, "upgrade", "head")
        async with engine.connect() as connection:
            rows = (
                await connection.execute(
                    text(
                        "SELECT id, user_type_id, permission_code FROM user_type_permissions "
                        "WHERE permission_code LIKE 'Transfers.%'"
                    )
                )
            ).all()
            assert len({r.id for r in rows}) == len(rows)
            assert len({(r.user_type_id, r.permission_code) for r in rows}) == len(rows)
            assert all(r.id is not None for r in rows)
            for code, role_id in ids.items():
                expected = (
                    PERMISSIONS
                    if code == "OWNER"
                    else PERMISSIONS - {"Transfers.Approve", "Transfers.Recommend"}
                    if code == "HR"
                    else {"Transfers.ViewOwn", "Transfers.Recommend", "Transfers.History"}
                    if code == "TL"
                    else {"Transfers.ViewOwn"}
                    if code == "SE"
                    else set()
                )
                assert {r.permission_code for r in rows if r.user_type_id == role_id} == expected
            if "OWNER" in ids:
                assert (
                    next(
                        r.id
                        for r in rows
                        if r.user_type_id == ids["OWNER"]
                        and r.permission_code == "Transfers.ViewOwn"
                    )
                    == overlap
                )
            assert await connection.scalar(text("SELECT count(*) FROM employee_transfers")) == 0
        assert "0027_org_business_units (head)" in _alembic(url, "current")
        assert "No new upgrade operations detected" in _alembic(url, "check")
    finally:
        await engine.dispose()
        await _drop_database(database)
