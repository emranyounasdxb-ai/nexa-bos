from __future__ import annotations

import os
import subprocess
import sys
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from nexa_bos_api.core.config import API_ROOT
from nexa_bos_api.identity.models import User
from nexa_bos_api.targets.enums import (
    DIRECTION_LOWER,
    KPI_STATUS_ACTIVE,
    KPI_STATUS_INACTIVE,
    KpiDirection,
)
from nexa_bos_api.targets.schemas import KpiMetricInput, KpiScorecardUpdateRequest
from nexa_bos_api.targets.service import set_scorecard_status, update_scorecard
from sqlalchemy import select, text
from sqlalchemy.engine.url import URL, make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

_REV_0001 = "0001_baseline"
_REV_0010 = "0010_conformance_remediation"
_REV_0011 = "0011_kpi_missing_baseline"


def _app_database_url() -> str:
    return os.environ["DATABASE_URL"]


def _render_url(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def _run_alembic(database_url: str, revision: str) -> str:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    env["APP_ENV"] = "test"
    completed = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=API_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    output = f"{completed.stdout}\n{completed.stderr}"
    assert completed.returncode == 0, output
    return output


def _assert_revision_chain() -> None:
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    script = ScriptDirectory.from_config(config)
    revision_0011 = script.get_revision(_REV_0011)
    assert revision_0011 is not None
    assert revision_0011.down_revision == _REV_0010
    chain = [item.revision for item in script.walk_revisions("base", _REV_0011)]
    assert chain[0] == _REV_0011
    assert _REV_0010 in chain
    assert chain[-1] == _REV_0001


async def _admin_execute(statement: str) -> None:
    url = make_url(_app_database_url())
    engine = create_async_engine(url, isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as connection:
            await connection.execute(text(statement))
    finally:
        await engine.dispose()


async def _fetch_one(database_url: str, statement: str, params: dict[str, object]) -> object:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            return (await connection.execute(text(statement), params)).one()
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_alembic_0011_deactivates_active_scorecard_missing_required_baseline() -> None:
    _assert_revision_chain()
    db_name = f"nexa_bos_test_m11_{uuid4().hex[:12]}"
    isolated_url = _render_url(make_url(_app_database_url()).set(database=db_name))
    await _admin_execute(f'CREATE DATABASE "{db_name}"')
    try:
        to_0010 = _run_alembic(isolated_url, _REV_0010)
        assert f"Running upgrade  -> {_REV_0001}" in to_0010
        assert f"Running upgrade 0009_targets_kpi -> {_REV_0010}" in to_0010
        assert _REV_0011 not in to_0010

        version = await _fetch_one(isolated_url, "SELECT version_num FROM alembic_version", {})
        assert version[0] == _REV_0010

        user_id = uuid4()
        designation_id = uuid4()
        scorecard_id = uuid4()
        metric_id = uuid4()
        now = datetime.now(UTC)
        engine = create_async_engine(isolated_url)
        try:
            async with engine.begin() as connection:
                await connection.execute(
                    text(
                        """
                        INSERT INTO designations
                            (id, code, name, status, created_at, updated_at)
                        VALUES
                            (:id, :code, :name, 'active', :now, :now)
                        """
                    ),
                    {
                        "id": designation_id,
                        "code": f"M{uuid4().hex[:8]}",
                        "name": "Migration Actor",
                        "now": now,
                    },
                )
                await connection.execute(
                    text(
                        """
                        INSERT INTO users (
                            id, user_code, employee_code, full_name, email, mobile,
                            designation_id, employment_status, joining_date, account_status,
                            failed_login_count, mfa_enabled, created_at, updated_at
                        ) VALUES (
                            :id, :user_code, :employee_code, :full_name, :email, :mobile,
                            :designation_id, 'Active', :joining_date, 'active',
                            0, false, :now, :now
                        )
                        """
                    ),
                    {
                        "id": user_id,
                        "user_code": "USR-MIG001",
                        "employee_code": f"EMP-M{uuid4().hex[:8]}",
                        "full_name": "Legacy KPI Owner",
                        "email": f"legacy-kpi-{uuid4().hex[:8]}@example.com",
                        "mobile": "+971500000099",
                        "designation_id": designation_id,
                        "joining_date": date(2026, 1, 1),
                        "now": now,
                    },
                )
                await connection.execute(
                    text(
                        """
                        INSERT INTO kpi_scorecards
                            (id, name, status, created_at, updated_at,
                             created_by_id, updated_by_id)
                        VALUES
                            (:id, :name, 'active', :now, :now, :user_id, :user_id)
                        """
                    ),
                    {
                        "id": scorecard_id,
                        "name": "Legacy Lower Is Better",
                        "now": now,
                        "user_id": user_id,
                    },
                )
                await connection.execute(
                    text(
                        """
                        INSERT INTO kpi_scorecard_metrics
                            (id, scorecard_id, metric_code, weight_percent,
                             direction, baseline, sort_order)
                        VALUES
                            (:id, :scorecard_id, 'submitted_to_final_rejected',
                             100.00, :direction, NULL, 0)
                        """
                    ),
                    {
                        "id": metric_id,
                        "scorecard_id": scorecard_id,
                        "direction": DIRECTION_LOWER,
                    },
                )
        finally:
            await engine.dispose()

        before = await _fetch_one(
            isolated_url,
            """
            SELECT card.status, metric.baseline, card.name, metric.metric_code
            FROM kpi_scorecards AS card
            JOIN kpi_scorecard_metrics AS metric ON metric.scorecard_id = card.id
            WHERE card.id = :scorecard_id AND metric.id = :metric_id
            """,
            {"scorecard_id": scorecard_id, "metric_id": metric_id},
        )
        assert before[0] == KPI_STATUS_ACTIVE
        assert before[1] is None

        to_0011 = _run_alembic(isolated_url, _REV_0011)
        assert f"Running upgrade {_REV_0010} -> {_REV_0011}" in to_0011

        current = await _fetch_one(isolated_url, "SELECT version_num FROM alembic_version", {})
        assert current[0] == _REV_0011

        after = await _fetch_one(
            isolated_url,
            """
            SELECT card.status, metric.baseline, card.name, metric.metric_code,
                   metric.weight_percent, metric.direction
            FROM kpi_scorecards AS card
            JOIN kpi_scorecard_metrics AS metric ON metric.scorecard_id = card.id
            WHERE card.id = :scorecard_id AND metric.id = :metric_id
            """,
            {"scorecard_id": scorecard_id, "metric_id": metric_id},
        )
        assert after[0] == KPI_STATUS_INACTIVE
        assert after[1] is None
        assert after[2] == "Legacy Lower Is Better"
        assert after[3] == "submitted_to_final_rejected"
        assert after[4] == Decimal("100.00")
        assert after[5] == DIRECTION_LOWER

        service_engine = create_async_engine(isolated_url)
        factory = async_sessionmaker(service_engine, expire_on_commit=False)
        try:
            async with factory() as session:
                actor = (await session.execute(select(User).where(User.id == user_id))).scalar_one()
                patched = await update_scorecard(
                    session,
                    actor,
                    scorecard_id,
                    KpiScorecardUpdateRequest(
                        metrics=[
                            KpiMetricInput(
                                metric_code="submitted_to_final_rejected",
                                weight_percent=Decimal("100"),
                                direction=KpiDirection.LOWER_IS_BETTER,
                                baseline=Decimal("8"),
                            )
                        ]
                    ),
                )
                assert patched["status"] == KPI_STATUS_INACTIVE
                assert patched["metrics"][0]["baseline"] == "8.00"
                activated = await set_scorecard_status(session, actor, scorecard_id, active=True)
                assert activated["status"] == KPI_STATUS_ACTIVE
                assert activated["metrics"][0]["baseline"] == "8.00"
        finally:
            await service_engine.dispose()
    finally:
        await _admin_execute(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)')
