from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
from dataclasses import replace
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

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
from nexa_bos_api.applications.models import ApplicationEvent, ApplicationOwnerHistory
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.db.session import create_engine, create_session_factory
from nexa_bos_api.identity.models import AuditEvent
from nexa_bos_api.reporting.periods import resolve_period
from nexa_bos_api.reporting.service import load_facts
from nexa_bos_api.reporting.tl import _history_cutoffs, _metric_history
from sqlalchemy import select
from test_applications import _stage_by_key
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
    assert all({"name", "created", "submitted"} <= set(row) for row in data["charts"]["trend"])
    assert all(
        {"stageId", "name", "workflowContext", "label", "count"} <= set(row)
        for row in data["charts"]["stages"]
    )
    assert len({row["stageId"] for row in data["charts"]["stages"]}) == len(
        data["charts"]["stages"]
    )
    assert all(
        row["name"] in row["label"] and " · v" in row["workflowContext"]
        for row in data["charts"]["stages"]
    )
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


def test_tl_history_cutoffs_are_bounded_to_the_selected_period():
    now = datetime(2025, 12, 15, 12, 30, tzinfo=UTC)
    for period, expected_count in (("today", 1), ("mtd", 15), ("previous_month", 30), ("ytd", 12)):
        window = resolve_period(period, as_of=now)
        cutoffs = _history_cutoffs(window, now)
        assert len(cutoffs) == expected_count
        assert all(window.start <= cutoff <= min(window.end, now) for cutoff in cutoffs)
        assert cutoffs == sorted(set(cutoffs))
        assert cutoffs[-1] == min(window.end, now)
    january = datetime(2025, 1, 31, 23, 59, tzinfo=UTC)
    assert len(_history_cutoffs(resolve_period("mtd", as_of=january), january)) == 31


@pytest.mark.asyncio
@pytest.mark.parametrize("index", [0, 2], ids=["DXB", "AUH"])
async def test_tl_metric_history_matches_scope_period_and_real_lifecycle(workspace, index):
    owner, groups, catalog = workspace
    group = groups[index]
    tl, se, cod = (group["actors"][key] for key in ("tl", "se", "cod"))
    other = next(item for item in groups if item is not group)
    outside = await create_case(other["actors"]["se"], catalog)
    app = await create_case(se, catalog)
    own = await create_case(tl, catalog)

    async def report(**params):
        response = await tl.get("/api/v1/reports/tl-dashboard", params=params)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert outside["id"] not in str(payload)
        assert set(payload["metricHistory"]) == {item["key"] for item in payload["cards"]}
        now = datetime.fromisoformat(payload["updatedAt"])
        window = resolve_period(params.get("period", "mtd"), as_of=now)
        for history in payload["metricHistory"].values():
            assert history["unit"] == "cases"
            assert history["basis"]
            dates = [date.fromisoformat(point["date"]) for point in history["points"]]
            assert dates == sorted(set(dates))
            assert all(
                window.date_from <= point <= min(window.date_to, now.date()) for point in dates
            )
            assert len(dates) <= (12 if window.key == "ytd" else 31)
        return payload

    initial = await report(period="today", view="combined")
    values = {key: value["points"][-1]["value"] for key, value in initial["metricHistory"].items()}
    assert values == {
        "pending_review": 1,
        "returned": 0,
        "resubmitted": 0,
        "forwarded": 1,
        "active": 2,
        "submitted": 0,
        "approved": 0,
        "funded": 0,
    }
    assert "card shows current stock" in initial["metricHistory"]["pending_review"]["basis"]
    own_report = await report(period="today", view="own")
    assert own_report["metricHistory"]["pending_review"]["points"][-1]["value"] == 0
    assert own_report["metricHistory"]["active"]["points"][-1]["value"] == 1
    team_report = await report(period="today", view="team")
    assert team_report["metricHistory"]["forwarded"]["points"][-1]["value"] == 0
    assert team_report["metricHistory"]["active"]["points"][-1]["value"] == 1
    returned = await action(
        tl, app, "return", await state(tl, app), "Disposable history correction"
    )
    assert returned.status_code == 200, returned.text
    assert (await report(period="today"))["metricHistory"]["returned"]["points"][-1]["value"] == 1
    resubmitted = await action(se, app, "resubmit", returned.json())
    assert resubmitted.status_code == 200, resubmitted.text
    assert (await report(period="today"))["metricHistory"]["resubmitted"]["points"][-1][
        "value"
    ] == 1
    forwarded = await action(tl, app, "forward", resubmitted.json())
    assert forwarded.status_code == 200, forwarded.text
    submitted = await cod.post(
        f"/api/v1/applications/{app['id']}/case-number",
        json={"bank_case_number": f"TLH-{unique_tag()}"},
    )
    assert submitted.status_code == 200, submitted.text
    for stage_key, amount_key in (
        ("approved", "approved_amount"),
        ("booked", "booked_amount"),
        ("fund_released", "funded_amount"),
    ):
        stage = await _stage_by_key(owner, app["workflowId"], stage_key)
        response = await cod.post(
            f"/api/v1/applications/{app['id']}/stage",
            json={
                "stage_id": stage["id"],
                "bank_stage_date": datetime.now(UTC).date().isoformat(),
                amount_key: "10000",
            },
        )
        assert response.status_code == 200, response.text
    for period in ("today", "mtd", "previous_month", "ytd"):
        payload = await report(period=period, view="combined")
        card_counts = {card["key"]: card["count"] for card in payload["cards"]}
        for key in ("forwarded", "submitted", "approved", "funded"):
            assert payload["metricHistory"][key]["points"][-1]["value"] == card_counts[key]
        if period == "previous_month":
            assert card_counts["active"] == 1
            assert all(
                point["value"] == 0
                for history in payload["metricHistory"].values()
                for point in history["points"]
            )
        else:
            assert payload["metricHistory"]["funded"]["points"][-1]["value"] == 1
            assert payload["metricHistory"]["active"]["points"][-1]["value"] == 1
    for outsider in (item for item in groups if item is not group):
        response = await outsider["actors"]["tl"].get("/api/v1/reports/tl-dashboard?period=today")
        assert response.status_code == 200, response.text
        histories = response.json()["metricHistory"]
        assert histories["submitted"]["points"][-1]["value"] == 0
        assert histories["approved"]["points"][-1]["value"] == 0
        assert histories["funded"]["points"][-1]["value"] == 0
        assert (
            await outsider["actors"]["tl"].get(f"/api/v1/applications/{app['id']}")
        ).status_code == 404

    # Exercise historical daily states on an authorized fact loaded from this disposable DB.
    # Detached event objects below are calculation inputs only; stored immutable events stay intact.
    engine = create_engine(get_settings())
    try:
        async with create_session_factory(engine)() as session:
            facts, *_ = await load_facts(session, owner_ids={UUID(group["se"]["id"])})
            fact = next(item for item in facts if str(item.id) == app["id"])
            events = [
                ApplicationEvent(
                    id=uuid4(),
                    application_id=fact.id,
                    actor_id=UUID(group["tl"]["id"]),
                    event_type=event_type,
                    bos_updated_at=datetime(2025, 1, day, 9, tzinfo=UTC),
                    payload={"status": status},
                )
                for day, event_type, status in (
                    (1, "internal_review_started", "pending_review"),
                    (2, "internal_returned", "returned"),
                    (3, "internal_resubmitted", "resubmitted"),
                    (4, "internal_forwarded", "forwarded"),
                )
            ]
            historical = replace(
                fact,
                created_at=datetime(2025, 1, 1, 8, tzinfo=UTC),
                submitted_at=datetime(2025, 1, 4, 10, tzinfo=UTC),
                approved_at=datetime(2025, 1, 4, 11, tzinfo=UTC),
                funded_at=datetime(2025, 1, 5, 9, tzinfo=UTC),
                terminal_at=datetime(2025, 1, 5, 10, tzinfo=UTC),
                terminal_outcome="Completed",
                events=events,
            )
            cutoff = datetime(2025, 1, 5, 12, tzinfo=UTC)
            history = _metric_history([historical], resolve_period("mtd", as_of=cutoff), cutoff)
            actual = {
                key: [point["value"] for point in metric["points"]]
                for key, metric in history.items()
            }
            assert actual == {
                "pending_review": [1, 0, 0, 0, 0],
                "returned": [0, 1, 0, 0, 0],
                "resubmitted": [0, 0, 1, 0, 0],
                "forwarded": [0, 0, 0, 1, 1],
                "active": [1, 1, 1, 1, 0],
                "submitted": [0, 0, 0, 1, 1],
                "approved": [0, 0, 0, 1, 1],
                "funded": [0, 0, 0, 0, 1],
            }
    finally:
        await engine.dispose()

    # A supported COD creation has no SE/TL review event. Reassignment preserves that legacy gap.
    legacy = await create_case(cod, catalog)
    reassigned = await owner.post(
        f"/api/v1/applications/{legacy['id']}/reassign-owner",
        json={"case_owner_id": group["se"]["id"], "reason": "Disposable legacy history coverage"},
    )
    assert reassigned.status_code == 200, reassigned.text
    legacy_report = await report(period="today", view="team")
    for key in ("pending_review", "returned", "resubmitted", "forwarded"):
        assert legacy_report["metricHistory"][key]["points"][-1]["value"] is None
    assert legacy_report["metricHistory"]["active"]["points"][-1]["value"] == 1
    assert legacy_report["metricHistory"]["submitted"]["points"][-1]["value"] == 1
    own_report = await report(period="today", view="own")
    assert own_report["metricHistory"]["forwarded"]["points"][-1]["value"] == 1
    assert (await tl.get(f"/api/v1/applications/{own['id']}")).status_code == 200
