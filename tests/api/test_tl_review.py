from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
from datetime import UTC, datetime
from uuid import UUID

import pytest
from helpers import (
    authenticate,
    create_activated_user,
    office_id,
    owner_client,
    spawned_client,
    unique_tag,
)
from httpx import AsyncClient
from nexa_bos_api.applications.models import ApplicationOwnerHistory
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.db.session import create_engine, create_session_factory
from nexa_bos_api.identity.models import AuditEvent
from sqlalchemy import select
from test_role_readiness import _configure_system_type, _variant

SALES = [
    "Dashboard.View",
    "Applications.View",
    "Applications.Create",
    "Applications.Edit",
    "Customers.Create",
    "Customers.Edit",
    "Customers.View",
    "Notifications.View",
]


@pytest.fixture
async def workspace(client: AsyncClient):
    owner, _ = await owner_client(client)
    for code, scope in (("TL", "team"), ("SE", "own"), ("COD", "office")):
        permissions = (
            SALES
            if code != "COD"
            else SALES
            + ["Applications.Submit", "Applications.UpdateStage", "Applications.SetOutcome"]
        )
        await _configure_system_type(
            owner,
            code,
            permissions=permissions,
            directory_scope=scope,
            customer_scope=scope,
            application_scope=scope,
            reporting_scope=scope,
            can_be_case_owner=True,
        )
    bank, product, variant = await _variant(owner)
    async with AsyncExitStack() as stack:
        groups = []
        for code in ("DXB", "DXB", "AUH"):
            office = await office_id(owner, code)
            tag = unique_tag()
            department = await owner.post(
                "/api/v1/departments",
                json={"office_id": office, "code": f"TR{tag}", "name": f"TL review {tag}"},
            )
            assert department.status_code == 200, department.text
            dep_id = department.json()["id"]
            team = await owner.post(
                "/api/v1/teams",
                json={
                    "office_id": office,
                    "department_id": dep_id,
                    "code": f"TT{tag}",
                    "name": f"Review team {tag}",
                },
            )
            assert team.status_code == 200, team.text
            team_id = team.json()["id"]
            cod = await create_activated_user(
                owner, user_type_code="COD", office_id=office, department_id=dep_id
            )
            tl = await create_activated_user(
                owner,
                user_type_code="TL",
                office_id=office,
                department_id=dep_id,
                team_id=team_id,
                manager_id=cod["id"],
            )
            se = await create_activated_user(
                owner,
                user_type_code="SE",
                office_id=office,
                department_id=dep_id,
                team_id=team_id,
                manager_id=tl["id"],
            )
            actors = {}
            for role, user in (("cod", cod), ("tl", tl), ("se", se)):
                actor = await stack.enter_async_context(await spawned_client())
                await authenticate(actor, user["email"], "UserPass1!")
                actors[role] = actor
            groups.append({"office": office, "team": team_id, "tl": tl, "se": se, "actors": actors})
        yield owner, groups, (bank, product, variant)


async def create_case(actor, catalog):
    bank, product, variant = catalog
    response = await actor.post(
        "/api/v1/applications",
        json={
            "customer": {
                "customer_type": "individual",
                "full_name": f"TL disposable {unique_tag()}",
                "mobile": "+971500000001",
            },
            "bank_id": bank["id"],
            "product_id": product["id"],
            "product_variant_id": variant["id"],
            "requested_amount": "12000",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def state(actor, app):
    response = await actor.get(f"/api/v1/applications/{app['id']}/internal-review")
    assert response.status_code == 200, response.text
    return response.json()


async def action(actor, app, command, current, reason=None):
    return await actor.post(
        f"/api/v1/applications/{app['id']}/internal-review",
        json={"action": command, "expected_event_id": current["eventId"], "reason": reason},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("index", [0, 2], ids=["DXB", "AUH"])
async def test_tl_scope_routing_ownership_and_dashboard(workspace, index):
    owner, groups, catalog = workspace
    group = groups[index]
    tl, se, cod = (group["actors"][key] for key in ("tl", "se", "cod"))
    app = await create_case(se, catalog)
    own = await create_case(tl, catalog)
    assert (await state(tl, own))["status"] == "forwarded"
    assert (await state(tl, own))["actions"] == []
    current = await state(tl, app)
    assert current["status"] == "pending_review"
    assert current["tlId"] == group["tl"]["id"]
    assert current["actions"] == ["forward", "return"]
    path = f"/api/v1/applications/{app['id']}"
    assert (await tl.patch(path, json={"requested_amount": "1"})).status_code == 404
    assert (await se.patch(path, json={"requested_amount": "1"})).status_code == 409
    assert (
        await cod.post(f"{path}/case-number", json={"bank_case_number": "BLOCKED"})
    ).status_code == 409
    assert (await action(se, app, "forward", current)).status_code == 403
    assert (await action(tl, own, "forward", await state(tl, own))).status_code == 403
    assert (await action(tl, app, "return", current, "  ")).status_code == 422
    returned = await action(tl, app, "return", current, "Correct requested amount")
    assert returned.status_code == 200, returned.text
    assert returned.json()["status"] == "returned"
    assert (await se.patch(path, json={"approved_amount": "10000"})).status_code == 403
    assert (await se.patch(path, json={"requested_amount": "15000"})).status_code == 200
    resubmitted = await action(se, app, "resubmit", returned.json())
    assert resubmitted.status_code == 200, resubmitted.text
    assert resubmitted.json()["tlId"] == group["tl"]["id"]
    dashboard = await tl.get("/api/v1/reports/tl-dashboard", params={"queue": "resubmitted"})
    assert dashboard.status_code == 200, dashboard.text
    data = dashboard.json()
    assert [row["id"] for row in data["items"]] == [app["id"]]
    assert {row["id"] for row in data["staff"]} == {group["se"]["id"]}
    assert data["staff"][0]["applications"] == 1
    assert data["staff"][0]["pendingReview"] == 1
    assert data["staff"][0]["target"]["assigned"] is None
    for key in ("personalPerformance", "personalAttendance", "charts"):
        assert key in data
    own_data = (await tl.get("/api/v1/reports/tl-dashboard?view=own&queue=all")).json()
    assert {row["id"] for row in own_data["items"]} == {own["id"]}
    team_data = (await tl.get("/api/v1/reports/tl-dashboard?view=team&queue=all")).json()
    assert {row["id"] for row in team_data["items"]} == {app["id"]}
    # Concurrent submissions serialize on the Application; one append only.
    results = await asyncio.gather(
        *(action(tl, app, "forward", resubmitted.json()) for _ in range(3))
    )
    assert sorted(result.status_code for result in results) == [200, 409, 409]
    forwarded = await state(tl, app)
    assert forwarded["status"] == "forwarded"
    assert [event["action"] for event in forwarded["history"]] == [
        "internal_review_started",
        "internal_returned",
        "internal_resubmitted",
        "internal_forwarded",
    ]
    assert (await se.patch(path, json={"requested_amount": "2"})).status_code == 409
    unchanged = (await tl.get(path)).json()
    assert unchanged["caseOwnerId"] == group["se"]["id"]
    assert unchanged["currentStageId"] == app["currentStageId"]
    assert unchanged["applicationCode"] == app["applicationCode"]
    submitted = await cod.post(
        f"{path}/case-number", json={"bank_case_number": f"TL-{unique_tag()}"}
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["submitted"] is True
    assert submitted.json()["caseOwnerId"] == group["se"]["id"]
    target = await owner.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": group["se"]["id"],
            "period_month": datetime.now(UTC).date().replace(day=1).isoformat(),
            "product_id": catalog[1]["id"],
            "milestone": "submitted",
            "measurement": "count",
            "target_value": "4",
        },
    )
    assert target.status_code == 200, target.text
    assert (await owner.post(f"/api/v1/targets/{target.json()['id']}/activate")).status_code == 200
    calculated = (await tl.get("/api/v1/reports/tl-dashboard?queue=submitted")).json()
    assert calculated["staff"][0]["target"]["assigned"] == "4.00"
    assert calculated["staff"][0]["target"]["achieved"] == "1.00"
    assert calculated["staff"][0]["target"]["remaining"] == "3.00"
    assert calculated["staff"][0]["target"]["achievementPct"] == 25
    assert calculated["staff"][0]["submitted"] == 1
    assert {row["id"] for row in calculated["items"]} == {app["id"]}
    timeline = (await tl.get(f"{path}/timeline")).json()["items"]
    assert sum(row["eventType"] == "internal_forwarded" for row in timeline) == 1
    # Both other office and another team in the same office are denied.
    for outsider in [g for g in groups if g is not group]:
        stranger = outsider["actors"]["tl"]
        for suffix in ("", "/timeline", "/progress", "/internal-review"):
            assert (await stranger.get(path + suffix)).status_code == 404
        assert (await action(stranger, app, "forward", forwarded)).status_code == 404
        assert app["id"] not in str(
            (await stranger.get("/api/v1/reports/tl-dashboard?queue=all")).json()
        )
        assert (
            await stranger.get("/api/v1/applications", params={"case_owner_id": group["se"]["id"]})
        ).json()["items"] == []
    for actor in (tl, se, cod):
        assert (await actor.get("/api/v1/workflows")).status_code == 403
        assert (await actor.get("/api/v1/customers")).status_code == 403
    assert (await se.get("/api/v1/reports/tl-dashboard")).status_code == 403
    assert (await cod.get("/api/v1/reports/tl-dashboard")).status_code == 403
    assert (await owner.get(path)).status_code == 200
    engine = create_engine(get_settings())
    try:
        async with create_session_factory(engine)() as session:
            histories = list(
                await session.scalars(
                    select(ApplicationOwnerHistory).where(
                        ApplicationOwnerHistory.application_id == UUID(app["id"])
                    )
                )
            )
            assert len(histories) == 1
            assert str(histories[0].owner_id) == group["se"]["id"]
            audits = list(
                await session.scalars(
                    select(AuditEvent).where(
                        AuditEvent.entity_id == app["id"],
                        AuditEvent.action.in_(
                            (
                                "application.internal_forwarded",
                                "application.internal_returned",
                                "application.internal_resubmitted",
                            )
                        ),
                    )
                )
            )
            assert len(audits) == 3
            assert {row.action: str(row.actor_id) for row in audits} == {
                "application.internal_forwarded": group["tl"]["id"],
                "application.internal_returned": group["tl"]["id"],
                "application.internal_resubmitted": group["se"]["id"],
            }
    finally:
        await engine.dispose()
