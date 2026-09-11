import asyncio
from datetime import timedelta
from uuid import UUID

import pytest
from helpers import (
    authenticate,
    business_today,
    create_activated_user,
    office_id,
    spawned_client,
    unique_tag,
)
from nexa_bos_api.approvals import service as approvals
from nexa_bos_api.approvals.schemas import Decision
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import load_user_with_type
from nexa_bos_api.identity.models import User
from nexa_bos_api.main import app
from sqlalchemy import text
from test_contracts import _contract_type, _create_contract, _signed_attachment
from test_exits import decision as exit_action
from test_exits import draft, fixtures, ready
from test_exits import hr_scope as hr_scope
from test_leave_management import _annual_leave
from test_transfers import action as transfer_action
from test_transfers import create as create_transfer


async def decide(actor, module, row, action, expected=200, comment="Reviewed synthetic request"):
    response = await actor.post(
        f"/api/v1/approvals/{module}/{row['id']}/decision",
        json={"action": action, "lock_version": row["lockVersion"], "comment": comment},
    )
    assert response.status_code == expected, response.text
    return response


async def items(actor, query=""):
    response = await actor.get(f"/api/v1/approvals{query}")
    assert response.status_code == 200, response.text
    return response.json()["items"]


@pytest.mark.asyncio
async def test_approval_leave_scope_filters_cancellation_concurrency_and_personal(client):
    owner, employee, operator, manager, clients = await fixtures(client)
    own, hr, lead = clients
    outsider = await create_activated_user(owner, user_type_code="TL")
    outsider_client = await spawned_client()
    try:
        await authenticate(outsider_client, outsider["email"], "UserPass1!")
        annual = await _annual_leave(owner)
        assert (
            await owner.put(
                "/api/v1/attendance/working-days", json={"weekdays": [0, 1, 2, 3, 4, 5, 6]}
            )
        ).status_code == 200
        response = await own.post(
            "/api/v1/leave/requests",
            json={
                "leave_type_id": annual["id"],
                "start_date": "2027-03-09",
                "end_date": "2027-03-09",
                "reason": "Private synthetic medical reason",
                "submit": True,
            },
        )
        assert response.status_code == 200, response.text
        row = response.json()
        assert (await own.get("/api/v1/approvals")).status_code == 403
        assert not any(item["id"] == row["id"] for item in await items(outsider_client))
        await decide(outsider_client, "Leave", row, "approve", 404)
        scoped = await items(
            lead,
            f"?module=Leave&employee={employee['id']}&requester={employee['id']}&approver={manager['id']}&status=Submitted",
        )
        assert len(scoped) == 1 and scoped[0]["actions"] == ["approve", "reject", "return"]
        assert "reason" not in scoped[0] and "attachments" not in scoped[0]
        assert await items(lead, f"?employee={employee['id']}&date_from=2099-01-01") == []
        assert (
            await lead.get("/api/v1/approvals?date_from=2027-03-10&date_to=2027-03-09")
        ).status_code == 422
        await decide(lead, "Leave", row, "approve", 422, "  ")
        responses = await asyncio.gather(
            *[
                lead.post(
                    f"/api/v1/approvals/Leave/{row['id']}/decision",
                    json={
                        "action": "approve",
                        "lock_version": row["lockVersion"],
                        "comment": "Independent review",
                    },
                )
                for _ in range(2)
            ]
        )
        assert sorted(response.status_code for response in responses) == [200, 409]
        row = (await hr.get(f"/api/v1/leave/requests/{row['id']}")).json()
        assert row["status"] == "Manager Approved"
        await decide(hr, "Leave", row, "approve")
        row = (await own.get(f"/api/v1/leave/requests/{row['id']}")).json()
        cancellation = await own.post(
            f"/api/v1/leave/requests/{row['id']}/cancel",
            json={"lock_version": row["lockVersion"], "reason": "Cancel synthetic request"},
        )
        assert cancellation.status_code == 200, cancellation.text
        row = cancellation.json()
        await decide(hr, "Leave", row, "approve", 403)
        await decide(lead, "Leave", row, "approve")
        row = (await hr.get(f"/api/v1/leave/requests/{row['id']}")).json()
        await decide(hr, "Leave", row, "approve")
        own_data = (await own.get("/api/v1/approvals/me")).json()
        assert (
            own_data["requests"][0]["id"] == row["id"]
            and own_data["requests"][0]["status"] == "Cancelled"
        )
        assert own_data["balances"] and own_data["contract"] is None
        assert "Private synthetic" not in str(own_data)
        history = (await owner.get(f"/api/v1/leave/requests/{row['id']}")).json()["history"]
        assert sum(event["action"] == "manager-approve" for event in history) == 1
    finally:
        for actor in [*clients, outsider_client]:
            await actor.aclose()


@pytest.mark.asyncio
async def test_approval_contract_private_summary_actions_and_pro_denial(client):
    owner, employee, operator, manager, clients = await fixtures(client)
    own, hr, lead = clients
    pro = await create_activated_user(owner, user_type_code="PRO")
    pro_client = await spawned_client()
    try:
        await authenticate(pro_client, pro["email"], "UserPass1!")
        kind = await _contract_type(owner)
        row = await _create_contract(
            hr, employee_id=employee["id"], type_id=kind["id"], number=f"AP{unique_tag()}"
        )
        await _signed_attachment(hr, row["id"])
        row = (await hr.get(f"/api/v1/contracts/{row['id']}")).json()
        response = await hr.post(
            f"/api/v1/contracts/{row['id']}/submit", json={"lock_version": row["lockVersion"]}
        )
        assert response.status_code == 200, response.text
        row = response.json()
        queued = await items(owner, f"?module=Contracts&employee={employee['id']}")
        assert len(queued) == 1 and "basicSalary" not in str(queued) and "6000" not in str(queued)
        assert await items(lead, "?module=Contracts") == []
        await decide(lead, "Contracts", row, "approve", 404)
        await decide(hr, "Contracts", row, "return", 403)
        await decide(owner, "Contracts", row, "return")
        row = (await hr.get(f"/api/v1/contracts/{row['id']}")).json()
        row = (
            await hr.post(
                f"/api/v1/contracts/{row['id']}/submit", json={"lock_version": row["lockVersion"]}
            )
        ).json()
        await decide(owner, "Contracts", row, "approve")
        own_data = await own.get("/api/v1/approvals/me")
        assert own_data.status_code == 200, own_data.text
        assert own_data.json()["contract"]["id"] == row["id"]
        assert "basicSalary" not in own_data.text and "attachments" not in own_data.text
        assert (await pro_client.get("/api/v1/approvals")).status_code == 403
        assert (await pro_client.get("/api/v1/approvals/dashboard")).status_code == 403
        assert (await pro_client.get("/api/v1/approvals/me")).json() == {
            "balances": None,
            "requests": [],
            "contract": None,
            "transfers": [],
            "exits": [],
        }
    finally:
        for actor in [*clients, pro_client]:
            await actor.aclose()


@pytest.mark.asyncio
async def test_approval_transfer_exit_decisions_reminders_and_scope(client):
    owner, employee, operator, manager, clients = await fixtures(client)
    own, hr, lead = clients
    try:
        row = await create_transfer(
            hr,
            {
                "employee_id": employee["id"],
                "proposed": {
                    "office_id": await office_id(owner, "DXB"),
                    "department_id": None,
                    "team_id": None,
                    "designation_id": employee["designation"]["id"],
                    "reporting_manager_id": manager["id"],
                },
                "reason": "Synthetic proposed transfer",
                "effective_date": (business_today() + timedelta(days=2)).isoformat(),
            },
        )
        row = await transfer_action(hr, row, "submit")
        await decide(owner, "Transfers", row, "approve")
        row = (await owner.get(f"/api/v1/transfers/{row['id']}")).json()
        assert row["status"] == "Reviewed"
        await decide(owner, "Transfers", row, "approve")
        row = (await owner.get(f"/api/v1/transfers/{row['id']}")).json()
        assert row["status"] == "Approved"
        await transfer_action(owner, row, "cancel")
        data = draft(
            employee,
            notice_date=(business_today() - timedelta(days=2)).isoformat(),
            last_working_date=(business_today() - timedelta(days=1)).isoformat(),
        )
        response = await own.post("/api/v1/exits", json=data)
        assert response.status_code == 200, response.text
        row = await exit_action(own, response.json(), "submit")
        queued = await items(hr, f"?module=Exit&employee={employee['id']}")
        assert queued[0]["overdue"] and queued[0]["actions"] == ["approve", "reject", "return"]
        for _ in range(2):
            response = await hr.post("/api/v1/approvals/reminders")
            assert response.status_code == 200, response.text
        async with app.state.session_factory() as session:
            count = await session.scalar(
                text("SELECT count(*) FROM notifications WHERE deduplication_key LIKE :key"),
                {"key": f"hr.approval:{operator['id']}:Exit:{row['id']}:%"},
            )
            assert count == 1
        await decide(hr, "Exit", row, "approve")
        own_data = (await own.get("/api/v1/approvals/me")).json()
        assert own_data["exits"][0]["status"] == "Notice Period"
        assert (await own.get("/api/v1/auth/me")).status_code == 200
        await exit_action(hr, (await hr.get(f"/api/v1/exits/{row['id']}")).json(), "cancel")
        row = await ready(owner, employee, operator, manager, clients)
        await decide(owner, "Exit", row, "approve")
        assert (await own.get("/api/v1/auth/me")).status_code == 401
    finally:
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_approval_hr_office_scope_fails_closed(client):
    owner, employee, operator, manager, clients = await fixtures(client)
    own, hr, lead = clients
    try:
        dxb = await office_id(owner, "DXB")
        auh = await office_id(owner, "AUH")
        assert (
            await owner.patch(f"/api/v1/users/{employee['id']}", json={"office_id": dxb})
        ).status_code == 200
        assert (
            await owner.patch(f"/api/v1/users/{operator['id']}", json={"office_id": auh})
        ).status_code == 200
        role = next(
            row
            for row in (await owner.get("/api/v1/user-types")).json()["items"]
            if row["code"] == "HR"
        )
        assert (
            await owner.put(
                f"/api/v1/user-types/{role['id']}/scope", json={"visibility_scope": "office"}
            )
        ).status_code == 200
        row = (await own.post("/api/v1/exits", json=draft(employee))).json()
        row = await exit_action(own, row, "submit")
        assert (await hr.get("/api/v1/approvals")).status_code == 401
        await authenticate(hr, operator["email"], "UserPass1!")
        assert await items(hr, f"?employee={employee['id']}") == []
        await decide(hr, "Exit", row, "approve", 404)
        assert (await hr.get("/api/v1/approvals/dashboard")).json()["exitsInProgress"] == 0
        await decide(owner, "Exit", row, "approve")
    finally:
        for actor in clients:
            await actor.aclose()


@pytest.mark.asyncio
async def test_approval_reloads_employee_assignment_before_locked_decision(client):
    owner, employee, _, manager, clients = await fixtures(client)
    own, _, _ = clients
    try:
        annual = await _annual_leave(owner)
        assert (
            await owner.put("/api/v1/attendance/working-days", json={"weekdays": list(range(7))})
        ).status_code == 200
        response = await own.post(
            "/api/v1/leave/requests",
            json={
                "leave_type_id": annual["id"],
                "start_date": "2027-03-11",
                "end_date": "2027-03-11",
                "reason": "Synthetic scope race",
                "submit": True,
            },
        )
        assert response.status_code == 200, response.text
        row = response.json()
        async with app.state.session_factory() as session:
            actor = await load_user_with_type(session, UUID(manager["id"]))
            cached = await session.get(User, UUID(employee["id"]))
            assert cached.reporting_manager_id == actor.id
            # A real separately committed assignment change after the summary
            # was loaded; no mocks, sleeps or successful-response substitution.
            async with app.state.session_factory() as change:
                await change.execute(
                    text("UPDATE users SET reporting_manager_id=NULL WHERE id=:employee"),
                    {"employee": UUID(employee["id"])},
                )
                await change.commit()
            with pytest.raises(AppError) as denied:
                await approvals.decide(
                    session,
                    actor,
                    "Leave",
                    UUID(row["id"]),
                    Decision(action="approve", lock_version=row["lockVersion"], comment="Review"),
                )
            assert denied.value.status_code == 404
        unchanged = (await own.get(f"/api/v1/leave/requests/{row['id']}")).json()
        assert unchanged["status"] == "Submitted"
        assert unchanged["lockVersion"] == row["lockVersion"]
    finally:
        for actor in clients:
            await actor.aclose()
