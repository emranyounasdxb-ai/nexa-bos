from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from httpx import AsyncClient

from helpers import (
    authenticate,
    create_activated_user,
    owner_client,
    spawned_client,
    unique_tag,
)
from nexa_bos_api.applications.tat import duration_seconds
from test_applications import _catalog, _create_app, _customer, _stage_by_key


def test_duration_seconds_is_non_negative() -> None:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    end = datetime(2026, 1, 1, 0, 2, 5, tzinfo=UTC)
    assert duration_seconds(start, end) == 125
    assert duration_seconds(end, start) == 0


async def _limited_user(
    authed: AsyncClient,
    *,
    permissions: list[str],
    password: str = "UserPass1!",
) -> dict:
    tag = unique_tag().upper()
    created_type = await authed.post(
        "/api/v1/user-types",
        json={"name": f"TAT {tag}", "code": f"T{tag[:8]}"},
    )
    type_id = created_type.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    await authed.put(
        f"/api/v1/user-types/{type_id}/permissions",
        json={"permissions": permissions},
    )
    await authed.put(
        f"/api/v1/user-types/{type_id}/application-scope",
        json={"application_visibility_scope": "company"},
    )
    return await create_activated_user(
        authed, user_type_code=created_type.json()["code"], password=password
    )


async def _move(
    client: AsyncClient, application: dict, key: str, extra: dict | None = None
) -> dict:
    stage = await _stage_by_key(client, application["workflowId"], key)
    payload = {"stage_id": stage["id"], "bank_stage_date": date.today().isoformat()}
    if extra:
        payload.update(extra)
    response = await client.post(f"/api/v1/applications/{application['id']}/stage", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_timer_starts_on_create_and_exposes_elapsed_and_stage_duration(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "TATStart")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    assert created["tatStartedAt"] == created["createdAt"]
    assert created["tatStoppedAt"] is None
    assert created["totalDurationSeconds"] is None
    assert created["currentElapsedSeconds"] is not None
    assert created["currentElapsedSeconds"] >= 0
    assert created["currentStageElapsedSeconds"] is not None
    assert created["currentStageElapsedSeconds"] >= 0
    assert created["hasActiveDelay"] is False
    assert created["activeDelay"] is None
    assert len(created["stageDurations"]) == 1
    occupancy = created["stageDurations"][0]
    assert occupancy["stageName"] == "Application Created"
    assert occupancy["completed"] is False
    assert occupancy["exitedAt"] is None
    assert occupancy["enteredAt"]
    assert occupancy["bosUpdatedAt"]
    assert occupancy["updatedBy"]


@pytest.mark.asyncio
async def test_stage_move_closes_completed_duration_and_starts_current_elapsed(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "TATStage")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
        bank_case_number=f"TAT-{unique_tag()[:8]}",
    )
    assert created["currentStage"] == "Submitted"
    completed = [row for row in created["stageDurations"] if row["completed"]]
    current = [row for row in created["stageDurations"] if not row["completed"]]
    assert len(completed) == 1
    assert completed[0]["stageName"] == "Application Created"
    assert completed[0]["exitedAt"]
    assert completed[0]["durationSeconds"] >= 0
    assert len(current) == 1
    assert current[0]["stageName"] == "Submitted"
    moved = await _move(
        authed,
        created,
        "returned_requirement_pending",
        {"requirement_text": "Salary certificate", "stage_note": "Bank query"},
    )
    returned = next(
        row for row in moved["stageDurations"] if row["stageName"].startswith("Returned")
    )
    assert returned["bankStageDate"] == date.today().isoformat()
    assert returned["stageNote"] == "Bank query"
    assert returned["completed"] is False
    submitted = next(row for row in moved["stageDurations"] if row["stageName"] == "Submitted")
    assert submitted["completed"] is True
    assert submitted["durationSeconds"] >= 0


@pytest.mark.asyncio
async def test_terminal_outcome_stops_tat_and_closes_current_stage(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "TATStop")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    closed = await authed.post(
        f"/api/v1/applications/{created['id']}/outcome",
        json={"outcome": "Cancelled", "reason": "Customer cancelled"},
    )
    assert closed.status_code == 200, closed.text
    body = closed.json()
    assert body["tatStoppedAt"]
    assert body["totalDurationSeconds"] is not None
    assert body["totalDurationSeconds"] >= 0
    assert body["currentElapsedSeconds"] is None
    assert body["currentStageElapsedSeconds"] is None
    assert all(row["completed"] for row in body["stageDurations"])


@pytest.mark.asyncio
async def test_fund_release_stops_tat_with_completed_duration(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "TATFund")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
        bank_case_number=f"FUND-{unique_tag()[:8]}",
    )
    await _move(authed, created, "approved", {"approved_amount": "9000"})
    await _move(authed, created, "booked", {"booked_amount": "9000"})
    done = await _move(authed, created, "fund_released", {"funded_amount": "9000"})
    assert done["terminalOutcome"] == "Completed"
    assert done["tatStoppedAt"]
    assert done["totalDurationSeconds"] is not None
    assert all(row["completed"] for row in done["stageDurations"])
    assert any(row["stageName"] == "Fund Released" for row in done["stageDurations"])


@pytest.mark.asyncio
async def test_mark_delay_rules_and_one_active(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "DelayMark")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    missing = await authed.post(
        f"/api/v1/applications/{created['id']}/delays",
        json={"delay_type": "Bank", "reason": ""},
    )
    assert missing.status_code == 422
    other = await authed.post(
        f"/api/v1/applications/{created['id']}/delays",
        json={"delay_type": "Other", "reason": "Need more detail"},
    )
    assert other.status_code == 422
    assert other.json()["error"]["code"] == "DELAY_OTHER_EXPLANATION_REQUIRED"
    marked = await authed.post(
        f"/api/v1/applications/{created['id']}/delays",
        json={
            "delay_type": "Other",
            "reason": "Waiting on third party",
            "other_explanation": "Insurance certificate",
        },
    )
    assert marked.status_code == 200, marked.text
    delay = marked.json()["activeDelay"]
    assert delay["delayType"] == "Other"
    assert delay["reason"] == "Waiting on third party"
    assert delay["otherExplanation"] == "Insurance certificate"
    assert delay["stageName"] == "Application Created"
    assert delay["startedAt"]
    assert delay["markedBy"]
    assert delay["active"] is True
    assert marked.json()["hasActiveDelay"] is True
    listed = await authed.get(f"/api/v1/applications?application_id={created['applicationCode']}")
    assert listed.json()["items"][0]["hasActiveDelay"] is True
    second = await authed.post(
        f"/api/v1/applications/{created['id']}/delays",
        json={"delay_type": "Bank", "reason": "Another delay"},
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "DELAY_ALREADY_ACTIVE"


@pytest.mark.asyncio
async def test_delay_auto_closes_on_stage_move_and_terminal(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "DelayClose")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    marked = await authed.post(
        f"/api/v1/applications/{created['id']}/delays",
        json={"delay_type": "Bank", "reason": "Awaiting documents"},
    )
    delay_id = marked.json()["activeDelay"]["id"]
    original_type = marked.json()["activeDelay"]["delayType"]
    original_reason = marked.json()["activeDelay"]["reason"]
    submitted = await authed.post(
        f"/api/v1/applications/{created['id']}/case-number",
        json={"bank_case_number": f"DLY-{unique_tag()[:8]}"},
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["hasActiveDelay"] is False
    assert submitted.json()["activeDelay"] is None
    timeline = (await authed.get(f"/api/v1/applications/{created['id']}/timeline")).json()["items"]
    types = [item["eventType"] for item in timeline]
    assert "delay_marked" in types
    assert "delay_closed" in types
    closed_event = next(item for item in timeline if item["eventType"] == "delay_closed")
    assert closed_event["payload"]["delayId"] == delay_id
    assert closed_event["payload"]["delayType"] == original_type
    assert closed_event["payload"]["reason"] == original_reason
    assert closed_event["payload"]["endedAt"]
    assert closed_event["payload"]["durationSeconds"] >= 0

    other = await _create_app(
        authed,
        customer_id=(await _customer(authed, "DelayTerm"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    await authed.post(
        f"/api/v1/applications/{other['id']}/delays",
        json={"delay_type": "Customer", "reason": "Customer travelling"},
    )
    cancelled = await authed.post(
        f"/api/v1/applications/{other['id']}/outcome",
        json={"outcome": "Withdrawn", "reason": "Customer withdrew"},
    )
    assert cancelled.json()["hasActiveDelay"] is False
    assert cancelled.json()["tatStoppedAt"]
    term_timeline = (await authed.get(f"/api/v1/applications/{other['id']}/timeline")).json()[
        "items"
    ]
    assert any(item["eventType"] == "delay_closed" for item in term_timeline)


@pytest.mark.asyncio
async def test_delay_correction_is_append_only(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "DelayFix")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    marked = await authed.post(
        f"/api/v1/applications/{created['id']}/delays",
        json={"delay_type": "Internal", "reason": "Ops backlog"},
    )
    delay = marked.json()["activeDelay"]
    missing = await authed.post(
        f"/api/v1/applications/{created['id']}/delays/{delay['id']}/correct",
        json={"action": "cancel", "reason": ""},
    )
    assert missing.status_code == 422
    corrected = await authed.post(
        f"/api/v1/applications/{created['id']}/delays/{delay['id']}/correct",
        json={"action": "cancel", "reason": "Marked against the wrong application"},
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["hasActiveDelay"] is False
    timeline = (await authed.get(f"/api/v1/applications/{created['id']}/timeline")).json()["items"]
    marked_event = next(item for item in timeline if item["eventType"] == "delay_marked")
    cancelled_event = next(item for item in timeline if item["eventType"] == "delay_cancelled")
    assert marked_event["payload"]["delayType"] == "Internal"
    assert marked_event["payload"]["reason"] == "Ops backlog"
    assert cancelled_event["reason"] == "Marked against the wrong application"
    assert cancelled_event["correctionOfEventId"] == marked_event["id"]
    assert cancelled_event["updatedBy"]
    assert cancelled_event["bosUpdatedAt"]
    again = await authed.post(
        f"/api/v1/applications/{created['id']}/delays",
        json={"delay_type": "Bank", "reason": "Now waiting on bank"},
    )
    assert again.status_code == 200
    assert again.json()["activeDelay"]["delayType"] == "Bank"


@pytest.mark.asyncio
async def test_delay_permissions_enforced(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "DelayPerm")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    viewer = await _limited_user(
        authed, permissions=["Applications.View", "Customers.View"]
    )
    marker = await _limited_user(
        authed,
        permissions=["Applications.View", "Applications.MarkDelay", "Customers.View"],
    )
    async with await spawned_client() as other:
        await authenticate(other, viewer["email"], "UserPass1!")
        forbidden = await other.post(
            f"/api/v1/applications/{created['id']}/delays",
            json={"delay_type": "Bank", "reason": "Should fail"},
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["error"]["code"] == "FORBIDDEN"
    async with await spawned_client() as marker_client:
        await authenticate(marker_client, marker["email"], "UserPass1!")
        marked = await marker_client.post(
            f"/api/v1/applications/{created['id']}/delays",
            json={"delay_type": "Customer", "reason": "Customer travelling"},
        )
        assert marked.status_code == 200, marked.text
        delay_id = marked.json()["activeDelay"]["id"]
        locked = await marker_client.post(
            f"/api/v1/applications/{created['id']}/delays/{delay_id}/correct",
            json={"action": "cancel", "reason": "Should fail"},
        )
        assert locked.status_code == 403
    async with await spawned_client() as viewer_client:
        await authenticate(viewer_client, viewer["email"], "UserPass1!")
        detail = await viewer_client.get(f"/api/v1/applications/{created['id']}")
        assert detail.json()["hasActiveDelay"] is True
        progress = await viewer_client.get(f"/api/v1/applications/{created['id']}/progress")
        assert progress.json()["activeDelay"]["delayType"] == "Customer"
        timeline = await viewer_client.get(f"/api/v1/applications/{created['id']}/timeline")
        assert any(item["eventType"] == "delay_marked" for item in timeline.json()["items"])
