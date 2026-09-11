from datetime import UTC, datetime
from uuid import uuid4

import pytest
from database_safety import validate_test_database_url
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from test_contract_migration import _alembic, _drop_database, _new_database

PERMISSIONS = {
    "Exits.ViewOwn",
    "Exits.View",
    "Exits.Request",
    "Exits.Create",
    "Exits.Edit",
    "Exits.Progress",
    "Exits.Assign",
    "Exits.Clearance",
    "Exits.Approve",
    "Exits.ReturnReject",
    "Exits.Cancel",
    "Exits.History",
}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "codes", [("OWNER", "HR", "PRO", "TL", "SE", "UX00000001"), ("OWNER",), ("HR", "PRO"), ()]
)
async def test_exit_production_shaped_upgrade_preserves_grants(codes):
    database, url = await _new_database("exit")
    engine = create_async_engine(url)
    try:
        target = validate_test_database_url(url)
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
                identity[0] == database
                and identity[1] == target.host
                and identity[2] == target.port
                and identity[3].startswith("18.6")
            )
            print(f"Guard PASS: host={target.host} port={target.port} database={target.database}")
        _alembic(url, "upgrade", "0022_employee_transfers")
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
                        "VALUES ('Exits.ViewOwn','Overlap')"
                    )
                )
                await connection.execute(
                    text(
                        "INSERT INTO user_type_permissions (id,user_type_id,permission_code) "
                        "VALUES (:id,:role,'Exits.ViewOwn')"
                    ),
                    {"id": overlap, "role": ids["OWNER"]},
                )
        _alembic(url, "upgrade", "head")
        _alembic(url, "upgrade", "head")
        async with engine.connect() as connection:
            rows = (
                await connection.execute(
                    text(
                        "SELECT id,user_type_id,permission_code FROM user_type_permissions "
                        "WHERE permission_code LIKE 'Exits.%'"
                    )
                )
            ).all()
            assert all(row.id is not None for row in rows)
            assert len({row.id for row in rows}) == len(rows)
            assert len({(row.user_type_id, row.permission_code) for row in rows}) == len(rows)
            for code, role_id in ids.items():
                expected = (
                    PERMISSIONS
                    if code == "OWNER"
                    else PERMISSIONS - {"Exits.Approve"}
                    if code == "HR"
                    else {"Exits.ViewOwn", "Exits.Request", "Exits.Clearance"}
                    if code in {"TL", "SE"}
                    else set()
                )
                assert {
                    row.permission_code for row in rows if row.user_type_id == role_id
                } == expected
            if "OWNER" in ids:
                assert (
                    next(
                        row.id
                        for row in rows
                        if row.user_type_id == ids["OWNER"]
                        and row.permission_code == "Exits.ViewOwn"
                    )
                    == overlap
                )
            assert await connection.scalar(text("SELECT count(*) FROM employee_exits")) == 0
        assert "0023_exit_offboarding (head)" in _alembic(url, "current")
        assert "No new upgrade operations detected" in _alembic(url, "check")
    finally:
        await engine.dispose()
        await _drop_database(database)
