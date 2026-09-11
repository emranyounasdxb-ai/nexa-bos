import os
from uuid import uuid4

import pytest
from database_safety import validate_test_database_url
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from test_contract_migration import _alembic, _drop_database, _new_database
from test_exit_migration import assert_server_identity


@pytest.mark.asyncio
async def test_org_history_upgrade_preserves_existing_records_without_mapping():
    database, url = await _new_database("org_history")
    target = validate_test_database_url(url)
    engine = create_async_engine(url)
    ids = {kind: uuid4() for kind in ("office", "department", "designation", "team")}
    histories = {kind: uuid4() for kind in ids}
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
        _alembic(url, "upgrade", "0026_terminate_sessions")
        async with engine.begin() as connection:
            for kind, record_id in ids.items():
                columns, values = "", ""
                if kind in ("department", "team"):
                    columns += ",office_id"
                    values += ",:office"
                if kind == "team":
                    columns += ",department_id"
                    values += ",:department"
                await connection.execute(
                    text(
                        f"INSERT INTO {kind}s (id,code,name,status,created_at,updated_at{columns}) "
                        f"VALUES (:id,:code,:name,'active',now(),now(){values})"
                    ),
                    {**ids, "id": record_id, "code": f"LEGACY-{kind}", "name": f"Legacy {kind}"},
                )
                await connection.execute(
                    text(
                        f"INSERT INTO {kind}_name_history (id,{kind}_id,name,effective_from) "
                        "VALUES (:id,:record,:name,now())"
                    ),
                    {"id": histories[kind], "record": record_id, "name": f"Legacy {kind}"},
                )
            before = {}
            for kind in ids:
                before[kind] = dict(
                    (
                        await connection.execute(
                            text(f"SELECT * FROM {kind}s WHERE id=:id"), {"id": ids[kind]}
                        )
                    )
                    .mappings()
                    .one()
                )
        # Alembic runs in a separate process. Discard pre-DDL prepared statements
        # before reconnecting to the upgraded schema; no retry of failed queries.
        await engine.dispose()
        _alembic(url, "upgrade", "head")
        async with engine.connect() as connection:
            for kind, record_id in ids.items():
                after = dict(
                    (
                        await connection.execute(
                            text(f"SELECT * FROM {kind}s WHERE id=:id"), {"id": record_id}
                        )
                    )
                    .mappings()
                    .one()
                )
                if kind == "team":
                    assert after.pop("business_unit_id") is None
                assert after == before[kind]
                row = (
                    (
                        await connection.execute(
                            text(f"SELECT * FROM {kind}_name_history WHERE id=:id"),
                            {"id": histories[kind]},
                        )
                    )
                    .mappings()
                    .one()
                )
                assert row["original_record_id"] == record_id
                assert row[f"{kind}_id"] == record_id
                assert row["name"] == f"Legacy {kind}"
            assert await connection.scalar(text("SELECT count(*) FROM business_units")) == 0
            assert (
                await connection.scalar(text("SELECT count(*) FROM organization_master_deletions"))
                == 0
            )
            destructive = await connection.scalar(
                text(
                    "SELECT count(*) FROM pg_constraint WHERE contype='f' AND confdeltype='c' "
                    "AND conrelid IN ('office_name_history'::regclass, "
                    "'department_name_history'::regclass, 'designation_name_history'::regclass, "
                    "'team_name_history'::regclass, 'team_leader_history'::regclass)"
                )
            )
            assert destructive == 0
        assert "0027_org_business_units (head)" in _alembic(url, "current")
        assert "No new upgrade operations detected" in _alembic(url, "check")
    finally:
        await engine.dispose()
        await _drop_database(database)
