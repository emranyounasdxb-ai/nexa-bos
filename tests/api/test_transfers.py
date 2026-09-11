from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
import pytest_asyncio
from helpers import (
    authenticate,
    business_today,
    create_activated_user,
    owner_client,
    spawned_client,
    unique_tag,
)
from httpx import AsyncClient
from nexa_bos_api.main import app
from nexa_bos_api.transfers import service as transfer_service
from sqlalchemy import text


@pytest_asyncio.fixture(autouse=True)
async def restore_fixture_hr_scope(client):
    async with app.state.session_factory() as session:
        original = await session.scalar(
            text("SELECT visibility_scope FROM user_types WHERE code='HR'")
        )
    yield
    async with app.state.session_factory() as session:
        await session.execute(
            text("UPDATE user_types SET visibility_scope=:scope WHERE code='HR'"),
            {"scope": original},
        )
        await session.commit()


async def fixture(owner):
    roles = (await owner.get("/api/v1/user-types")).json()["items"]
    hr_role = next(r for r in roles if r["code"] == "HR")
    response = await owner.put(
        f"/api/v1/user-types/{hr_role['id']}/scope", json={"visibility_scope": "company"}
    )
    assert response.status_code == 200, response.text
    hr = await create_activated_user(owner, user_type_code="HR")
    reviewer = await create_activated_user(owner, user_type_code="HR")
    employee = await create_activated_user(owner)
    designation = await owner.post(
        "/api/v1/designations",
        json={"code": f"TR{unique_tag()}", "name": "Synthetic transfer designation"},
    )
    assert designation.status_code == 200, designation.text
    clients = [await spawned_client(), await spawned_client(), await spawned_client()]
    for actor, user in zip(clients, (hr, reviewer, employee), strict=True):
        await authenticate(actor, user["email"], "UserPass1!")
    payload = {
        "employee_id": employee["id"],
        "proposed": {
            "office_id": None,
            "department_id": None,
            "team_id": None,
            "reporting_manager_id": None,
            "designation_id": designation.json()["id"],
        },
        "reason": "Synthetic reassignment",
        "effective_date": business_today().isoformat(),
    }
    return employee, payload, clients


async def create(actor, payload):
    response = await actor.post("/api/v1/transfers", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


async def action(actor, row, kind, expected=200):
    response = await actor.post(
        f"/api/v1/transfers/{row['id']}/action",
        json={
            "action": kind,
            "lock_version": row["lockVersion"],
            "comment": "Reviewed synthetic assignment",
        },
    )
    assert response.status_code == expected, response.text
    return response.json()


@pytest.mark.asyncio
async def test_transfer_review_atomic_apply_scope_history_and_concurrency(client: AsyncClient):
    owner, _ = await owner_client(client)
    employee, payload, clients = await fixture(owner)
    hr, reviewer, own = clients
    try:
        assert (await own.post("/api/v1/transfers", json=payload)).status_code == 403
        row = await create(hr, payload)
        assert row["current"]["designation_id"] != row["proposed"]["designation_id"]
        assert (await own.get(f"/api/v1/transfers/{row['id']}")).json()["history"] == []
        outsider = await create_activated_user(owner)
        outsider_client = await spawned_client()
        try:
            await authenticate(outsider_client, outsider["email"], "UserPass1!")
            assert (await outsider_client.get(f"/api/v1/transfers/{row['id']}")).status_code == 404
        finally:
            await outsider_client.aclose()
        results = await asyncio.gather(
            *[
                hr.post(
                    f"/api/v1/transfers/{row['id']}/action",
                    json={
                        "action": "submit",
                        "lock_version": row["lockVersion"],
                        "comment": "Submit once",
                    },
                )
                for _ in range(2)
            ]
        )
        assert sorted(r.status_code for r in results) == [200, 409]
        submitted = next(r.json() for r in results if r.status_code == 200)
        await action(hr, submitted, "review", 403)
        reviewed = await action(reviewer, submitted, "review")
        await action(hr, reviewed, "approve", 403)
        applied = await action(owner, reviewed, "approve")
        assert applied["status"] == "Applied"
        assert applied["approvedById"] is not None
        assert [e["action"] for e in applied["history"]] == [
            "create",
            "submit",
            "review",
            "approve",
            "apply",
        ]
        current = (await owner.get(f"/api/v1/users/{employee['id']}")).json()
        assert current["designation"]["id"] == payload["proposed"]["designation_id"]
        assert (
            await hr.patch(
                f"/api/v1/transfers/{row['id']}",
                json={**payload, "lock_version": applied["lockVersion"]},
            )
        ).status_code == 422  # employee is immutable
        editable = {k: v for k, v in payload.items() if k != "employee_id"}
        assert (
            await hr.patch(
                f"/api/v1/transfers/{row['id']}",
                json={**editable, "lock_version": applied["lockVersion"]},
            )
        ).status_code == 409
        await action(owner, reviewed, "approve", 409)
    finally:
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_transfer_future_cancel_supersede_backdate_and_changed_assignment(client):
    owner, _ = await owner_client(client)
    employee, payload, clients = await fixture(owner)
    hr, reviewer, _ = clients
    try:
        past = {**payload, "effective_date": (business_today() - timedelta(days=1)).isoformat()}
        assert (await hr.post("/api/v1/transfers", json=past)).status_code == 422
        assert (await owner.post("/api/v1/transfers", json=past)).status_code == 422
        past_row = await create(owner, {**past, "backdate_reason": "Audited historical correction"})
        await action(owner, past_row, "cancel")
        future = {**payload, "effective_date": (business_today() + timedelta(days=2)).isoformat()}
        row = await create(hr, future)
        row = await action(hr, row, "submit")
        row = await action(reviewer, row, "review")
        row = await action(owner, row, "approve")
        assert row["status"] == "Approved" and row["appliedAt"] is None
        assert (await owner.get(f"/api/v1/users/{employee['id']}")).json()["designation"][
            "id"
        ] == row["current"]["designation_id"]
        await action(owner, row, "apply", 409)
        await action(hr, row, "cancel", 403)
        replacement = await create(hr, {**future, "supersedes_id": row["id"]})
        replacement = await action(hr, replacement, "submit")
        replacement = await action(reviewer, replacement, "review")
        replacement = await action(owner, replacement, "approve")
        assert (await owner.get(f"/api/v1/transfers/{row['id']}")).json()["status"] == "Superseded"
        await action(owner, replacement, "cancel")
        changed = await create(hr, payload)
        changed = await action(hr, changed, "submit")
        changed = await action(reviewer, changed, "review")
        modified = await owner.patch(
            f"/api/v1/users/{employee['id']}",
            json={"designation_id": payload["proposed"]["designation_id"]},
        )
        assert modified.status_code == 200, modified.text
        conflict = await action(owner, changed, "approve", 409)
        assert conflict["error"]["code"] == "TRANSFER_ASSIGNMENT_CHANGED"
        unchanged = (await owner.get(f"/api/v1/transfers/{changed['id']}")).json()
        assert unchanged["status"] == "Reviewed"
        assert all(e["action"] != "approve" for e in unchanged["history"])
    finally:
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_transfer_apply_database_failure_rolls_back_assignments_and_history(client):
    owner, _ = await owner_client(client)
    employee, payload, clients = await fixture(owner)
    hr, reviewer, _ = clients
    constraint = f"test_transfer_failure_{unique_tag()}"
    try:
        row = await create(hr, payload)
        row = await action(hr, row, "submit")
        row = await action(reviewer, row, "review")
        async with app.state.session_factory() as session:
            await session.execute(
                text(
                    f"ALTER TABLE employee_transfers ADD CONSTRAINT {constraint} "
                    f"CHECK (id <> '{row['id']}'::uuid OR status <> 'Applied')"
                )
            )
            await session.commit()
        await action(owner, row, "approve", 409)
        current = (await owner.get(f"/api/v1/users/{employee['id']}")).json()
        assert current["designation"]["id"] == row["current"]["designation_id"]
        unchanged = (await owner.get(f"/api/v1/transfers/{row['id']}")).json()
        assert unchanged["lockVersion"] == row["lockVersion"]
        assert unchanged["history"] == row["history"]
    finally:
        async with app.state.session_factory() as session:
            await session.execute(
                text(f"ALTER TABLE employee_transfers DROP CONSTRAINT IF EXISTS {constraint}")
            )
            await session.commit()
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_transfer_manager_recommendation_is_direct_team_only_and_pro_denied(client):
    owner, _ = await owner_client(client)
    offices = (await owner.get("/api/v1/offices")).json()["items"]
    assert len(offices) >= 2
    groups = []
    for office in offices[:2]:
        department = await owner.post(
            "/api/v1/departments",
            json={
                "code": f"D{unique_tag()}",
                "name": "Synthetic transfer department",
                "office_id": office["id"],
            },
        )
        assert department.status_code == 200, department.text
        team = await owner.post(
            "/api/v1/teams",
            json={
                "code": f"T{unique_tag()}",
                "name": "Synthetic transfer team",
                "office_id": office["id"],
                "department_id": department.json()["id"],
            },
        )
        assert team.status_code == 200, team.text
        groups.append(
            {
                "office_id": office["id"],
                "department_id": department.json()["id"],
                "team_id": team.json()["id"],
            }
        )
    leader = await create_activated_user(owner, user_type_code="TL", **groups[0])
    employee = await create_activated_user(owner, manager_id=leader["id"], **groups[0])
    outsider = await create_activated_user(owner, **groups[1])
    pro = await create_activated_user(owner, user_type_code="PRO")
    leader_client, pro_client = await spawned_client(), await spawned_client()
    try:
        await authenticate(leader_client, leader["email"], "UserPass1!")
        await authenticate(pro_client, pro["email"], "UserPass1!")
        payload = {
            "employee_id": employee["id"],
            "proposed": {
                **groups[1],
                "designation_id": employee["designation"]["id"],
                "reporting_manager_id": leader["id"],
            },
            "reason": "Manager recommendation",
            "effective_date": business_today().isoformat(),
        }
        response = await leader_client.post("/api/v1/transfers/recommend", json=payload)
        assert response.status_code == 200, response.text
        row = response.json()
        assert row["status"] == "Submitted"
        assert (await leader_client.post("/api/v1/transfers", json=payload)).status_code == 403
        assert (
            await leader_client.post(
                "/api/v1/transfers/recommend", json={**payload, "employee_id": outsider["id"]}
            )
        ).status_code == 404
        assert (await pro_client.get(f"/api/v1/transfers/{row['id']}")).status_code == 403
        assert (await pro_client.get("/api/v1/transfers/options")).status_code == 403
        await action(leader_client, row, "approve", 403)
        editable = {key: value for key, value in payload.items() if key != "employee_id"}
        assert (
            await leader_client.patch(
                f"/api/v1/transfers/{row['id']}",
                json={**editable, "lock_version": row["lockVersion"]},
            )
        ).status_code == 403
    finally:
        await leader_client.aclose()
        await pro_client.aclose()


@pytest.mark.asyncio
async def test_transfer_due_executor_applies_once_and_records_blocked_schedule(client, monkeypatch):
    owner, _ = await owner_client(client)
    employee, payload, clients = await fixture(owner)
    hr, reviewer, _ = clients
    try:
        due = business_today() + timedelta(days=3)
        future = {**payload, "effective_date": due.isoformat()}
        row = await create(hr, future)
        row = await action(hr, row, "submit")
        row = await action(reviewer, row, "review")
        row = await action(owner, row, "approve")
        assert row["status"] == "Approved"
        await transfer_service.apply_due_transfers(app.state.session_factory)
        assert (await owner.get(f"/api/v1/transfers/{row['id']}")).json()["status"] == "Approved"
        # Advance only the business clock; real database transactions/authorization still run.
        monkeypatch.setattr(transfer_service, "today", lambda: due)
        await asyncio.gather(
            *(transfer_service.apply_due_transfers(app.state.session_factory) for _ in range(2))
        )
        applied = (await owner.get(f"/api/v1/transfers/{row['id']}")).json()
        assert applied["status"] == "Applied"
        assert sum(e["action"] == "apply" for e in applied["history"]) == 1
        assert (await owner.get(f"/api/v1/users/{employee['id']}")).json()["designation"][
            "id"
        ] == payload["proposed"]["designation_id"]
        await transfer_service.apply_due_transfers(app.state.session_factory)
        assert (await owner.get(f"/api/v1/transfers/{row['id']}")).json()["lockVersion"] == applied[
            "lockVersion"
        ]
        other = await create_activated_user(owner)
        later = due + timedelta(days=2)
        blocked = await create(
            hr, {**future, "employee_id": other["id"], "effective_date": later.isoformat()}
        )
        blocked = await action(hr, blocked, "submit")
        blocked = await action(reviewer, blocked, "review")
        blocked = await action(owner, blocked, "approve")
        changed = await owner.patch(
            f"/api/v1/users/{other['id']}",
            json={"designation_id": payload["proposed"]["designation_id"]},
        )
        assert changed.status_code == 200, changed.text
        monkeypatch.setattr(transfer_service, "today", lambda: later)
        await transfer_service.apply_due_transfers(app.state.session_factory)
        failed = (await owner.get(f"/api/v1/transfers/{blocked['id']}")).json()
        assert failed["status"] == "Approved"
        assert failed["applicationError"] == "TRANSFER_ASSIGNMENT_CHANGED"
        await transfer_service.apply_due_transfers(app.state.session_factory)
        assert (await owner.get(f"/api/v1/transfers/{blocked['id']}")).json()[
            "lockVersion"
        ] == failed["lockVersion"]
    finally:
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_transfer_return_edit_reject_and_required_comment(client):
    owner, _ = await owner_client(client)
    _, payload, clients = await fixture(owner)
    hr, reviewer, _ = clients
    try:
        row = await create(hr, payload)
        row = await action(hr, row, "submit")
        invalid = await reviewer.post(
            f"/api/v1/transfers/{row['id']}/action",
            json={"action": "return", "lock_version": row["lockVersion"], "comment": "   "},
        )
        assert invalid.status_code == 422
        returned = await action(reviewer, row, "return")
        assert returned["status"] == "Returned"
        draft = {key: value for key, value in payload.items() if key != "employee_id"}
        edited = await hr.patch(
            f"/api/v1/transfers/{row['id']}",
            json={
                **draft,
                "reason": "Corrected transfer reason",
                "lock_version": returned["lockVersion"],
            },
        )
        assert edited.status_code == 200, edited.text
        updated = edited.json()
        assert updated["status"] == "Draft"
        assert updated["reason"] == "Corrected transfer reason"
        assert updated["history"][: len(returned["history"])] == returned["history"]
        updated = await action(hr, updated, "submit")
        rejected = await action(reviewer, updated, "reject")
        assert rejected["status"] == "Rejected"
        await action(owner, rejected, "approve", 409)
        assert (
            await hr.patch(
                f"/api/v1/transfers/{row['id']}",
                json={**draft, "lock_version": rejected["lockVersion"]},
            )
        ).status_code == 409
    finally:
        for actor in clients:
            await actor.aclose()
