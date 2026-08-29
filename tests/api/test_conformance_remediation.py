from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pyotp
import pytest
from httpx import AsyncClient
from sqlalchemy import insert, select, text
from sqlalchemy.exc import IntegrityError

from helpers import (
    OWNER_EMAIL,
    OWNER_PASSWORD,
    authenticate,
    create_activated_user,
    designation_id,
    office_id,
    owner_client,
    spawned_client,
    unique_tag,
)
from nexa_bos_api.attendance.enums import AttendanceStatus, ImpactCondition, ImpactMethod
from nexa_bos_api.attendance.service import compute_score
from nexa_bos_api.catalog.service import seed_catalog
from nexa_bos_api.customers.service import name_similarity, normalize_name
from nexa_bos_api.identity.enums import VisibilityScope
from nexa_bos_api.identity.models import OwnerSingleton, ReservedEmail, ReservedEmployeeCode
from nexa_bos_api.main import app
from nexa_bos_api.reporting.periods import PeriodWindow, resolve_period
from nexa_bos_api.reporting.scope import ReportingAccess
from nexa_bos_api.reporting.service import (
    AppFact,
    Attribution,
    MetricEngine,
    ReportFilters,
    trend_points,
)
from nexa_bos_api.targets.calc import default_measurement, month_end
from nexa_bos_api.targets.enums import DIRECTION_LOWER, KPI_STATUS_ACTIVE, KPI_STATUS_INACTIVE
from nexa_bos_api.targets.kpi_baseline_upgrade import DEACTIVATE_ACTIVE_MISSING_BASELINE_SQL
from nexa_bos_api.targets.models import KpiScorecard, KpiScorecardMetric
from nexa_bos_api.targets.service import _period_bounds

_TEST_STAGES = (
    ("SUBMITTED", "Submitted", 20),
    ("RETURNED_REQUIREMENT_PENDING", "Returned / Requirement Pending", 30),
    ("RESUBMITTED", "Resubmitted", 40),
    ("APPROVED", "Approved", 50),
    ("BOOKED", "Booked", 60),
    ("FUND_RELEASED", "Fund Released", 70),
)
_TEST_TRANSITIONS = (
    ("application_created", "submitted"),
    ("submitted", "returned_requirement_pending"),
    ("submitted", "approved"),
    ("returned_requirement_pending", "resubmitted"),
    ("resubmitted", "returned_requirement_pending"),
    ("resubmitted", "approved"),
    ("approved", "booked"),
    ("booked", "fund_released"),
)


async def _catalog(client: AsyncClient) -> tuple[dict, dict, dict, dict]:
    banks = {item["code"]: item for item in (await client.get("/api/v1/banks")).json()["items"]}
    products = {
        item["code"]: item for item in (await client.get("/api/v1/products")).json()["items"]
    }
    return banks["DIB"], banks["EIB"], products["PF"], products["CC"]


async def _enable_case_owner(client: AsyncClient, code: str = "OWNER") -> None:
    types = (await client.get("/api/v1/user-types")).json()["items"]
    row = next(item for item in types if item["code"] == code)
    if row["canBeCaseOwner"]:
        return
    response = await client.put(
        f"/api/v1/user-types/{row['id']}/case-owner",
        json={"can_be_case_owner": True},
    )
    assert response.status_code == 200, response.text


async def _ensure_workflow(client: AsyncClient, bank_id: str, product_id: str) -> dict:
    listed = await client.get(f"/api/v1/workflows?bank_id={bank_id}&product_id={product_id}")
    items = listed.json()["items"]
    active = next((item for item in items if item["status"] == "active"), None)
    if active and any(stage.get("systemKey") == "submitted" for stage in active["stages"]):
        return active
    created = await client.post(
        "/api/v1/workflows", json={"bank_id": bank_id, "product_id": product_id}
    )
    assert created.status_code == 200, created.text
    workflow = created.json()
    if any(stage.get("systemKey") == "submitted" for stage in workflow["stages"]):
        return workflow
    for code, name, order in _TEST_STAGES:
        added = await client.post(
            f"/api/v1/workflows/{workflow['id']}/stages",
            json={"name": name, "code": code, "sort_order": order},
        )
        assert added.status_code == 200, added.text
    workflow = (await client.get(f"/api/v1/workflows/{workflow['id']}")).json()
    by_key = {stage["systemKey"]: stage["id"] for stage in workflow["stages"]}
    updated = await client.put(
        f"/api/v1/workflows/{workflow['id']}/transitions",
        json={
            "items": [
                {"from_stage_id": by_key[source], "to_stage_id": by_key[target]}
                for source, target in _TEST_TRANSITIONS
            ]
        },
    )
    assert updated.status_code == 200, updated.text
    return updated.json()


async def _customer(client: AsyncClient, name: str, **extra: object) -> dict:
    payload: dict[str, object] = {
        "customer_type": "individual",
        "full_name": extra.pop("full_name", f"{name} {unique_tag()}"),
        "mobile": extra.pop("mobile", f"+97150{unique_tag()[:8]}"),
        "create_anyway": extra.pop("create_anyway", True),
        **extra,
    }
    response = await client.post("/api/v1/customers", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


async def _create_app(
    client: AsyncClient,
    *,
    customer_id: str,
    bank_id: str,
    product_id: str,
    case_owner_id: str,
    requested_amount: str | None = "10000",
) -> dict:
    await _enable_case_owner(client)
    await _ensure_workflow(client, bank_id, product_id)
    response = await client.post(
        "/api/v1/applications",
        json={
            "customer_id": customer_id,
            "bank_id": bank_id,
            "product_id": product_id,
            "case_owner_id": case_owner_id,
            "requested_amount": requested_amount,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _attr(owner_id: UUID) -> Attribution:
    return Attribution(owner_id, None, None, None, None, None)


def _fact(
    *,
    submitted_at: datetime | None,
    approved_at: datetime | None = None,
    booked_at: datetime | None = None,
    funded_at: datetime | None = None,
    terminal_at: datetime | None = None,
    terminal_outcome: str | None = None,
    owner_id: UUID | None = None,
) -> AppFact:
    owner = owner_id or uuid4()
    attr = _attr(owner)
    now = submitted_at or datetime(2026, 1, 1, tzinfo=UTC)
    stage_id = uuid4()
    return AppFact(
        id=uuid4(),
        code="APP-TEST",
        customer_id=uuid4(),
        customer_name="Test",
        bank_id=uuid4(),
        bank_code="DIB",
        product_id=uuid4(),
        product_code="PF",
        created_at=now,
        submitted_at=submitted_at,
        approved_at=approved_at,
        booked_at=booked_at,
        funded_at=funded_at,
        terminal_at=terminal_at,
        terminal_outcome=terminal_outcome,
        requested_amount=Decimal("1000"),
        approved_amount=Decimal("1000"),
        booked_amount=Decimal("1000"),
        funded_amount=Decimal("1000"),
        current_stage_id=stage_id,
        current_stage_name="Submitted",
        current_stage_key="submitted",
        current_owner_id=owner,
        created=attr,
        submitted=attr,
        approved=attr,
        booked=attr,
        funded=attr,
        terminal=attr,
        current_attr=attr,
        occupancies=[],
        stages={},
        history=[],
    )


def _engine(facts: list[AppFact], window: PeriodWindow) -> MetricEngine:
    owner = uuid4()
    access = ReportingAccess(
        actor=SimpleNamespace(id=owner),  # type: ignore[arg-type]
        scope=VisibilityScope.COMPANY,
        descendant_ids=set(),
        current_managers={},
        manager_spans={},
        office_spans={},
    )
    return MetricEngine(facts, access, window, ReportFilters())


def test_fuzzy_name_similarity_threshold() -> None:
    left = normalize_name("Mohammed Ali")
    near = normalize_name("Mohamed Ali")
    far = normalize_name("Fatima Hassan")
    assert left and near and far
    assert name_similarity(left, left) >= 85.0
    assert name_similarity(left, near) >= 85.0
    assert name_similarity(left, far) < 85.0


def test_attendance_points_percentage_stack_and_floor() -> None:
    late_early = SimpleNamespace(
        id=uuid4(),
        attendance_date=date(2026, 8, 3),
        status=AttendanceStatus.PRESENT,
        is_incomplete=False,
        is_late=True,
        is_early_exit=True,
        leave_type_id=None,
    )
    points_late = SimpleNamespace(
        condition=ImpactCondition.LATE, method=ImpactMethod.POINTS, value=10, leave_type_id=None
    )
    percent_early = SimpleNamespace(
        condition=ImpactCondition.EARLY_EXIT,
        method=ImpactMethod.PERCENTAGE,
        value=10,
        leave_type_id=None,
    )
    stacked = compute_score([late_early], [points_late, percent_early])
    assert stacked["score"] == 81.0
    points_only = compute_score([late_early], [points_late])
    assert points_only["score"] == 90.0
    percent_only = compute_score(
        [
            SimpleNamespace(
                id=uuid4(),
                attendance_date=date(2026, 8, 3),
                status=AttendanceStatus.PRESENT,
                is_incomplete=False,
                is_late=False,
                is_early_exit=True,
                leave_type_id=None,
            )
        ],
        [percent_early],
    )
    assert percent_only["score"] == 90.0
    heavy = SimpleNamespace(
        condition=ImpactCondition.LATE, method=ImpactMethod.POINTS, value=200, leave_type_id=None
    )
    floored = compute_score([late_early], [heavy])
    assert floored["score"] == 0.0


def test_historical_target_period_anchors_to_selected_month() -> None:
    today = date(2026, 8, 29)
    month = date(2025, 6, 15)
    qtd_start, qtd_end = _period_bounds("qtd", month, today)
    assert qtd_start == date(2025, 4, 1)
    assert qtd_end == date(2025, 6, 30)
    hy_start, hy_end = _period_bounds("half_year", month, today)
    assert hy_start == date(2025, 1, 1)
    assert hy_end == date(2025, 6, 30)
    ytd_start, ytd_end = _period_bounds("ytd", month, today)
    assert ytd_start == date(2025, 1, 1)
    assert ytd_end == date(2025, 6, 30)


def test_cohort_conversions_do_not_exceed_100_from_mismatched_populations() -> None:
    window = resolve_period("custom", date_from=date(2026, 6, 1), date_to=date(2026, 6, 30))
    in_period = datetime(2026, 6, 10, tzinfo=UTC)
    outside = datetime(2026, 5, 10, tzinfo=UTC)
    after_cutoff = datetime(2026, 7, 2, tzinfo=UTC)
    facts = [
        _fact(submitted_at=in_period, approved_at=in_period),
        _fact(submitted_at=outside, approved_at=in_period),
        _fact(submitted_at=in_period, approved_at=after_cutoff),
    ]
    conversions = _engine(facts, window).conversions()
    assert conversions["submittedToApproved"] == 50.0
    assert conversions["submittedToApproved"] <= 100.0


def test_conversion_cohort_approved_booked_funded_and_terminals() -> None:
    window = resolve_period("custom", date_from=date(2026, 6, 1), date_to=date(2026, 6, 30))
    june = datetime(2026, 6, 15, tzinfo=UTC)
    facts = [
        _fact(submitted_at=june, approved_at=june, booked_at=june, funded_at=june),
        _fact(submitted_at=june, approved_at=june, booked_at=june),
        _fact(
            submitted_at=june,
            terminal_at=june,
            terminal_outcome="Final Rejected",
        ),
        _fact(submitted_at=june, terminal_at=june, terminal_outcome="Cancelled"),
        _fact(submitted_at=june, terminal_at=june, terminal_outcome="Withdrawn"),
    ]
    conversions = _engine(facts, window).conversions()
    assert conversions["approvedToBooked"] == 100.0
    assert conversions["bookedToFunded"] == 50.0
    assert conversions["submittedToFinalRejected"] == 20.0
    assert conversions["submittedToCancelledWithdrawn"] == 40.0


def test_trend_respects_selected_reporting_window() -> None:
    window = resolve_period("custom", date_from=date(2026, 6, 1), date_to=date(2026, 6, 30))
    owner = uuid4()
    access = ReportingAccess(
        actor=SimpleNamespace(id=owner),  # type: ignore[arg-type]
        scope=VisibilityScope.COMPANY,
        descendant_ids=set(),
        current_managers={},
        manager_spans={},
        office_spans={},
    )
    facts = [
        _fact(submitted_at=datetime(2026, 5, 10, tzinfo=UTC), owner_id=owner),
        _fact(
            submitted_at=datetime(2026, 6, 10, tzinfo=UTC),
            funded_at=datetime(2026, 6, 20, tzinfo=UTC),
            owner_id=owner,
        ),
        _fact(submitted_at=datetime(2026, 7, 10, tzinfo=UTC), owner_id=owner),
    ]
    points = trend_points(facts, access, ReportFilters(), window)
    months = {item["month"] for item in points}
    assert months == {"2026-06-01"}


def test_product_measurement_not_inferred_from_amount_flag() -> None:
    pf = SimpleNamespace(target_measurement="amount", requested_amount_required=False)
    cc = SimpleNamespace(target_measurement="count", requested_amount_required=True)
    future = SimpleNamespace(target_measurement="count", requested_amount_required=True)
    assert default_measurement(pf) == "amount"
    assert default_measurement(cc) == "count"
    assert default_measurement(future) == "count"


@pytest.mark.asyncio
async def test_fuzzy_duplicate_warning_and_identifier_block(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag()
    mobile = f"+97150{tag[:8]}"
    email = f"dup-{tag}@example.com"
    first = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": "Mohammed Ali",
            "mobile": mobile,
            "email": email,
        },
    )
    assert first.status_code == 200, first.text
    same = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": "Mohammed Ali",
            "mobile": mobile,
            "email": f"other-{tag}@example.com",
        },
    )
    assert same.status_code == 409
    assert same.json()["error"]["code"] == "CUSTOMER_DUPLICATE_WARNING"
    near_mobile = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": "Mohamed Ali",
            "mobile": mobile,
        },
    )
    assert near_mobile.status_code == 409
    assert near_mobile.json()["error"]["code"] == "CUSTOMER_DUPLICATE_WARNING"
    near_email = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": "Mohamed Ali",
            "mobile": f"+97155{tag[:8]}",
            "email": email,
        },
    )
    assert near_email.status_code == 409
    assert near_email.json()["error"]["code"] == "CUSTOMER_DUPLICATE_WARNING"
    dissimilar = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": "Fatima Hassan",
            "mobile": mobile,
        },
    )
    assert dissimilar.status_code == 200, dissimilar.text
    eid = f"784-{tag.upper()}"
    identified = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": "Other Person",
            "mobile": f"+97156{tag[:8]}",
            "emirates_id": eid,
            "create_anyway": True,
        },
    )
    assert identified.status_code == 200, identified.text
    blocked = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": "Completely Different",
            "mobile": f"+97157{tag[:8]}",
            "emirates_id": eid,
        },
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "CUSTOMER_IDENTIFIER_DUPLICATE"


@pytest.mark.asyncio
async def test_merge_blocks_conflicting_active_applications(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    source = await _customer(authed, "MergeSrc")
    primary = await _customer(authed, "MergePri")
    await _create_app(
        authed, customer_id=source["id"], bank_id=dib["id"], product_id=pf["id"], case_owner_id=owner["id"]
    )
    await _create_app(
        authed,
        customer_id=primary["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    merged = await authed.post(
        f"/api/v1/customers/{source['id']}/merge",
        json={"primary_customer_id": primary["id"]},
    )
    assert merged.status_code == 409
    error = merged.json()["error"]
    assert error["code"] == "APPLICATION_MERGE_CONFLICT"
    assert error["details"][0]["primaryApplicationId"]
    assert error["details"][0]["sourceApplicationId"]
    still_source = (await authed.get(f"/api/v1/customers/{source['id']}")).json()
    still_primary = (await authed.get(f"/api/v1/customers/{primary['id']}")).json()
    assert still_source["status"] != "Merged"
    assert still_primary["status"] == "Active"


@pytest.mark.asyncio
async def test_product_target_measurement_seed_and_independence(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    products = {
        item["code"]: item for item in (await authed.get("/api/v1/products")).json()["items"]
    }
    assert products["PF"]["targetMeasurement"] == "amount"
    assert products["CC"]["targetMeasurement"] == "count"
    options = (await authed.get("/api/v1/targets/options")).json()["products"]
    by_code = {item["code"]: item for item in options}
    assert by_code["PF"]["defaultMeasurement"] == "amount"
    assert by_code["CC"]["defaultMeasurement"] == "count"
    flipped = await authed.put(
        f"/api/v1/products/{products['PF']['id']}/field-rules",
        json={"requested_amount_required": False},
    )
    assert flipped.status_code == 200, flipped.text
    assert flipped.json()["requestedAmountRequired"] is False
    assert flipped.json()["targetMeasurement"] == "amount"
    restored = await authed.put(
        f"/api/v1/products/{products['PF']['id']}/field-rules",
        json={"requested_amount_required": True},
    )
    assert restored.json()["requestedAmountRequired"] is True
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/products", json={"name": f"Future {tag}", "code": f"X{tag[:6]}"}
    )
    assert created.status_code == 200, created.text
    assert created.json()["targetMeasurement"] == "count"
    configured = await authed.put(
        f"/api/v1/products/{created.json()['id']}/field-rules",
        json={"target_measurement": "amount", "requested_amount_required": True},
    )
    assert configured.status_code == 200, configured.text
    assert configured.json()["targetMeasurement"] == "amount"
    assert configured.json()["requestedAmountRequired"] is True
    unchanged_flag = await authed.put(
        f"/api/v1/products/{created.json()['id']}/field-rules",
        json={"requested_amount_required": False},
    )
    assert unchanged_flag.json()["targetMeasurement"] == "amount"
    assert unchanged_flag.json()["requestedAmountRequired"] is False


@pytest.mark.asyncio
async def test_catalog_seed_does_not_overwrite_configured_state(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    products = {
        item["code"]: item for item in (await authed.get("/api/v1/products")).json()["items"]
    }
    changed = await authed.put(
        f"/api/v1/products/{products['PF']['id']}/field-rules",
        json={"booked_amount_required": True, "target_measurement": "count"},
    )
    assert changed.status_code == 200, changed.text
    async with app.state.session_factory() as session:
        await seed_catalog(session)
        await session.commit()
    after = {
        item["code"]: item for item in (await authed.get("/api/v1/products")).json()["items"]
    }
    assert after["PF"]["bookedAmountRequired"] is True
    assert after["PF"]["targetMeasurement"] == "count"
    restore = await authed.put(
        f"/api/v1/products/{products['PF']['id']}/field-rules",
        json={"booked_amount_required": False, "target_measurement": "amount"},
    )
    assert restore.status_code == 200, restore.text


@pytest.mark.asyncio
async def test_active_kpi_weight_invariant_on_mutation(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    created = await authed.post(
        "/api/v1/targets/kpi",
        json={
            "name": f"Active {unique_tag()[:6]}",
            "metrics": [
                {
                    "metric_code": "target_achievement",
                    "weight_percent": "60",
                    "direction": "higher_is_better",
                    "baseline": "100",
                },
                {
                    "metric_code": "attendance_score",
                    "weight_percent": "40",
                    "direction": "higher_is_better",
                    "baseline": "90",
                },
            ],
        },
    )
    assert created.status_code == 200, created.text
    activated = await authed.post(f"/api/v1/targets/kpi/{created.json()['id']}/activate")
    assert activated.status_code == 200, activated.text
    broken = await authed.patch(
        f"/api/v1/targets/kpi/{created.json()['id']}",
        json={
            "metrics": [
                {
                    "metric_code": "target_achievement",
                    "weight_percent": "50",
                    "direction": "higher_is_better",
                    "baseline": "100",
                }
            ]
        },
    )
    assert broken.status_code == 422
    assert broken.json()["error"]["code"] == "KPI_WEIGHT_INVALID"
    missing = await authed.patch(
        f"/api/v1/targets/kpi/{created.json()['id']}",
        json={
            "metrics": [
                {
                    "metric_code": "target_achievement",
                    "weight_percent": "100",
                    "direction": "higher_is_better",
                }
            ]
        },
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "KPI_BASELINE_REQUIRED"
    current = await authed.get(f"/api/v1/targets/kpi/{created.json()['id']}")
    assert current.json()["status"] == "active"
    assert current.json()["weightTotal"] == "100.00"


@pytest.mark.asyncio
async def test_kpi_activation_rejects_unconfigured_baseline(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    draft = await authed.post(
        "/api/v1/targets/kpi",
        json={
            "name": f"NoBase {unique_tag()[:6]}",
            "metrics": [
                {
                    "metric_code": "submitted_to_final_rejected",
                    "weight_percent": "100",
                    "direction": "lower_is_better",
                }
            ],
        },
    )
    assert draft.status_code == 200, draft.text
    rejected = await authed.post(f"/api/v1/targets/kpi/{draft.json()['id']}/activate")
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "KPI_BASELINE_REQUIRED"


@pytest.mark.asyncio
async def test_workflow_in_use_is_immutable_and_new_version_is_explicit(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "WfLock")
    app = await _create_app(
        authed, customer_id=customer["id"], bank_id=dib["id"], product_id=pf["id"], case_owner_id=owner["id"]
    )
    original = (await authed.get(f"/api/v1/workflows/{app['workflowId']}")).json()
    mutated = await authed.post(
        f"/api/v1/workflows/{original['id']}/stages",
        json={"name": "Extra Stage", "code": "EXTRA", "sort_order": 99},
    )
    assert mutated.status_code == 409
    assert mutated.json()["error"]["code"] == "WORKFLOW_VERSION_IN_USE"
    versioned = await authed.post(
        "/api/v1/workflows", json={"bank_id": dib["id"], "product_id": pf["id"]}
    )
    assert versioned.status_code == 200, versioned.text
    extra = await authed.post(
        f"/api/v1/workflows/{versioned.json()['id']}/stages",
        json={"name": "Review", "code": f"RV{unique_tag()[:6]}", "sort_order": 15},
    )
    assert extra.status_code == 200, extra.text
    stayed = (await authed.get(f"/api/v1/applications/{app['id']}")).json()
    assert stayed["workflowId"] == original["id"]
    assert stayed["workflowVersion"] == original["version"]
    target = next(
        stage for stage in versioned.json()["stages"] if stage["systemKey"] == "application_created"
    )
    migrated = await authed.post(
        f"/api/v1/applications/{app['id']}/migrate",
        json={
            "workflow_id": versioned.json()["id"],
            "target_stage_id": target["id"],
            "reason": "Controlled migration",
        },
    )
    assert migrated.status_code == 200, migrated.text
    assert migrated.json()["workflowId"] == versioned.json()["id"]


@pytest.mark.asyncio
async def test_dashboard_targets_are_complete_and_preview_is_ui_only(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, eib, pf, cc = await _catalog(authed)
    n = int(unique_tag()[:6], 16)
    month_date = date(2031 + (n // 12) % 40, (n % 12) + 1, 1)
    month = month_date.isoformat()
    combos = [
        (pf["id"], None, "submitted"),
        (pf["id"], None, "approved"),
        (pf["id"], None, "booked"),
        (pf["id"], None, "funded"),
        (cc["id"], None, "submitted"),
        (cc["id"], None, "approved"),
        (cc["id"], None, "booked"),
        (cc["id"], None, "funded"),
        (pf["id"], dib["id"], "submitted"),
        (pf["id"], eib["id"], "submitted"),
    ]
    created_ids: list[str] = []
    for product_id, bank_id, milestone in combos:
        payload: dict[str, object] = {
            "level": "employee",
            "entity_id": owner["id"],
            "period_month": month,
            "product_id": product_id,
            "milestone": milestone,
            "target_value": "10",
        }
        if bank_id:
            payload["bank_id"] = bank_id
        row = await authed.post("/api/v1/targets", json=payload)
        assert row.status_code == 200, row.text
        created_ids.append(row.json()["id"])
    listed = await authed.get(f"/api/v1/targets?period_month={month}")
    assert listed.status_code == 200, listed.text
    listed_ids = {item["id"] for item in listed.json()["items"]}
    assert set(created_ids) <= listed_ids
    end = month_end(month_date.year, month_date.month)
    dashboard = await authed.get(
        f"/api/v1/reports/dashboard?period=custom&date_from={month}&date_to={end.isoformat()}"
    )
    assert dashboard.status_code == 200, dashboard.text
    summary = dashboard.json()["targetsSummary"]
    assert summary is not None
    assert summary["count"] == len(summary["items"])
    assert len(summary["items"]) >= 10
    dash_ids = [item["id"] for item in summary["items"]]
    assert set(created_ids) <= set(dash_ids)
    again = await authed.get(
        f"/api/v1/reports/dashboard?period=custom&date_from={month}&date_to={end.isoformat()}"
    )
    assert [item["id"] for item in again.json()["targetsSummary"]["items"]] == dash_ids


@pytest.mark.asyncio
async def test_reporting_filters_hide_out_of_scope_stages_and_employees(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    tag = unique_tag().upper()
    created_type = await authed.post(
        "/api/v1/user-types",
        json={"name": f"Rep {tag}", "code": f"R{tag[:8]}"},
    )
    type_id = created_type.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    await authed.put(
        f"/api/v1/user-types/{type_id}/permissions",
        json={"permissions": ["Reports.View", "Dashboard.View", "Applications.View"]},
    )
    await authed.put(
        f"/api/v1/user-types/{type_id}/reporting-scope",
        json={"reporting_visibility_scope": "office"},
    )
    scoped = await create_activated_user(
        authed, user_type_code=created_type.json()["code"], password="UserPass1!", office_id=dxb
    )
    await _enable_case_owner(authed, "SE")
    hidden = await create_activated_user(
        authed, user_type_code="SE", office_id=auh, password="UserPass1!"
    )
    customer = await _customer(authed, "ScopeCust")
    app = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=hidden["id"],
    )
    other = await spawned_client()
    await authenticate(other, scoped["email"], "UserPass1!")
    options = (await other.get("/api/v1/reports/filters")).json()
    employee_ids = {item["id"] for item in options["employees"]}
    assert hidden["id"] not in employee_ids
    assert scoped["id"] in employee_ids
    stage_ids = {item["id"] for item in options["stages"]}
    assert app["currentStageId"] not in stage_ids


@pytest.mark.asyncio
async def test_historical_email_and_employee_code_are_reserved(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    user = await create_activated_user(authed)
    old_email = user["email"]
    old_code = user["employeeCode"]
    tag = unique_tag()
    patched = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"email": f"new-{tag}@example.com", "employee_code": f"EMP-NEW-{tag}"},
    )
    assert patched.status_code == 200, patched.text
    reuse_email = await authed.post(
        "/api/v1/users",
        json={
            "full_name": "Reuse Email",
            "employee_code": f"EMP-RE-{tag}",
            "email": old_email,
            "mobile": "+971500000019",
            "designation_id": await designation_id(authed),
            "employment_status": "Active",
            "joining_date": "2026-03-01",
        },
    )
    assert reuse_email.status_code == 409
    assert reuse_email.json()["error"]["code"] == "EMAIL_DUPLICATE"
    reuse_code = await authed.post(
        "/api/v1/users",
        json={
            "full_name": "Reuse Code",
            "employee_code": old_code,
            "email": f"reuse-code-{tag}@example.com",
            "mobile": "+971500000018",
            "designation_id": await designation_id(authed),
            "employment_status": "Active",
            "joining_date": "2026-03-01",
        },
    )
    assert reuse_code.status_code == 409
    assert reuse_code.json()["error"]["code"] == "EMPLOYEE_CODE_DUPLICATE"
    async with app.state.session_factory() as session:
        reserved_email = await session.get(ReservedEmail, old_email.lower())
        reserved_code = await session.get(ReservedEmployeeCode, old_code)
        assert reserved_email is not None
        assert reserved_code is not None
        with pytest.raises(IntegrityError):
            await session.execute(
                insert(ReservedEmail).values(
                    email_normalized=old_email.lower(), user_id=uuid4()
                )
            )
            await session.flush()
        await session.rollback()


@pytest.mark.asyncio
async def test_owner_singleton_prevents_second_owner_row(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    status = await client.get("/api/v1/auth/bootstrap-status")
    assert status.json()["available"] is False
    second = await client.post(
        "/api/v1/auth/bootstrap",
        json={
            "secret": "nexa-test-bootstrap-secret",
            "full_name": "Second Owner",
            "employee_code": "EMP-OWNER-2",
            "email": "owner2@example.com",
            "mobile": "+971500000001",
            "joining_date": "2026-01-01",
            "employment_status": "Active",
            "password": "OwnerPass1!",
            "designation_name": "Owner",
            "designation_code": "OWN2",
        },
    )
    assert second.status_code == 409
    async with app.state.session_factory() as session:
        row = (await session.execute(select(OwnerSingleton))).scalar_one()
        assert str(row.user_id) == owner["id"]
        with pytest.raises(IntegrityError):
            await session.execute(
                insert(OwnerSingleton).values(slot=1, user_id=UUID(owner["id"]))
            )
            await session.flush()
        await session.rollback()


@pytest.mark.asyncio
async def test_mfa_off_unchanged_and_enabled_user_cannot_bypass(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    user = await create_activated_user(authed, password="UserPass1!")
    guest = await spawned_client()
    off_login = await guest.post(
        "/api/v1/auth/login", json={"email": user["email"], "password": "UserPass1!"}
    )
    assert off_login.status_code == 200
    assert off_login.json()["mfaRequired"] is False
    assert off_login.json()["csrfToken"]
    other = await spawned_client()
    await authenticate(other, user["email"], "UserPass1!")
    setup = await other.post("/api/v1/auth/mfa/setup")
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    confirm = await other.post(
        "/api/v1/auth/mfa/confirm", json={"code": pyotp.TOTP(secret).now()}
    )
    assert confirm.status_code == 200, confirm.text
    challenger = await spawned_client()
    challenge = await challenger.post(
        "/api/v1/auth/login", json={"email": user["email"], "password": "UserPass1!"}
    )
    assert challenge.status_code == 200
    body = challenge.json()
    assert body["mfaRequired"] is True
    assert body.get("csrfToken") is None
    assert "nexa_session" not in challenge.cookies
    bypass = await challenger.get("/api/v1/auth/me")
    assert bypass.status_code == 401
    invalid = await challenger.post(
        "/api/v1/auth/mfa/login",
        json={"token": body["mfaToken"], "code": "000000"},
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "MFA_INVALID"
    completed = await challenger.post(
        "/api/v1/auth/mfa/login",
        json={"token": body["mfaToken"], "code": pyotp.TOTP(secret).now()},
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["mfaRequired"] is False
    assert completed.json()["csrfToken"]
    challenger.headers["X-CSRF-Token"] = completed.json()["csrfToken"]
    me = await challenger.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]


@pytest.mark.asyncio
async def test_0011_deactivates_active_scorecard_missing_required_baseline(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    tag = unique_tag()
    scorecard_id = uuid4()
    metric_id = uuid4()
    async with app.state.session_factory() as session:
        await session.execute(text("UPDATE kpi_scorecards SET status = 'inactive' WHERE status = 'active'"))
        session.add(
            KpiScorecard(
                id=scorecard_id,
                name=f"Legacy Lower {tag}",
                status=KPI_STATUS_ACTIVE,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
                created_by_id=UUID(owner["id"]),
                updated_by_id=UUID(owner["id"]),
            )
        )
        session.add(
            KpiScorecardMetric(
                id=metric_id,
                scorecard_id=scorecard_id,
                metric_code="submitted_to_final_rejected",
                weight_percent=Decimal("100.00"),
                direction=DIRECTION_LOWER,
                baseline=None,
                sort_order=0,
            )
        )
        await session.commit()
    async with app.state.session_factory() as session:
        await session.execute(text(DEACTIVATE_ACTIVE_MISSING_BASELINE_SQL))
        await session.commit()
    current = await authed.get(f"/api/v1/targets/kpi/{scorecard_id}")
    assert current.status_code == 200, current.text
    body = current.json()
    assert body["status"] == KPI_STATUS_INACTIVE
    assert body["metrics"][0]["baseline"] is None
    patched = await authed.patch(
        f"/api/v1/targets/kpi/{scorecard_id}",
        json={
            "metrics": [
                {
                    "metric_code": "submitted_to_final_rejected",
                    "weight_percent": "100",
                    "direction": "lower_is_better",
                    "baseline": "8",
                }
            ]
        },
    )
    assert patched.status_code == 200, patched.text
    activated = await authed.post(f"/api/v1/targets/kpi/{scorecard_id}/activate")
    assert activated.status_code == 200, activated.text
    assert activated.json()["status"] == KPI_STATUS_ACTIVE
    assert activated.json()["metrics"][0]["baseline"] == "8.00"


@pytest.mark.asyncio
async def test_concurrent_duplicate_email_returns_controlled_conflict(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag()
    email = f"race-email-{tag}@example.com"
    designation = await designation_id(authed)

    async def create(code_suffix: str) -> object:
        return await authed.post(
            "/api/v1/users",
            json={
                "full_name": f"Race Email {code_suffix}",
                "employee_code": f"EMP-RE{tag}{code_suffix}",
                "email": email,
                "mobile": "+971500000021",
                "designation_id": designation,
                "employment_status": "Active",
                "joining_date": "2026-03-01",
            },
        )

    first, second = await asyncio.gather(create("A"), create("B"))
    statuses = sorted([first.status_code, second.status_code])
    assert 500 not in {first.status_code, second.status_code}
    assert statuses == [200, 409]
    loser = first if first.status_code == 409 else second
    assert loser.json()["error"]["code"] == "EMAIL_DUPLICATE"
    listed = (await authed.get("/api/v1/users")).json()["items"]
    assert sum(1 for item in listed if item["email"] == email) == 1


@pytest.mark.asyncio
async def test_concurrent_duplicate_employee_code_returns_controlled_conflict(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag()
    employee_code = f"EMP-RC{tag}"
    designation = await designation_id(authed)

    async def create(email_suffix: str) -> object:
        return await authed.post(
            "/api/v1/users",
            json={
                "full_name": f"Race Code {email_suffix}",
                "employee_code": employee_code,
                "email": f"race-code-{tag}-{email_suffix}@example.com",
                "mobile": "+971500000022",
                "designation_id": designation,
                "employment_status": "Active",
                "joining_date": "2026-03-01",
            },
        )

    first, second = await asyncio.gather(create("a"), create("b"))
    statuses = sorted([first.status_code, second.status_code])
    assert 500 not in {first.status_code, second.status_code}
    assert statuses == [200, 409]
    loser = first if first.status_code == 409 else second
    assert loser.json()["error"]["code"] == "EMPLOYEE_CODE_DUPLICATE"
    listed = (await authed.get("/api/v1/users")).json()["items"]
    assert sum(1 for item in listed if item["employeeCode"] == employee_code) == 1


async def _enable_mfa(client: AsyncClient, email: str, password: str) -> str:
    session = await spawned_client()
    await authenticate(session, email, password)
    setup = await session.post("/api/v1/auth/mfa/setup")
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    confirm = await session.post("/api/v1/auth/mfa/confirm", json={"code": pyotp.TOTP(secret).now()})
    assert confirm.status_code == 200, confirm.text
    return secret


@pytest.mark.asyncio
async def test_mfa_completion_rejected_when_user_deactivated_mid_challenge(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    user = await create_activated_user(authed, password="UserPass1!")
    secret = await _enable_mfa(authed, user["email"], "UserPass1!")
    challenger = await spawned_client()
    challenge = await challenger.post(
        "/api/v1/auth/login", json={"email": user["email"], "password": "UserPass1!"}
    )
    assert challenge.status_code == 200
    token = challenge.json()["mfaToken"]
    deactivated = await authed.post(f"/api/v1/users/{user['id']}/deactivate")
    assert deactivated.status_code == 200, deactivated.text
    completed = await challenger.post(
        "/api/v1/auth/mfa/login",
        json={"token": token, "code": pyotp.TOTP(secret).now()},
    )
    assert completed.status_code == 401
    assert completed.json()["error"]["code"] == "AUTH_FAILED"
    assert "nexa_session" not in completed.cookies
    me = await challenger.get("/api/v1/auth/me")
    assert me.status_code == 401


@pytest.mark.asyncio
async def test_mfa_completion_rejected_when_user_type_deactivated_mid_challenge(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag().upper()
    created_type = await authed.post(
        "/api/v1/user-types", json={"name": f"MFA {tag}", "code": f"M{tag[:8]}"}
    )
    type_id = created_type.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    user = await create_activated_user(
        authed, user_type_code=created_type.json()["code"], password="UserPass1!"
    )
    secret = await _enable_mfa(authed, user["email"], "UserPass1!")
    challenger = await spawned_client()
    challenge = await challenger.post(
        "/api/v1/auth/login", json={"email": user["email"], "password": "UserPass1!"}
    )
    assert challenge.status_code == 200
    token = challenge.json()["mfaToken"]
    deactivated = await authed.post(f"/api/v1/user-types/{type_id}/deactivate")
    assert deactivated.status_code == 200, deactivated.text
    completed = await challenger.post(
        "/api/v1/auth/mfa/login",
        json={"token": token, "code": pyotp.TOTP(secret).now()},
    )
    assert completed.status_code == 403
    assert completed.json()["error"]["code"] == "USER_TYPE_INACTIVE"
    assert "nexa_session" not in completed.cookies
    me = await challenger.get("/api/v1/auth/me")
    assert me.status_code == 401
