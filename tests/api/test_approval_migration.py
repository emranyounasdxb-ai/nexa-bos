import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from database_safety import validate_test_database_url
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from test_contract_migration import _alembic, _drop_database, _new_database
from test_exit_migration import assert_server_identity


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "codes", [("OWNER", "HR", "TL", "SE", "PRO", "UX00000001"), ("OWNER",), ("HR",), ()]
)
async def test_approval_migration_preserves_existing_permissions_and_records(codes):
    database, url = await _new_database("approvals")
    target = validate_test_database_url(url)
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            identity = (
                await connection.execute(
                    text(
                        "SELECT current_database(), host(inet_server_addr()), "
                        "inet_server_port(), current_setting('server_version')"
                    )
                )
            ).one()
            assert_server_identity(identity, database, os.environ["VERIFIED_TEST_SERVER"])
        print(f"Guard PASS: host={target.host} port={target.port} database={target.database}")
        _alembic(url, "upgrade", "0023_exit_offboarding")
        roles = {code: uuid4() for code in codes}
        overlap = uuid4()
        async with engine.begin() as connection:
            for code, role_id in roles.items():
                await connection.execute(
                    text(
                        "INSERT INTO user_types (id,code,name,is_system,status,mfa_required,"
                        "can_be_reporting_manager,can_be_case_owner,created_at,updated_at) "
                        "VALUES (:id,:code,:code,true,'active',false,false,false,:now,:now)"
                    ),
                    {"id": role_id, "code": code, "now": datetime.now(UTC)},
                )
            if "OWNER" in roles:
                await connection.execute(
                    text(
                        "INSERT INTO permissions (code,description) "
                        "VALUES ('Approvals.View','Existing')"
                    )
                )
                await connection.execute(
                    text(
                        "INSERT INTO user_type_permissions (id,user_type_id,permission_code) "
                        "VALUES (:id,:role,'Approvals.View')"
                    ),
                    {"id": overlap, "role": roles["OWNER"]},
                )
            before = {
                table: await connection.scalar(text(f"SELECT count(*) FROM {table}"))
                for table in (
                    "users",
                    "leave_requests",
                    "employment_contracts",
                    "employee_transfers",
                    "employee_exits",
                )
            }
        _alembic(url, "upgrade", "head")
        _alembic(url, "upgrade", "head")
        async with engine.connect() as connection:
            rows = (
                await connection.execute(
                    text(
                        "SELECT id,user_type_id,permission_code FROM user_type_permissions "
                        "WHERE permission_code LIKE 'Approvals.%'"
                    )
                )
            ).all()
            assert all(row.id for row in rows)
            assert len({row.id for row in rows}) == len(rows)
            assert len({(row.user_type_id, row.permission_code) for row in rows}) == len(rows)
            for code, role_id in roles.items():
                assert {row.permission_code for row in rows if row.user_type_id == role_id} == (
                    {"Approvals.View", "Approvals.Decide"}
                    if code in {"OWNER", "HR", "TL"}
                    else set()
                )
            if "OWNER" in roles:
                assert (
                    next(
                        row.id
                        for row in rows
                        if row.user_type_id == roles["OWNER"]
                        and row.permission_code == "Approvals.View"
                    )
                    == overlap
                )
            assert before == {
                table: await connection.scalar(text(f"SELECT count(*) FROM {table}"))
                for table in before
            }
        assert "0027_org_business_units (head)" in _alembic(url, "current")
        assert "No new upgrade operations detected" in _alembic(url, "check")
    finally:
        await engine.dispose()
        await _drop_database(database)
