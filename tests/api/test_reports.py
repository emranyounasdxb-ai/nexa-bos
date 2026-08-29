from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

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
from test_applications import _catalog, _create_app, _customer, _stage_by_key
from test_tat_delay import _move


async def _reporting_user(
    authed: AsyncClient,
    *,
    scope: str | None,
    permissions: list[str],
    office_id: str | None = None,
    manager_id: str | None = None,
    password: str = "UserPass1!",
    can_be_case_owner: bool = True,
    can_be_reporting_manager: bool = False,
) -> dict:
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/user-types",
        json={
            "name": f"RPT {tag}",
            "code": f"R{tag[:8]}",
            "can_be_case_owner": can_be_case_owner,
            "can_be_reporting_manager": can_be_reporting_manager,
        },
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
        json={"reporting_visibility_scope": scope},
    )
    return await create_activated_user(
        authed,
        user_type_code=created.json()["code"],
        password=password,
        office_id=office_id,
        manager_id=manager_id,
    )


async def _submit_and_fund(client: AsyncClient, application: dict, amount: str = "8000") -> dict:
    submitted = await client.post(
        f"/api/v1/applications/{application['id']}/case-number",
        json={"bank_case_number": f"RPT-{unique_tag()[:8]}"},
    )
    assert submitted.status_code == 200, submitted.text
    await _move(client, application, "approved", {"approved_amount": amount})
    await _move(client, application, "booked", {"booked_amount": amount})
    return await _move(client, application, "fund_released", {"funded_amount": amount})


VIEW_PERMS = ["Dashboard.View", "Reports.View"]
EXPORT_PERMS = [
    "Dashboard.View",
    "Reports.View",
    "Reports.ExportExcel",
    "Reports.ExportPDF",
    "Reports.Print",
]


@pytest.mark.asyncio
async def test_dashboard_requires_permission(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    user = await _reporting_user(authed, scope="company", permissions=["Users.View"])
    async with await spawned_client() as other:
        await authenticate(other, user["email"], "UserPass1!")
        response = await other.get("/api/v1/reports/dashboard")
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_permission_without_reporting_scope_returns_no_data(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "NoScope")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
        requested_amount="5000",
    )
    await _submit_and_fund(authed, created)
    user = await _reporting_user(authed, scope=None, permissions=VIEW_PERMS)
    async with await spawned_client() as other:
        await authenticate(other, user["email"], "UserPass1!")
        dashboard = await other.get("/api/v1/reports/dashboard")
        assert dashboard.status_code == 200, dashboard.text
        body = dashboard.json()
        assert body["reportingScope"] is None
        assert body["kpis"]["submitted"]["count"] == 0
        assert body["kpis"]["funded"]["count"] == 0
        assert body["rankings"]["employees"] == []
        drill = await other.get("/api/v1/reports/applications?metric=funded")
        assert drill.json()["total"] == 0
        assert drill.json()["items"] == []


@pytest.mark.asyncio
async def test_owner_company_wide_dashboard_and_mtd_default(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "OwnerDash")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
        requested_amount="12000",
    )
    await _submit_and_fund(authed, created, "11000")
    dashboard = await authed.get("/api/v1/reports/dashboard")
    assert dashboard.status_code == 200, dashboard.text
    body = dashboard.json()
    assert body["period"]["key"] == "mtd"
    assert body["reportingScope"] == "Company-wide"
    assert body["currency"] == "AED"
    assert body["kpis"]["submitted"]["count"] >= 1
    assert body["kpis"]["funded"]["count"] >= 1
    assert body["kpis"]["personalFinance"]["count"] >= 1
    assert body["conversions"]["submittedToApproved"] is not None
    drill = await authed.get("/api/v1/reports/applications?metric=funded")
    codes = {item["applicationCode"] for item in drill.json()["items"]}
    assert created["applicationCode"] in codes


@pytest.mark.asyncio
async def test_own_office_team_scopes_and_query_param_cannot_bypass(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    manager = await _reporting_user(
        authed,
        scope="team",
        permissions=VIEW_PERMS,
        office_id=dxb,
        can_be_reporting_manager=True,
    )
    own_user = await _reporting_user(authed, scope="own", permissions=VIEW_PERMS, office_id=dxb)
    office_user = await _reporting_user(
        authed, scope="office", permissions=VIEW_PERMS, office_id=dxb
    )
    report = await _reporting_user(
        authed, scope="team", permissions=VIEW_PERMS, office_id=dxb, manager_id=manager["id"]
    )
    other_office = await _reporting_user(
        authed, scope="own", permissions=VIEW_PERMS, office_id=auh
    )
    own_app = await _create_app(
        authed,
        customer_id=(await _customer(authed, "OwnApp"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=own_user["id"],
        requested_amount="3000",
    )
    await _submit_and_fund(authed, own_app, "3000")
    team_app = await _create_app(
        authed,
        customer_id=(await _customer(authed, "TeamApp"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=report["id"],
        requested_amount="4000",
    )
    await _submit_and_fund(authed, team_app, "4000")
    auh_app = await _create_app(
        authed,
        customer_id=(await _customer(authed, "AuhApp"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=other_office["id"],
        requested_amount="9000",
    )
    await _submit_and_fund(authed, auh_app, "9000")

    async with await spawned_client() as scoped:
        await authenticate(scoped, own_user["email"], "UserPass1!")
        own_dash = (await scoped.get("/api/v1/reports/dashboard")).json()
        assert own_dash["reportingScope"] == "Own Performance"
        own_codes = {
            item["applicationCode"]
            for item in (await scoped.get("/api/v1/reports/applications?metric=funded")).json()[
                "items"
            ]
        }
        assert own_app["applicationCode"] in own_codes
        assert team_app["applicationCode"] not in own_codes
        assert auh_app["applicationCode"] not in own_codes
        bypass = await scoped.get(
            f"/api/v1/reports/dashboard?employee_id={other_office['id']}&reporting_scope=company"
        )
        assert bypass.json()["kpis"]["funded"]["count"] == 0
        profile = await scoped.get(f"/api/v1/reports/employees/{other_office['id']}")
        assert profile.status_code == 404

    async with await spawned_client() as scoped:
        await authenticate(scoped, office_user["email"], "UserPass1!")
        codes = {
            item["applicationCode"]
            for item in (await scoped.get("/api/v1/reports/applications?metric=funded")).json()[
                "items"
            ]
        }
        assert own_app["applicationCode"] in codes
        assert team_app["applicationCode"] in codes
        assert auh_app["applicationCode"] not in codes
        options = (await scoped.get("/api/v1/reports/filters")).json()
        employee_ids = {item["id"] for item in options["employees"]}
        assert other_office["id"] not in employee_ids

    async with await spawned_client() as scoped:
        await authenticate(scoped, manager["email"], "UserPass1!")
        codes = {
            item["applicationCode"]
            for item in (await scoped.get("/api/v1/reports/applications?metric=funded")).json()[
                "items"
            ]
        }
        assert team_app["applicationCode"] in codes
        assert auh_app["applicationCode"] not in codes


@pytest.mark.asyncio
async def test_event_time_attribution_survives_reassignment(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    first = await _reporting_user(authed, scope="own", permissions=VIEW_PERMS)
    second = await _reporting_user(authed, scope="own", permissions=VIEW_PERMS)
    created = await _create_app(
        authed,
        customer_id=(await _customer(authed, "ReassignPerf"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=first["id"],
        requested_amount="7000",
    )
    await authed.post(
        f"/api/v1/applications/{created['id']}/case-number",
        json={"bank_case_number": f"RAS-{unique_tag()[:8]}"},
    )
    await _move(authed, created, "approved", {"approved_amount": "7000"})
    reassigned = await authed.post(
        f"/api/v1/applications/{created['id']}/reassign-owner",
        json={"case_owner_id": second["id"], "reason": "Coverage"},
    )
    assert reassigned.status_code == 200, reassigned.text
    await _move(authed, created, "booked", {"booked_amount": "7000"})
    await _move(authed, created, "fund_released", {"funded_amount": "7000"})

    async with await spawned_client() as scoped:
        await authenticate(scoped, first["email"], "UserPass1!")
        first_dash = (await scoped.get("/api/v1/reports/dashboard")).json()
        assert first_dash["kpis"]["submitted"]["count"] >= 1
        assert first_dash["kpis"]["approved"]["count"] >= 1
        assert first_dash["kpis"]["booked"]["count"] == 0
        assert first_dash["kpis"]["funded"]["count"] == 0
        submitted = (await scoped.get("/api/v1/reports/applications?metric=submitted")).json()
        assert created["applicationCode"] in {item["applicationCode"] for item in submitted["items"]}
        funded = (await scoped.get("/api/v1/reports/applications?metric=funded")).json()
        assert created["applicationCode"] not in {
            item["applicationCode"] for item in funded["items"]
        }

    async with await spawned_client() as scoped:
        await authenticate(scoped, second["email"], "UserPass1!")
        second_dash = (await scoped.get("/api/v1/reports/dashboard")).json()
        assert second_dash["kpis"]["submitted"]["count"] == 0
        assert second_dash["kpis"]["booked"]["count"] >= 1
        assert second_dash["kpis"]["funded"]["count"] >= 1


@pytest.mark.asyncio
async def test_pending_is_current_state_and_can_include_earlier_created(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    pending_app = await _create_app(
        authed,
        customer_id=(await _customer(authed, "PendingOld"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
        requested_amount="2000",
    )
    earlier = date.today().replace(day=1) - timedelta(days=10)
    async with app.state.session_factory() as session:
        await session.execute(
            text("UPDATE applications SET created_at = :created_at WHERE id = :id"),
            {"created_at": datetime.combine(earlier, time.min, tzinfo=UTC), "id": UUID(pending_app["id"])},
        )
        await session.commit()
    dashboard = (await authed.get("/api/v1/reports/dashboard?period=mtd")).json()
    assert dashboard["kpis"]["pending"]["count"] >= 1
    pending = (await authed.get("/api/v1/reports/applications?metric=pending&period=mtd")).json()
    assert pending_app["applicationCode"] in {item["applicationCode"] for item in pending["items"]}
    stages = {row["name"] for row in dashboard["stageBreakdown"]}
    assert stages


@pytest.mark.asyncio
async def test_conversions_rankings_ties_comparisons_custom_and_since_joining(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, eib, pf, cc = await _catalog(authed)
    first = await _reporting_user(authed, scope="company", permissions=VIEW_PERMS)
    second = await _reporting_user(authed, scope="company", permissions=VIEW_PERMS)
    for owner_id, amount in ((first["id"], "5000"), (second["id"], "5000")):
        app = await _create_app(
            authed,
            customer_id=(await _customer(authed, "Tie"))["id"],
            bank_id=dib["id"],
            product_id=pf["id"],
            case_owner_id=owner_id,
            requested_amount=amount,
        )
        await _submit_and_fund(authed, app, amount)
    cc_app = await _create_app(
        authed,
        customer_id=(await _customer(authed, "CCCount"))["id"],
        bank_id=dib["id"],
        product_id=cc["id"],
        case_owner_id=first["id"],
        requested_amount=None,
    )
    await authed.post(
        f"/api/v1/applications/{cc_app['id']}/case-number",
        json={"bank_case_number": f"CC-{unique_tag()[:8]}"},
    )
    rejected = await _create_app(
        authed,
        customer_id=(await _customer(authed, "Reject"))["id"],
        bank_id=eib["id"],
        product_id=pf["id"],
        case_owner_id=first["id"],
        requested_amount="1000",
    )
    await authed.post(
        f"/api/v1/applications/{rejected['id']}/outcome",
        json={"outcome": "Final Rejected", "reason": "Policy"},
    )
    empty = (await authed.get("/api/v1/reports/dashboard?period=previous_month")).json()
    assert empty["conversions"]["submittedToApproved"] is None
    rankings = (await authed.get("/api/v1/reports/rankings?ranking_metric=funded_value")).json()[
        "rankings"
    ]
    employee_rows = [row for row in rankings["employees"] if row["id"] in {first["id"], second["id"]}]
    assert len(employee_rows) == 2
    assert employee_rows[0]["rank"] == employee_rows[1]["rank"]
    dashboard = (await authed.get("/api/v1/reports/dashboard")).json()
    assert dashboard["kpis"]["creditCard"]["count"] >= 1
    assert dashboard["kpis"]["creditCard"]["value"] is None
    assert dashboard["kpis"]["finalRejected"]["count"] >= 1
    today = date.today().isoformat()
    custom = await authed.get(
        f"/api/v1/reports/dashboard?period=custom&date_from={today}&date_to={today}"
    )
    assert custom.status_code == 200, custom.text
    assert custom.json()["period"]["key"] == "custom"
    profile = await authed.get(f"/api/v1/reports/employees/{first['id']}?period=since_joining")
    assert profile.status_code == 200, profile.text
    assert profile.json()["period"]["key"] == "since_joining"
    assert profile.json()["employee"]["employeeCode"] == first["employeeCode"]
    compare = await authed.get(
        "/api/v1/reports/comparisons?kind=period&period=month&metric=funded_value"
    )
    assert compare.status_code == 200, compare.text
    assert compare.json()["percentageChange"] is None or isinstance(
        compare.json()["percentageChange"], float
    )
    entity = await authed.get(
        "/api/v1/reports/comparisons"
        f"?kind=entity&dimension=employee&left_id={first['id']}&right_id={second['id']}"
        "&metric=funded_value&period=mtd"
    )
    assert entity.status_code == 200, entity.text
    assert entity.json()["absoluteDifference"] is not None
    missing = await authed.get("/api/v1/reports/dashboard?period=custom")
    assert missing.status_code == 422


@pytest.mark.asyncio
async def test_active_delay_drilldown_and_exports(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    delayed = await _create_app(
        authed,
        customer_id=(await _customer(authed, "DelayDash"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
        requested_amount="1500",
    )
    marked = await authed.post(
        f"/api/v1/applications/{delayed['id']}/delays",
        json={"delay_type": "Bank", "reason": "Waiting on bank"},
    )
    assert marked.status_code == 200, marked.text
    dashboard = (await authed.get("/api/v1/reports/dashboard")).json()
    assert dashboard["activeDelays"]["Bank"] >= 1
    delay_rows = (await authed.get("/api/v1/reports/applications?metric=delay_bank")).json()
    assert delayed["applicationCode"] in {
        item["applicationCode"] for item in delay_rows["items"]
    }
    excel = await authed.post(
        "/api/v1/reports/export",
        json={"format": "xlsx", "report": "dashboard", "period": "mtd"},
    )
    assert excel.status_code == 200, excel.text
    assert "spreadsheetml" in excel.headers["content-type"]
    pdf = await authed.post(
        "/api/v1/reports/export",
        json={"format": "pdf", "report": "drill_down", "period": "mtd", "metric": "pending"},
    )
    assert pdf.status_code == 200, pdf.text
    assert pdf.headers["content-type"] == "application/pdf"
    printed = await authed.post(
        "/api/v1/reports/export",
        json={"format": "print", "report": "rankings", "period": "mtd"},
    )
    assert printed.status_code == 200, printed.text
    assert "text/html" in printed.headers["content-type"]
    async with app.state.session_factory() as session:
        events = (
            await session.execute(select(AuditEvent).where(AuditEvent.action == "reports.export"))
        ).scalars().all()
        assert events
        assert events[-1].new_values["exportType"] in {"xlsx", "pdf", "print"}
        assert "file" not in (events[-1].new_values or {})
    limited = await _reporting_user(authed, scope="company", permissions=VIEW_PERMS)
    async with await spawned_client() as other:
        await authenticate(other, limited["email"], "UserPass1!")
        denied_excel = await other.post(
            "/api/v1/reports/export",
            json={"format": "xlsx", "report": "dashboard", "period": "mtd"},
        )
        assert denied_excel.status_code == 403
        denied_pdf = await other.post(
            "/api/v1/reports/export",
            json={"format": "pdf", "report": "dashboard", "period": "mtd"},
        )
        assert denied_pdf.status_code == 403
        denied_print = await other.post(
            "/api/v1/reports/export",
            json={"format": "print", "report": "dashboard", "period": "mtd"},
        )
        assert denied_print.status_code == 403
    exporter = await _reporting_user(authed, scope="own", permissions=EXPORT_PERMS)
    own_app = await _create_app(
        authed,
        customer_id=(await _customer(authed, "ExportOwn"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=exporter["id"],
        requested_amount="2500",
    )
    await _submit_and_fund(authed, own_app, "2500")
    async with await spawned_client() as other:
        await authenticate(other, exporter["email"], "UserPass1!")
        exported = await other.post(
            "/api/v1/reports/export",
            json={"format": "xlsx", "report": "drill_down", "period": "mtd", "metric": "funded"},
        )
        assert exported.status_code == 200, exported.text
        scoped_drill = (
            await other.get("/api/v1/reports/applications?metric=funded")
        ).json()
        assert all(item["applicationCode"] != delayed["applicationCode"] for item in scoped_drill["items"])
        assert own_app["applicationCode"] in {
            item["applicationCode"] for item in scoped_drill["items"]
        }
