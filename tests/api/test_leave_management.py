from __future__ import annotations

import asyncio
from datetime import date

import pytest
from helpers import authenticate, create_activated_user, owner_client, spawned_client
from httpx import AsyncClient


async def _annual_leave(owner: AsyncClient) -> dict:
    response = await owner.get("/api/v1/leave/types")
    assert response.status_code == 200, response.text
    annual = next(item for item in response.json()["items"] if item["code"] == "ANNUAL")
    configured = await owner.patch(
        f"/api/v1/leave/types/{annual['id']}",
        json={
            "yearly_entitlement": 20,
            "accrual_method": "none",
            "carry_forward_limit": 5,
            "carry_forward_expiry_months": 3,
            "half_day_allowed": True,
            "attachment_required": False,
        },
    )
    assert configured.status_code == 200, configured.text
    return configured.json()


@pytest.mark.asyncio
async def test_leave_defaults_working_days_scope_and_two_step_approval(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    assert (
        await owner.put(
            "/api/v1/attendance/working-days", json={"weekdays": [0, 1, 2, 3, 4]}
        )
    ).status_code == 200
    annual = await _annual_leave(owner)
    manager = await create_activated_user(owner, user_type_code="TL")
    employee = await create_activated_user(
        owner, user_type_code="SE", manager_id=manager["id"]
    )
    outsider = await create_activated_user(owner, user_type_code="SE")
    hr = await create_activated_user(
        owner, user_type_code="HR", manager_id=manager["id"]
    )

    employee_client = await spawned_client()
    manager_client = await spawned_client()
    outsider_client = await spawned_client()
    hr_client = await spawned_client()
    try:
        await authenticate(employee_client, employee["email"], "UserPass1!")
        await authenticate(manager_client, manager["email"], "UserPass1!")
        await authenticate(outsider_client, outsider["email"], "UserPass1!")
        await authenticate(hr_client, hr["email"], "UserPass1!")

        created = await employee_client.post(
            "/api/v1/leave/requests",
            json={
                "leave_type_id": annual["id"],
                "start_date": "2027-02-01",
                "end_date": "2027-02-03",
                "portion": "full_day",
                "reason": "Synthetic private leave reason",
                "submit": True,
            },
        )
        assert created.status_code == 200, created.text
        request = created.json()
        assert request["status"] == "Submitted"
        assert request["workingDays"] == 3

        denied = await outsider_client.get(f"/api/v1/leave/requests/{request['id']}")
        assert denied.status_code == 404

        manager_view = await manager_client.get(
            f"/api/v1/leave/requests/{request['id']}"
        )
        assert manager_view.status_code == 200, manager_view.text
        assert manager_view.json()["reason"] is None
        approved_manager = await manager_client.post(
            f"/api/v1/leave/requests/{request['id']}/manager-approve",
            json={"lock_version": manager_view.json()["lockVersion"]},
        )
        assert approved_manager.status_code == 200, approved_manager.text
        assert approved_manager.json()["status"] == "Manager Approved"

        self_approval = await employee_client.post(
            f"/api/v1/leave/requests/{request['id']}/hr-approve",
            json={"lock_version": approved_manager.json()["lockVersion"]},
        )
        assert self_approval.status_code == 403

        approved_hr = await hr_client.post(
            f"/api/v1/leave/requests/{request['id']}/hr-approve",
            json={"lock_version": approved_manager.json()["lockVersion"]},
        )
        assert approved_hr.status_code == 200, approved_hr.text
        assert approved_hr.json()["status"] == "HR Approved"
        assert [item["action"] for item in approved_hr.json()["history"]][-3:] == [
            "submit",
            "manager-approve",
            "hr-approve",
        ]

        own_hr_request = await hr_client.post(
            "/api/v1/leave/requests",
            json={
                "leave_type_id": annual["id"],
                "start_date": "2027-02-08",
                "end_date": "2027-02-08",
                "portion": "full_day",
                "reason": "Synthetic HR self-approval check",
                "submit": True,
            },
        )
        assert own_hr_request.status_code == 200, own_hr_request.text
        own_manager_approval = await manager_client.post(
            f"/api/v1/leave/requests/{own_hr_request.json()['id']}/manager-approve",
            json={"lock_version": own_hr_request.json()["lockVersion"]},
        )
        assert own_manager_approval.status_code == 200, own_manager_approval.text
        own_hr_denied = await hr_client.post(
            f"/api/v1/leave/requests/{own_hr_request.json()['id']}/hr-approve",
            json={"lock_version": own_manager_approval.json()["lockVersion"]},
        )
        assert own_hr_denied.status_code == 403
        assert own_hr_denied.json()["error"]["code"] == "SELF_APPROVAL_FORBIDDEN"

        calendar = await manager_client.get(
            "/api/v1/leave/team-calendar",
            params={"date_from": "2027-02-01", "date_to": "2027-02-28"},
        )
        assert calendar.status_code == 200, calendar.text
        assert calendar.json()["items"] == [
            {
                "employee": employee["fullName"],
                "startDate": "2027-02-01",
                "endDate": "2027-02-03",
                "status": "HR Approved",
            }
        ]
        assert "reason" not in calendar.text.casefold()

        cancellation = await employee_client.post(
            f"/api/v1/leave/requests/{request['id']}/cancel",
            json={
                "lock_version": approved_hr.json()["lockVersion"],
                "reason": "Synthetic approved cancellation",
            },
        )
        assert cancellation.status_code == 200, cancellation.text
        assert cancellation.json()["status"] == "Cancellation Pending"
        manager_cancellation = await manager_client.post(
            f"/api/v1/leave/requests/{request['id']}/cancellation-decision",
            json={
                "lock_version": cancellation.json()["lockVersion"],
                "approve": True,
                "comment": "Synthetic manager cancellation approval",
            },
        )
        assert manager_cancellation.status_code == 200, manager_cancellation.text
        assert manager_cancellation.json()["cancellationManagerApproved"] is True
        hr_cancellation = await hr_client.post(
            f"/api/v1/leave/requests/{request['id']}/cancellation-decision",
            json={
                "lock_version": manager_cancellation.json()["lockVersion"],
                "approve": True,
                "comment": "Synthetic HR cancellation approval",
            },
        )
        assert hr_cancellation.status_code == 200, hr_cancellation.text
        assert hr_cancellation.json()["status"] == "Cancelled"
        assert [item["action"] for item in hr_cancellation.json()["history"]][-3:] == [
            "cancel",
            "cancellation-manager-approve",
            "cancellation-approve",
        ]
    finally:
        await employee_client.aclose()
        await manager_client.aclose()
        await outsider_client.aclose()
        await hr_client.aclose()


@pytest.mark.asyncio
async def test_leave_overlap_balance_attachment_cancellation_and_concurrency(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    await owner.put(
        "/api/v1/attendance/working-days", json={"weekdays": [0, 1, 2, 3, 4]}
    )
    annual = await _annual_leave(owner)
    manager = await create_activated_user(owner, user_type_code="TL")
    employee = await create_activated_user(
        owner, user_type_code="SE", manager_id=manager["id"]
    )
    employee_client = await spawned_client()
    manager_client = await spawned_client()
    try:
        await authenticate(employee_client, employee["email"], "UserPass1!")
        await authenticate(manager_client, manager["email"], "UserPass1!")
        draft = await employee_client.post(
            "/api/v1/leave/requests",
            json={
                "leave_type_id": annual["id"],
                "start_date": "2027-03-01",
                "end_date": "2027-03-02",
                "reason": "Synthetic attachment lifecycle",
            },
        )
        assert draft.status_code == 200, draft.text
        request = draft.json()

        invalid_file = await employee_client.post(
            f"/api/v1/leave/requests/{request['id']}/attachment",
            files={"upload": ("unsafe.png", b"not an image", "image/png")},
        )
        assert invalid_file.status_code == 422, invalid_file.text
        pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"
        attached = await employee_client.post(
            f"/api/v1/leave/requests/{request['id']}/attachment",
            files={"upload": ("leave.pdf", pdf, "application/pdf")},
        )
        assert attached.status_code == 200, attached.text

        concurrent = await asyncio.gather(
            employee_client.post(
                f"/api/v1/leave/requests/{request['id']}/submit",
                json={
                    "lock_version": attached.json().get(
                        "lockVersion", request["lockVersion"]
                    )
                },
            ),
            employee_client.post(
                f"/api/v1/leave/requests/{request['id']}/submit",
                json={
                    "lock_version": attached.json().get(
                        "lockVersion", request["lockVersion"]
                    )
                },
            ),
        )
        assert sorted(response.status_code for response in concurrent) == [200, 409]
        overlap = await employee_client.post(
            "/api/v1/leave/requests",
            json={
                "leave_type_id": annual["id"],
                "start_date": "2027-03-02",
                "end_date": "2027-03-03",
                "reason": "Synthetic overlap",
                "submit": True,
            },
        )
        assert overlap.status_code == 409
        assert overlap.json()["error"]["code"] == "LEAVE_OVERLAP"

        manager_view = await manager_client.get(
            f"/api/v1/leave/requests/{request['id']}"
        )
        manager_approved = await manager_client.post(
            f"/api/v1/leave/requests/{request['id']}/manager-approve",
            json={"lock_version": manager_view.json()["lockVersion"]},
        )
        assert manager_approved.status_code == 200, manager_approved.text
        cancelled = await employee_client.post(
            f"/api/v1/leave/requests/{request['id']}/cancel",
            json={
                "lock_version": manager_approved.json()["lockVersion"],
                "reason": "Synthetic cancellation",
            },
        )
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "Cancelled"

        balances = await employee_client.get(
            f"/api/v1/leave/employees/{employee['id']}/balances", params={"year": 2027}
        )
        assert balances.status_code == 200, balances.text
        annual_balance = next(
            item
            for item in balances.json()["items"]
            if item["leaveType"]["code"] == "ANNUAL"
        )
        assert annual_balance["available"] == 20
    finally:
        await employee_client.aclose()
        await manager_client.aclose()


def test_leave_date_examples_are_stable() -> None:
    assert date(2027, 2, 1).weekday() == 0
