from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from helpers import (
    authenticate,
    create_activated_user,
    office_id,
    owner_client,
    spawned_client,
    unique_tag,
)
from nexa_bos_api.identity.models import AuditEvent
from nexa_bos_api.main import app
from nexa_bos_api.targets.calc import (
    achievement_pct,
    daily_run_rate,
    directed_achievement,
    gap_value,
    prorate_target,
    working_dates,
)


def unique_month() -> str:
    n = int(unique_tag()[:6], 16)
    return date(2031 + (n // 12) % 40, (n % 12) + 1, 1).isoformat()


async def _catalog(client: AsyncClient) -> tuple[dict, dict, dict, dict]:
    banks = {item["code"]: item for item in (await client.get("/api/v1/banks")).json()["items"]}
    products = {
        item["code"]: item for item in (await client.get("/api/v1/products")).json()["items"]
    }
    return banks["DIB"], banks["EIB"], products["PF"], products["CC"]


async def _customer(client: AsyncClient, name: str) -> dict:
    response = await client.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": f"{name} {unique_tag()}",
            "mobile": f"+97150{unique_tag()[:8]}",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


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


async def _create_app(
    client: AsyncClient,
    *,
    customer_id: str,
    bank_id: str,
    product_id: str,
    case_owner_id: str,
    requested_amount: str | None = "10000",
) -> dict:
    payload: dict[str, object] = {
        "customer_id": customer_id,
        "bank_id": bank_id,
        "product_id": product_id,
        "case_owner_id": case_owner_id,
        "requested_amount": requested_amount,
    }
    await _enable_case_owner(client)
    await _ensure_workflow(client, bank_id, product_id)
    response = await client.post("/api/v1/applications", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


async def _stage(client: AsyncClient, workflow_id: str, key: str) -> dict:
    workflow = (await client.get(f"/api/v1/workflows/{workflow_id}")).json()
    return next(item for item in workflow["stages"] if item["systemKey"] == key)


async def _submit(client: AsyncClient, app: dict) -> dict:
    response = await client.post(
        f"/api/v1/applications/{app['id']}/case-number",
        json={"bank_case_number": f"TGT-{unique_tag()[:8]}"},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _advance(client: AsyncClient, app: dict, key: str, extra: dict | None = None) -> dict:
    stage = await _stage(client, app["workflowId"], key)
    payload = {"stage_id": stage["id"], "bank_stage_date": date.today().isoformat(), **(extra or {})}
    response = await client.post(f"/api/v1/applications/{app['id']}/stage", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


async def _scoped_user(
    authed: AsyncClient,
    *,
    permissions: list[str],
    reporting_scope: str | None = "office",
    office_id: str | None = None,
    password: str = "UserPass1!",
) -> dict:
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/user-types",
        json={"name": f"TGT {tag}", "code": f"T{tag[:8]}"},
    )
    assert created.status_code == 200, created.text
    type_id = created.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    await authed.put(
        f"/api/v1/user-types/{type_id}/permissions",
        json={"permissions": permissions},
    )
    await authed.put(
        f"/api/v1/user-types/{type_id}/reporting-scope",
        json={"reporting_visibility_scope": reporting_scope},
    )
    return await create_activated_user(
        authed,
        user_type_code=created.json()["code"],
        password=password,
        office_id=office_id,
    )


async def _team(authed: AsyncClient, office: str) -> dict:
    tag = unique_tag().upper()[:6]
    dept = await authed.post(
        "/api/v1/departments",
        json={"name": f"Dept {tag}", "code": f"D{tag}", "office_id": office},
    )
    assert dept.status_code == 200, dept.text
    team = await authed.post(
        "/api/v1/teams",
        json={
            "office_id": office,
            "department_id": dept.json()["id"],
            "name": f"Team {tag}",
            "code": f"TM{tag}",
        },
    )
    assert team.status_code == 200, team.text
    return team.json()


def test_calc_safe_zero_and_working_days() -> None:
    assert achievement_pct(Decimal("50"), Decimal("100")) == 50.0
    assert achievement_pct(Decimal("10"), Decimal("0")) is None
    assert gap_value(Decimal("120"), Decimal("100")) == Decimal("-20.00")
    assert daily_run_rate(Decimal("100"), 0) is None
    assert daily_run_rate(Decimal("0"), 5) == Decimal("0.00")
    assert daily_run_rate(Decimal("10"), 4) == Decimal("2.50")
    assert prorate_target(Decimal("100"), prorate=False, elapsed_working_days=2, month_working_days=4) == Decimal(
        "100.00"
    )
    assert prorate_target(Decimal("100"), prorate=True, elapsed_working_days=2, month_working_days=4) == Decimal(
        "50.00"
    )
    assert directed_achievement(Decimal("0"), Decimal("0"), "lower_is_better") == 100.0
    assert directed_achievement(Decimal("10"), Decimal("0"), "lower_is_better") == 0.0
    days = working_dates(date(2026, 8, 29), date(2026, 8, 31), {0, 1, 2, 3, 4}, {date(2026, 8, 31)})
    assert days == []


@pytest.mark.asyncio
async def test_target_permissions_enforced(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    viewer = await _scoped_user(authed, permissions=["Targets.View"], office_id=dxb)
    denied = await _scoped_user(authed, permissions=["Users.View"], office_id=dxb)
    viewer_client = await spawned_client()
    await authenticate(viewer_client, viewer["email"], "UserPass1!")
    denied_client = await spawned_client()
    await authenticate(denied_client, denied["email"], "UserPass1!")
    assert (await denied_client.get("/api/v1/targets")).status_code == 403
    listed = await viewer_client.get("/api/v1/targets")
    assert listed.status_code == 200, listed.text
    create = await viewer_client.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": viewer["id"],
            "period_month": "2026-08-01",
            "product_id": (await _catalog(authed))[2]["id"],
            "milestone": "submitted",
            "target_value": "100",
        },
    )
    assert create.status_code == 403


@pytest.mark.asyncio
async def test_employee_team_office_duplicate_and_employment_block(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    dib, _eib, pf, _cc = await _catalog(authed)
    team = await _team(authed, dxb)
    employee = await create_activated_user(
        authed, office_id=dxb, department_id=team["departmentId"], team_id=team["id"]
    )
    month = unique_month()
    emp = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": employee["id"],
            "period_month": month,
            "product_id": pf["id"],
            "milestone": "submitted",
            "measurement": "amount",
            "target_value": "10000",
            "prorate": False,
        },
    )
    assert emp.status_code == 200, emp.text
    dup = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": employee["id"],
            "period_month": month,
            "product_id": pf["id"],
            "milestone": "submitted",
            "target_value": "1",
        },
    )
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "TARGET_DUPLICATE"
    team_row = await authed.post(
        "/api/v1/targets",
        json={
            "level": "team",
            "entity_id": team["id"],
            "period_month": month,
            "product_id": pf["id"],
            "milestone": "submitted",
            "target_value": "50000",
        },
    )
    assert team_row.status_code == 200, team_row.text
    office_row = await authed.post(
        "/api/v1/targets",
        json={
            "level": "office",
            "entity_id": dxb,
            "period_month": month,
            "product_id": pf["id"],
            "milestone": "submitted",
            "target_value": "100000",
        },
    )
    assert office_row.status_code == 200, office_row.text
    assert emp.json()["result"]["target"] != team_row.json()["result"]["target"]
    resigned = await create_activated_user(authed, office_id=dxb)
    await authed.patch(
        f"/api/v1/users/{resigned['id']}",
        json={"employment_status": "Resigned", "last_working_date": "2026-08-01"},
    )
    blocked = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": resigned["id"],
            "period_month": month,
            "product_id": pf["id"],
            "milestone": "approved",
            "target_value": "10",
        },
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "EMPLOYMENT_STATUS_BLOCKED"
    listed = await authed.get(f"/api/v1/targets?entity_id={employee['id']}")
    assert listed.status_code == 200
    assert any(item["id"] == emp.json()["id"] for item in listed.json()["items"])
    _ = owner


@pytest.mark.asyncio
async def test_milestones_pf_cc_bank_attribution_and_results(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    dib, eib, pf, cc = await _catalog(authed)
    first = await create_activated_user(authed, office_id=dxb)
    second = await create_activated_user(authed, office_id=dxb)
    await _enable_case_owner(authed, "SE")
    month = date.today().replace(day=1).isoformat()
    overall = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": first["id"],
            "period_month": month,
            "product_id": pf["id"],
            "milestone": "funded",
            "measurement": "amount",
            "target_value": "20000",
        },
    )
    assert overall.status_code == 200, overall.text
    bank_tgt = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": first["id"],
            "period_month": month,
            "product_id": pf["id"],
            "bank_id": dib["id"],
            "milestone": "funded",
            "measurement": "amount",
            "target_value": "8000",
        },
    )
    assert bank_tgt.status_code == 200, bank_tgt.text
    cc_tgt = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": first["id"],
            "period_month": month,
            "product_id": cc["id"],
            "milestone": "submitted",
            "measurement": "count",
            "target_value": "2",
        },
    )
    assert cc_tgt.status_code == 200, cc_tgt.text
    customer = await _customer(authed, "Tgt")
    dib_app = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=first["id"],
        requested_amount="5000",
    )
    await _submit(authed, dib_app)
    await _advance(authed, dib_app, "approved", {"approved_amount": "5000"})
    await _advance(authed, dib_app, "booked", {"booked_amount": "5000"})
    await _advance(authed, dib_app, "fund_released", {"funded_amount": "5000"})
    eib_app = await _create_app(
        authed,
        customer_id=(await _customer(authed, "Eib")).get("id"),
        bank_id=eib["id"],
        product_id=pf["id"],
        case_owner_id=first["id"],
        requested_amount="3000",
    )
    await _submit(authed, eib_app)
    await _advance(authed, eib_app, "approved", {"approved_amount": "3000"})
    await _advance(authed, eib_app, "booked", {"booked_amount": "3000"})
    await _advance(authed, eib_app, "fund_released", {"funded_amount": "3000"})
    cc_app = await _create_app(
        authed,
        customer_id=(await _customer(authed, "Cc")).get("id"),
        bank_id=dib["id"],
        product_id=cc["id"],
        case_owner_id=first["id"],
        requested_amount=None,
    )
    await _submit(authed, cc_app)
    overall_r = (await authed.get(f"/api/v1/targets/{overall.json()['id']}")).json()
    bank_r = (await authed.get(f"/api/v1/targets/{bank_tgt.json()['id']}")).json()
    cc_r = (await authed.get(f"/api/v1/targets/{cc_tgt.json()['id']}")).json()
    assert overall_r["result"]["actual"] == "8000.00"
    assert bank_r["result"]["actual"] == "5000.00"
    assert overall_r["result"]["actual"] != str(
        Decimal(bank_r["result"]["actual"]) + Decimal(bank_r["result"]["actual"])
    )
    assert cc_r["result"]["actual"] == "1.00"
    assert cc_r["measurement"] == "count"
    assert overall_r["result"]["achievementPct"] == 40.0
    assert overall_r["result"]["gap"] == "12000.00"
    zero = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": second["id"],
            "period_month": month,
            "product_id": pf["id"],
            "milestone": "submitted",
            "target_value": "0",
        },
    )
    assert zero.json()["result"]["achievementPct"] is None
    assert zero.json()["result"]["gap"] == "0.00"
    moved = await _create_app(
        authed,
        customer_id=(await _customer(authed, "Move")).get("id"),
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=first["id"],
        requested_amount="1000",
    )
    await _submit(authed, moved)
    submitted_tgt = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": first["id"],
            "period_month": month,
            "product_id": pf["id"],
            "milestone": "submitted",
            "measurement": "count",
            "target_value": "10",
        },
    )
    approved_first = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": first["id"],
            "period_month": month,
            "product_id": pf["id"],
            "milestone": "approved",
            "measurement": "count",
            "target_value": "10",
        },
    )
    approved_second = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": second["id"],
            "period_month": month,
            "product_id": pf["id"],
            "milestone": "approved",
            "measurement": "count",
            "target_value": "10",
        },
    )
    await authed.post(
        f"/api/v1/applications/{moved['id']}/reassign-owner",
        json={"case_owner_id": second["id"], "reason": "Coverage"},
    )
    await _advance(authed, moved, "approved", {"approved_amount": "1000"})
    first_sub = (await authed.get(f"/api/v1/targets/{submitted_tgt.json()['id']}")).json()
    first_appr = (await authed.get(f"/api/v1/targets/{approved_first.json()['id']}")).json()
    second_appr = (await authed.get(f"/api/v1/targets/{approved_second.json()['id']}")).json()
    assert Decimal(first_sub["result"]["actual"]) >= 1
    assert Decimal(second_appr["result"]["actual"]) >= 1
    assert Decimal(first_appr["result"]["actual"]) >= 2
    dashboard = await authed.get("/api/v1/reports/dashboard?period=mtd")
    assert dashboard.status_code == 200
    kpis = dashboard.json()["kpis"]
    assert "submitted" in kpis
    assert dashboard.json().get("targetsSummary") is not None
    _ = owner


@pytest.mark.asyncio
async def test_period_aggregation_prorate_run_rate_lock_kpi_profile_scope(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    _dib, _eib, pf, _cc = await _catalog(authed)
    employee = await create_activated_user(authed, office_id=dxb)
    await authed.put("/api/v1/attendance/working-days", json={"weekdays": [0, 1, 2, 3, 4]})
    today = date.today()
    month = today.replace(day=1)
    july = date(today.year, 7, 1) if today.month >= 7 else date(today.year, 1, 1)
    july_row = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": employee["id"],
            "period_month": july.isoformat(),
            "product_id": pf["id"],
            "milestone": "submitted",
            "measurement": "count",
            "target_value": "10",
            "prorate": False,
        },
    )
    assert july_row.status_code == 200, july_row.text
    current = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": employee["id"],
            "period_month": month.isoformat(),
            "product_id": pf["id"],
            "milestone": "submitted",
            "measurement": "count",
            "target_value": "10",
            "prorate": True,
        },
    )
    assert current.status_code == 200, current.text
    full = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": employee["id"],
            "period_month": month.isoformat(),
            "product_id": pf["id"],
            "milestone": "booked",
            "measurement": "count",
            "target_value": "10",
            "prorate": False,
        },
    )
    assert full.status_code == 200, full.text
    qtd = (await authed.get(f"/api/v1/targets/{july_row.json()['id']}?period=qtd")).json()
    hy = (await authed.get(f"/api/v1/targets/{july_row.json()['id']}?period=half_year")).json()
    ytd = (await authed.get(f"/api/v1/targets/{july_row.json()['id']}?period=ytd")).json()
    assert Decimal(qtd["result"]["target"]) >= 10
    assert Decimal(hy["result"]["target"]) >= 10
    assert Decimal(ytd["result"]["target"]) >= 10
    prorated = current.json()["result"]
    unprorated = full.json()["result"]
    assert prorated["prorate"] is True
    assert unprorated["prorate"] is False
    assert unprorated["effectiveTarget"] == "10.00"
    holiday_date = date(today.year, today.month, today.day)
    if holiday_date.weekday() >= 5:
        holiday_date = date(today.year, today.month, 31 if today.month == 8 else today.day)
    holiday_resp = await authed.post(
        "/api/v1/attendance/holidays",
        json={"holiday_date": holiday_date.isoformat(), "name": f"Tgt Hol {unique_tag()[:6]}"},
    )
    assert holiday_resp.status_code in {200, 409}
    refreshed = (await authed.get(f"/api/v1/targets/{full.json()['id']}")).json()
    assert "dailyRequiredRunRate" in refreshed["result"]
    if refreshed["result"]["remainingWorkingDays"] == 0:
        assert refreshed["result"]["dailyRequiredRunRate"] is None
    missing = await authed.patch(
        f"/api/v1/targets/{full.json()['id']}",
        json={"target_value": "12", "reason": ""},
    )
    assert missing.status_code == 422
    edited = await authed.patch(
        f"/api/v1/targets/{full.json()['id']}",
        json={"target_value": "12", "reason": "Market change"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["history"]
    assert edited.json()["history"][0]["reason"] == "Market change"
    lock = await authed.post(f"/api/v1/targets/periods/{month.isoformat()}/lock")
    assert lock.status_code == 200, lock.text
    blocked_edit = await authed.patch(
        f"/api/v1/targets/{full.json()['id']}",
        json={"target_value": "15", "reason": "Too late"},
    )
    assert blocked_edit.status_code == 409
    silent = await authed.post(f"/api/v1/targets/periods/{month.isoformat()}/reopen", json={"reason": ""})
    assert silent.status_code == 422
    reopened = await authed.post(
        f"/api/v1/targets/periods/{month.isoformat()}/reopen",
        json={"reason": "Correction window"},
    )
    assert reopened.status_code == 200, reopened.text
    after = await authed.patch(
        f"/api/v1/targets/{full.json()['id']}",
        json={"target_value": "11", "reason": "After reopen"},
    )
    assert after.status_code == 200, after.text
    draft = await authed.post(
        "/api/v1/targets/kpi",
        json={
            "name": f"Card {unique_tag()[:6]}",
            "metrics": [
                {
                    "metric_code": "target_achievement",
                    "weight_percent": "40",
                    "direction": "higher_is_better",
                },
                {
                    "metric_code": "funded_count",
                    "weight_percent": "40",
                    "direction": "higher_is_better",
                },
            ],
        },
    )
    assert draft.status_code == 200, draft.text
    assert draft.json()["weightValid"] is False
    rejected = await authed.post(f"/api/v1/targets/kpi/{draft.json()['id']}/activate")
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "KPI_WEIGHT_INVALID"
    updated = await authed.patch(
        f"/api/v1/targets/kpi/{draft.json()['id']}",
        json={
            "metrics": [
                {
                    "metric_code": "target_achievement",
                    "weight_percent": "40",
                    "direction": "higher_is_better",
                },
                {
                    "metric_code": "funded_count",
                    "weight_percent": "40",
                    "direction": "higher_is_better",
                },
                {
                    "metric_code": "attendance_score",
                    "weight_percent": "20",
                    "direction": "higher_is_better",
                },
            ]
        },
    )
    assert updated.status_code == 200, updated.text
    activated = await authed.post(f"/api/v1/targets/kpi/{draft.json()['id']}/activate")
    assert activated.status_code == 200, activated.text
    lower = await authed.post(
        "/api/v1/targets/kpi",
        json={
            "name": f"Lower {unique_tag()[:6]}",
            "metrics": [
                {
                    "metric_code": "submitted_to_final_rejected",
                    "weight_percent": "100",
                    "direction": "lower_is_better",
                }
            ],
        },
    )
    assert lower.status_code == 200, lower.text
    profile = await authed.get(f"/api/v1/reports/employees/{employee['id']}?period=mtd")
    assert profile.status_code == 200, profile.text
    body = profile.json()
    assert "kpis" in body
    assert "submitted" in body["kpis"]
    assert body["targetsKpi"] is not None
    assert any(item["milestone"] == "submitted" for item in body["targetsKpi"]["targets"])
    assert body["targetsKpi"]["kpi"] is not None
    assert any(row["metric"] == "attendance_score" for row in body["targetsKpi"]["kpi"]["components"])
    dashboard = await authed.get("/api/v1/reports/dashboard?period=mtd")
    assert dashboard.status_code == 200, dashboard.text
    dash_kpis = dashboard.json()["kpis"]
    assert "submitted" in dash_kpis
    assert "approved" in dash_kpis
    assert "booked" in dash_kpis
    assert "funded" in dash_kpis
    assert isinstance(dash_kpis["submitted"]["count"], int)
    assert isinstance(body["kpis"]["submitted"]["count"], int)
    outsider = await _scoped_user(
        authed,
        permissions=["Targets.View", "Reports.View", "Dashboard.View"],
        reporting_scope="office",
        office_id=auh,
    )
    other = await spawned_client()
    await authenticate(other, outsider["email"], "UserPass1!")
    leaked = await other.get("/api/v1/targets")
    assert leaked.status_code == 200
    assert all(item["entityId"] != employee["id"] for item in leaked.json()["items"])
    hidden = await other.get(f"/api/v1/targets/{current.json()['id']}")
    assert hidden.status_code == 404
    hidden_profile = await other.get(f"/api/v1/reports/employees/{employee['id']}?period=mtd")
    assert hidden_profile.status_code == 404
    async with app.state.session_factory() as session:
        actions = {
            row[0]
            for row in (
                await session.execute(
                    select(AuditEvent.action).where(AuditEvent.actor_id == UUID(owner["id"]))
                )
            ).all()
        }
    assert "target.create" in actions
    assert "target.edit" in actions
    assert "target.period_lock" in actions
    assert "target.period_reopen" in actions
    assert "kpi.scorecard_create" in actions
    assert "kpi.scorecard_activate" in actions
