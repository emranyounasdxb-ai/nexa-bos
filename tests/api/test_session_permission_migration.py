import importlib.util
import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from database_safety import validate_test_database_url
from nexa_bos_api.core.config import API_ROOT
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from test_contract_migration import _alembic, _drop_database, _new_database
from test_exit_migration import assert_server_identity


@pytest.mark.asyncio
@pytest.mark.parametrize("owner_exists, overlap", [(True, False), (True, True), (False, False)])
async def test_session_permission_owner_only_idempotent_explicit_ids(owner_exists, overlap):
    database, url = await _new_database("session_permission")
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
        _alembic(url, "upgrade", "0025_account_onboarding")
        roles = {code: uuid4() for code in ("GM", "HR", "PRO", "SE", "TL", "UX00000001")}
        if owner_exists:
            roles["OWNER"] = uuid4()
        existing_id = uuid4()
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
            if overlap:
                await connection.execute(
                    text(
                        "INSERT INTO permissions (code,description) "
                        "VALUES ('Users.TerminateSessions','Existing')"
                    )
                )
                await connection.execute(
                    text(
                        "INSERT INTO user_type_permissions (id,user_type_id,permission_code) "
                        "VALUES (:id,:role,'Users.TerminateSessions')"
                    ),
                    {"id": existing_id, "role": roles["OWNER"]},
                )
        _alembic(url, "upgrade", "head")
        # Execute the actual migration a second time, rather than only the Alembic
        # no-op at head, to prove ON CONFLICT preserves the existing assignment ID.
        path = API_ROOT / "alembic/versions/0026_terminate_sessions_permission.py"
        spec = importlib.util.spec_from_file_location("permission_migration", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        async with engine.begin() as connection:

            def reapply(sync):
                with Operations.context(MigrationContext.configure(sync)):
                    module.upgrade()

            await connection.run_sync(reapply)
            rows = (
                await connection.execute(
                    text(
                        "SELECT id,user_type_id FROM user_type_permissions "
                        "WHERE permission_code='Users.TerminateSessions'"
                    )
                )
            ).all()
            assert len(rows) == (1 if owner_exists else 0)
            if owner_exists:
                assert rows[0].id is not None
                assert rows[0].user_type_id == roles["OWNER"]
                if overlap:
                    assert rows[0].id == existing_id
        assert "0027_org_business_units (head)" in _alembic(url, "current")
        assert "No new upgrade operations detected" in _alembic(url, "check")
    finally:
        await engine.dispose()
        await _drop_database(database)
