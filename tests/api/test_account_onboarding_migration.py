import os
from uuid import uuid4

import pytest
from database_safety import validate_test_database_url
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from test_contract_migration import _alembic, _drop_database, _new_database
from test_exit_migration import assert_server_identity


@pytest.mark.asyncio
async def test_existing_identity_preserved_and_missing_code_backfilled():
    database, url = await _new_database("onboarding")
    target = validate_test_database_url(url)
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            identity = (
                await connection.execute(
                    text(
                        "SELECT current_database(),host(inet_server_addr()),inet_server_port(),"
                        "current_setting('server_version')"
                    )
                )
            ).one()
            assert_server_identity(identity, database, os.environ["VERIFIED_TEST_SERVER"])
        print(f"Guard PASS: host={target.host} port={target.port} database={target.database}")
        _alembic(url, "upgrade", "0024_approval_centre")
        roles = {code: uuid4() for code in ("OWNER", "HR", "PRO")}
        designation = uuid4()
        ids = [uuid4(), uuid4(), uuid4()]
        async with engine.begin() as connection:
            for code, role_id in roles.items():
                await connection.execute(
                    text(
                        "INSERT INTO user_types(id,code,name,is_system,status,mfa_required,"
                        "can_be_reporting_manager,can_be_case_owner,created_at,updated_at) "
                        "VALUES(:id,:code,:code,true,'active',false,false,false,now(),now())"
                    ),
                    {"id": role_id, "code": code},
                )
            await connection.execute(
                text(
                    "INSERT INTO designations(id,code,name,status,created_at,updated_at) "
                    "VALUES(:id,'TEST','Test','active',now(),now())"
                ),
                {"id": designation},
            )
            for index, (code, role) in enumerate(
                zip(("USR-000999", "", "USR-000002"), roles, strict=True)
            ):
                await connection.execute(
                    text(
                        "INSERT INTO users(id,user_code,employee_code,full_name,email,mobile,"
                        "designation_id,employment_status,joining_date,user_type_id,account_status,"
                        "failed_login_count,mfa_enabled,created_at,updated_at,"
                        "first_name,last_name) "
                        "VALUES(:id,:code,:employee,'Existing Employee',:email,'+971500001111',"
                        ":designation,'Active','2026-01-01',:role,'active',0,false,now(),now(),"
                        "'Historical','Name')"
                    ),
                    {
                        "id": ids[index],
                        "code": code,
                        "employee": f"EMP-Test-{index}",
                        "email": f"test-{index}@example.test",
                        "designation": designation,
                        "role": roles[role],
                    },
                )
            before = (
                await connection.execute(
                    text(
                        "SELECT id,employee_code,full_name,email,mobile,first_name,last_name,"
                        "account_status,user_type_id,joining_date FROM users ORDER BY id"
                    )
                )
            ).all()
        _alembic(url, "upgrade", "head")
        async with engine.connect() as connection:
            after = (
                await connection.execute(
                    text(
                        "SELECT id,employee_code,full_name,email,mobile,first_name,last_name,"
                        "account_status,user_type_id,joining_date FROM users ORDER BY id"
                    )
                )
            ).all()
            assert before == after
            codes = dict((await connection.execute(text("SELECT id,user_code FROM users"))).all())
            assert codes == {ids[0]: "USR-000999", ids[1]: "USR-001000", ids[2]: "USR-000002"}
            assert (
                await connection.scalar(
                    text("SELECT last_value FROM user_code_counters WHERE id=1")
                )
                == 1000
            )
            assert (
                await connection.scalar(
                    text("SELECT count(*) FROM users WHERE work_email=email AND work_mobile=mobile")
                )
                == 3
            )
            assert await connection.scalar(text("SELECT count(*) FROM user_code_reservations")) == 0
        assert "0026_terminate_sessions (head)" in _alembic(url, "current")
        assert "No new upgrade operations detected" in _alembic(url, "check")
    finally:
        await engine.dispose()
        await _drop_database(database)
