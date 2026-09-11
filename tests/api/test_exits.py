from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
import pytest_asyncio
from helpers import (
    authenticate,
    business_today,
    create_activated_user,
    office_id,
    owner_client,
    spawned_client,
    unique_tag,
)
from nexa_bos_api.main import app
from sqlalchemy import text
from test_assets import _create_pc


@pytest_asyncio.fixture(autouse=True)
async def hr_scope(client):
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


async def fixtures(client):
    owner, _ = await owner_client(client)
    roles = (await owner.get("/api/v1/user-types")).json()["items"]
    hr = next(role for role in roles if role["code"] == "HR")
    assert (
        await owner.put(
            f"/api/v1/user-types/{hr['id']}/scope", json={"visibility_scope": "company"}
        )
    ).status_code == 200
    manager = await create_activated_user(owner, user_type_code="TL")
    employee = await create_activated_user(owner, manager_id=manager["id"])
    operator = await create_activated_user(owner, user_type_code="HR")
    clients = [await spawned_client() for _ in range(3)]
    for actor, user in zip(clients, (employee, operator, manager), strict=True):
        await authenticate(actor, user["email"], "UserPass1!")
    return owner, employee, operator, manager, clients


def draft(employee, **extra):
    return {
        "employee_id": employee["id"],
        "exit_type": "Resignation",
        "notice_date": business_today().isoformat(),
        "last_working_date": business_today().isoformat(),
        "reason": "Synthetic exit review",
        **extra,
    }


async def decision(actor, row, action, expected=200):
    response = await actor.post(
        f"/api/v1/exits/{row['id']}/action",
        json={
            "action": action,
            "lock_version": row["lockVersion"],
            "comment": "Synthetic reviewed decision",
        },
    )
    assert response.status_code == expected, response.text
    return response.json()


async def ready(owner, employee, operator, manager, clients, **extra):
    own, hr, lead = clients
    data = draft(employee, **extra)
    creator = own if data["exit_type"] == "Resignation" else hr
    reviewer = hr if creator is own else owner
    response = await creator.post("/api/v1/exits", json=data)
    assert response.status_code == 200, response.text
    row = await decision(creator, response.json(), "submit")
    row = await decision(reviewer, row, "notice")
    row = await decision(reviewer, row, "clearance")
    owner_id = (await owner.get("/api/v1/auth/me")).json()["id"]
    for key in ("manager", "assets", "it", "finance", "hr", "approval"):
        actor, assignee = (
            (lead, manager["id"])
            if key == "manager"
            else (owner, owner_id)
            if key == "approval"
            else (hr, operator["id"])
        )
        response = await owner.patch(
            f"/api/v1/exits/{row['id']}/checklist/{key}",
            json={
                "lock_version": row["lockVersion"],
                "assignee_id": assignee,
                "note": "Synthetic assignment",
            },
        )
        assert response.status_code == 200, response.text
        row = response.json()
        response = await actor.patch(
            f"/api/v1/exits/{row['id']}/checklist/{key}",
            json={
                "lock_version": row["lockVersion"],
                "status": "Cleared",
                "note": "Synthetic clearance confirmed",
            },
        )
        assert response.status_code == 200, response.text
        row = response.json()
    return await decision(reviewer, row, "ready")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exit_type,employment",
    [
        ("Resignation", "Resigned"),
        ("Termination", "Terminated"),
        ("End of Contract", "Inactive"),
        ("Other", "Inactive"),
    ],
)
async def test_exit_complete_revokes_only_at_completion_and_reopen_preserves_history(
    client, exit_type, employment
):
    owner, employee, operator, manager, clients = await fixtures(client)
    own, hr, _ = clients
    try:
        row = await ready(owner, employee, operator, manager, clients, exit_type=exit_type)
        assert (await own.get("/api/v1/auth/me")).status_code == 200
        assert (await owner.get(f"/api/v1/users/{employee['id']}")).json()[
            "accountStatus"
        ] == "active"
        await decision(hr, row, "complete", 403)
        completed = await decision(owner, row, "complete")
        assert completed["status"] == "Completed"
        assert (await own.get("/api/v1/auth/me")).status_code == 401
        user = (await owner.get(f"/api/v1/users/{employee['id']}")).json()
        assert user["accountStatus"] == "deactivated" and user["employmentStatus"] == employment
        assert len(completed["history"]) == len(row["history"]) + 1
        await decision(owner, row, "complete", 409)
        reopened = await decision(owner, completed, "reopen")
        assert reopened["status"] == "Clearance in Progress"
        assert all(item["status"] == "Pending" for item in reopened["checklist"])
        assert reopened["history"][:-1] == completed["history"]
        assert (await owner.get(f"/api/v1/users/{employee['id']}")).json()[
            "accountStatus"
        ] == "deactivated"
        assert (await own.get("/api/v1/auth/me")).status_code == 401
    finally:
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_exit_future_completion_and_required_comment_remain_fail_closed(client):
    owner, employee, operator, manager, clients = await fixtures(client)
    try:
        row = await ready(
            owner,
            employee,
            operator,
            manager,
            clients,
            last_working_date=(business_today() + timedelta(days=2)).isoformat(),
        )
        await decision(owner, row, "complete", 409)
        assert (await clients[0].get("/api/v1/auth/me")).status_code == 200
        assert (await owner.get(f"/api/v1/exits/{row['id']}")).json() == row
        response = await owner.post(
            f"/api/v1/exits/{row['id']}/action",
            json={"action": "cancel", "lock_version": row["lockVersion"], "comment": " "},
        )
        assert response.status_code == 422
    finally:
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_exit_scope_invalid_dates_self_approval_duplicate_and_concurrency(client):
    owner, employee, operator, manager, clients = await fixtures(client)
    own, hr, lead = clients
    try:
        assert (
            await own.post("/api/v1/exits", json=draft(employee, exit_type="Termination"))
        ).status_code == 403
        assert (await own.post("/api/v1/exits", json=draft(operator))).status_code == 404
        assert (
            await own.post(
                "/api/v1/exits",
                json=draft(
                    employee, last_working_date=(business_today() - timedelta(days=1)).isoformat()
                ),
            )
        ).status_code == 422
        owner_user = (await owner.get("/api/v1/auth/me")).json()
        assert (await owner.post("/api/v1/exits", json=draft(owner_user))).status_code == 403
        response = await own.post("/api/v1/exits", json=draft(employee))
        assert response.status_code == 200, response.text
        row = response.json()
        assert (await own.post("/api/v1/exits", json=draft(employee))).status_code == 409
        assert (await lead.get(f"/api/v1/exits/{row['id']}")).status_code == 404
        pro = await create_activated_user(owner, user_type_code="PRO")
        other = await spawned_client()
        try:
            await authenticate(other, pro["email"], "UserPass1!")
            assert (await other.get("/api/v1/exits")).status_code == 403
        finally:
            await other.aclose()
        results = await asyncio.gather(
            *[
                own.post(
                    f"/api/v1/exits/{row['id']}/action",
                    json={
                        "action": "submit",
                        "lock_version": row["lockVersion"],
                        "comment": "Submit once",
                    },
                )
                for _ in range(2)
            ]
        )
        assert sorted(response.status_code for response in results) == [200, 409]
        row = next(response.json() for response in results if response.status_code == 200)
        await decision(own, row, "notice", 403)
        returned = await decision(hr, row, "return")
        edited = await own.patch(
            f"/api/v1/exits/{row['id']}",
            json={
                **draft(employee, reason="Corrected synthetic request"),
                "lock_version": returned["lockVersion"],
            },
        )
        assert edited.status_code == 200, edited.text
        submitted = await decision(own, edited.json(), "submit")
        rejected = await decision(hr, submitted, "reject")
        assert rejected["status"] == "Cancelled"
        assert (await own.get("/api/v1/auth/me")).status_code == 200
    finally:
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_exit_clearance_assignment_privacy_and_completion_guards(client):
    owner, employee, operator, manager, clients = await fixtures(client)
    own, hr, lead = clients
    try:
        row = (await own.post("/api/v1/exits", json=draft(employee))).json()
        row = await decision(own, row, "submit")
        row = await decision(hr, row, "notice")
        row = await decision(hr, row, "clearance")
        await decision(hr, row, "ready", 409)
        path = f"/api/v1/exits/{row['id']}/checklist/manager"
        assert (
            await own.patch(
                path,
                json={"lock_version": row["lockVersion"], "status": "Cleared", "note": "Forbidden"},
            )
        ).status_code == 403
        response = await owner.patch(
            path,
            json={
                "lock_version": row["lockVersion"],
                "assignee_id": manager["id"],
                "note": "Assigned handover",
            },
        )
        assert response.status_code == 200, response.text
        row = response.json()
        viewed = (await lead.get(f"/api/v1/exits/{row['id']}")).json()
        assert [item["key"] for item in viewed["checklist"]] == ["manager"]
        assert (
            viewed["settlementStatus"] is None
            and viewed["reason"] is None
            and viewed["history"] == []
        )
        assert (
            await lead.patch(
                f"/api/v1/exits/{row['id']}/checklist/it",
                json={"lock_version": row["lockVersion"], "status": "Cleared", "note": "Forbidden"},
            )
        ).status_code == 403
        assert (
            await lead.patch(
                path, json={"lock_version": row["lockVersion"], "status": "Cleared", "note": " "}
            )
        ).status_code == 422
        settlement = await hr.patch(
            f"/api/v1/exits/{row['id']}/settlement",
            json={
                "lock_version": row["lockVersion"],
                "status": "Pending",
                "reference": "FAKE-SETTLEMENT",
                "comment": "Reference only, no calculation",
            },
        )
        assert settlement.status_code == 200, settlement.text
        assert (await own.get(f"/api/v1/exits/{row['id']}")).json()["settlementReference"] is None
        cancelled = await decision(hr, settlement.json(), "cancel")
        assert cancelled["status"] == "Cancelled"
        assert (await own.get("/api/v1/auth/me")).status_code == 200
    finally:
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_exit_completion_transaction_rolls_back_account_sessions_and_events(client):
    owner, employee, operator, manager, clients = await fixtures(client)
    constraint = f"test_exit_rollback_{unique_tag()}"
    try:
        row = await ready(owner, employee, operator, manager, clients)
        async with app.state.session_factory() as session:
            await session.execute(
                text(
                    f"ALTER TABLE employee_exits ADD CONSTRAINT {constraint} "
                    f"CHECK (id <> '{row['id']}'::uuid OR status <> 'Completed')"
                )
            )
            await session.commit()
        await decision(owner, row, "complete", 409)
        after = (await owner.get(f"/api/v1/exits/{row['id']}")).json()
        assert after == row
        user = (await owner.get(f"/api/v1/users/{employee['id']}")).json()
        assert user["accountStatus"] == "active" and user["employmentStatus"] == "Active"
        assert (await clients[0].get("/api/v1/auth/me")).status_code == 200
    finally:
        async with app.state.session_factory() as session:
            await session.execute(
                text(f"ALTER TABLE employee_exits DROP CONSTRAINT IF EXISTS {constraint}")
            )
            await session.commit()
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_exit_requires_existing_asset_return_without_mutating_custody(client):
    owner, employee, operator, manager, clients = await fixtures(client)
    try:
        office = await office_id(owner, "DXB")
        changed = await owner.patch(f"/api/v1/users/{employee['id']}", json={"office_id": office})
        assert changed.status_code == 200, changed.text
        asset = await _create_pc(owner, office)
        allocated = await owner.post(
            f"/api/v1/assets/{asset['id']}/allocate",
            json={
                "employee_id": employee["id"],
                "issue_date": business_today().isoformat(),
                "condition_at_issue": "Good",
            },
        )
        assert allocated.status_code == 200, allocated.text
        row = await ready(owner, employee, operator, manager, clients)
        history = (await owner.get(f"/api/v1/assets/{asset['id']}/history")).json()
        await decision(owner, row, "complete", 409)
        assert (await owner.get(f"/api/v1/assets/{asset['id']}/history")).json() == history
        assert (await clients[0].get("/api/v1/auth/me")).status_code == 200
        returned = await owner.post(
            f"/api/v1/assets/{asset['id']}/return",
            json={
                "return_date": business_today().isoformat(),
                "return_condition": "Good",
                "remarks": "Synthetic offboarding return",
            },
        )
        assert returned.status_code == 200, returned.text
        assert (await decision(owner, row, "complete"))["status"] == "Completed"
    finally:
        for actor in clients:
            await actor.aclose()
