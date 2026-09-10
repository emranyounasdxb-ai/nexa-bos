from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from helpers import (
    authenticate,
    business_today,
    create_activated_user,
    owner_client,
    spawned_client,
    unique_tag,
)
from httpx import AsyncClient


async def _contract_type(client: AsyncClient) -> dict:
    tag = unique_tag().upper()
    response = await client.post(
        "/api/v1/contracts/types",
        json={"code": f"FT{tag}", "name": f"Fixed term {tag}"},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _create_contract(
    client: AsyncClient,
    *,
    employee_id: str,
    type_id: str,
    number: str,
    end_date: str | None = None,
    parent_id: str | None = None,
) -> dict:
    response = await client.post(
        "/api/v1/contracts",
        json={
            "employee_id": employee_id,
            "contract_type_id": type_id,
            "contract_number": number,
            "start_date": "2026-10-01",
            "end_date": end_date,
            "job_title_snapshot": "Synthetic Sales Executive",
            "currency": "AED",
            "basic_salary": "5000.00",
            "allowances_total": "1000.00",
            "notes": "Synthetic contract fixture",
            "parent_contract_id": parent_id,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _signed_attachment(client: AsyncClient, contract_id: str) -> None:
    pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"
    response = await client.post(
        f"/api/v1/contracts/{contract_id}/attachment",
        files={"upload": ("signed-contract.pdf", pdf, "application/pdf")},
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_contract_permissions_activation_private_access_and_history(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    contract_type = await _contract_type(owner)
    hr = await create_activated_user(owner, user_type_code="HR")
    employee = await create_activated_user(owner, user_type_code="SE")
    outsider = await create_activated_user(owner, user_type_code="TL")
    pro = await create_activated_user(owner, user_type_code="PRO")

    hr_client = await spawned_client()
    employee_client = await spawned_client()
    outsider_client = await spawned_client()
    pro_client = await spawned_client()
    try:
        await authenticate(hr_client, hr["email"], "UserPass1!")
        await authenticate(employee_client, employee["email"], "UserPass1!")
        await authenticate(outsider_client, outsider["email"], "UserPass1!")
        await authenticate(pro_client, pro["email"], "UserPass1!")

        created = await _create_contract(
            hr_client,
            employee_id=employee["id"],
            type_id=contract_type["id"],
            number=f"CON-{unique_tag().upper()}",
            end_date="2028-09-30",
        )
        assert created["status"] == "Draft"
        assert created["history"][-1]["action"] == "create"

        assert (await employee_client.get("/api/v1/contracts")).status_code == 403
        assert (
            await outsider_client.get(f"/api/v1/contracts/{created['id']}")
        ).status_code == 404
        assert (await pro_client.get("/api/v1/contracts/types")).status_code == 403
        assert (
            await pro_client.get(f"/api/v1/contracts/{created['id']}")
        ).status_code == 403

        invalid = await hr_client.post(
            f"/api/v1/contracts/{created['id']}/attachment",
            files={"upload": ("fake.png", b"not-an-image", "image/png")},
        )
        assert invalid.status_code == 422, invalid.text

        submitted = await hr_client.post(
            f"/api/v1/contracts/{created['id']}/submit",
            json={
                "lock_version": created["lockVersion"],
                "comment": "Ready for review",
            },
        )
        assert submitted.status_code == 200, submitted.text
        pending = submitted.json()

        no_attachment = await owner.post(
            f"/api/v1/contracts/{created['id']}/activate",
            json={"lock_version": pending["lockVersion"]},
        )
        assert no_attachment.status_code == 409
        assert no_attachment.json()["error"]["code"] == "CONTRACT_ATTACHMENT_REQUIRED"
        assert (
            await hr_client.post(
                f"/api/v1/contracts/{created['id']}/activate",
                json={"lock_version": pending["lockVersion"]},
            )
        ).status_code == 403

        await _signed_attachment(hr_client, created["id"])
        activated = await owner.post(
            f"/api/v1/contracts/{created['id']}/activate",
            json={"lock_version": pending["lockVersion"], "comment": "OWNER approval"},
        )
        assert activated.status_code == 200, activated.text
        active = activated.json()
        assert active["storedStatus"] == "Active"
        assert [event["action"] for event in active["history"]] == [
            "create",
            "submit",
            "activate",
        ]

        own = await employee_client.get("/api/v1/contracts/me/active")
        assert own.status_code == 200, own.text
        assert own.json()["item"]["id"] == active["id"]
        direct = await employee_client.get(f"/api/v1/contracts/{active['id']}")
        assert direct.status_code == 200, direct.text
        assert direct.json()["history"] == []
        assert all(item["isActive"] for item in direct.json()["attachments"])
        file = next(item for item in direct.json()["attachments"] if item["isActive"])
        download = await employee_client.get(
            f"/api/v1/contracts/{active['id']}/attachments/{file['id']}/file"
        )
        assert download.status_code == 200
        assert download.content.startswith(b"%PDF")

        immutable = await hr_client.patch(
            f"/api/v1/contracts/{active['id']}",
            json={
                "lock_version": active["lockVersion"],
                "notes": "Forbidden overwrite",
            },
        )
        assert immutable.status_code == 409
        assert immutable.json()["error"]["code"] == "CONTRACT_IMMUTABLE"
    finally:
        await hr_client.aclose()
        await employee_client.aclose()
        await outsider_client.aclose()
        await pro_client.aclose()


@pytest.mark.asyncio
async def test_contract_renewal_supersedes_once_and_concurrency_is_fail_closed(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    contract_type = await _contract_type(owner)
    hr = await create_activated_user(owner, user_type_code="HR")
    employee = await create_activated_user(owner, user_type_code="SE")
    other_hr = await create_activated_user(owner, user_type_code="HR")
    hr_client = await spawned_client()
    other_hr_client = await spawned_client()
    try:
        await authenticate(hr_client, hr["email"], "UserPass1!")
        await authenticate(other_hr_client, other_hr["email"], "UserPass1!")
        first = await _create_contract(
            hr_client,
            employee_id=employee["id"],
            type_id=contract_type["id"],
            number=f"CON-{unique_tag().upper()}",
        )
        submitted_first = (
            await hr_client.post(
                f"/api/v1/contracts/{first['id']}/submit",
                json={"lock_version": first["lockVersion"]},
            )
        ).json()
        await _signed_attachment(hr_client, first["id"])
        active_first = (
            await owner.post(
                f"/api/v1/contracts/{first['id']}/activate",
                json={"lock_version": submitted_first["lockVersion"]},
            )
        ).json()

        renewal = await _create_contract(
            hr_client,
            employee_id=employee["id"],
            type_id=contract_type["id"],
            number=f"CON-{unique_tag().upper()}",
            parent_id=active_first["id"],
        )
        concurrent = await asyncio.gather(
            hr_client.post(
                f"/api/v1/contracts/{renewal['id']}/submit",
                json={"lock_version": renewal["lockVersion"]},
            ),
            other_hr_client.post(
                f"/api/v1/contracts/{renewal['id']}/submit",
                json={"lock_version": renewal["lockVersion"]},
            ),
        )
        assert sorted(response.status_code for response in concurrent) == [200, 409]
        pending = next(
            response.json() for response in concurrent if response.status_code == 200
        )
        await _signed_attachment(hr_client, renewal["id"])
        current = (await owner.get(f"/api/v1/contracts/{renewal['id']}")).json()
        if current["lockVersion"] != pending["lockVersion"]:
            stale = await owner.post(
                f"/api/v1/contracts/{renewal['id']}/activate",
                json={"lock_version": pending["lockVersion"]},
            )
            assert stale.status_code == 409
        activated = await owner.post(
            f"/api/v1/contracts/{renewal['id']}/activate",
            json={"lock_version": current["lockVersion"]},
        )
        assert activated.status_code == 200, activated.text
        assert activated.json()["parentContractId"] == active_first["id"]
        previous = await owner.get(f"/api/v1/contracts/{active_first['id']}")
        assert previous.status_code == 200
        assert previous.json()["storedStatus"] == "Superseded"
        assert previous.json()["contractNumber"] == active_first["contractNumber"]

        register = (await owner.get("/api/v1/contracts")).json()["items"]
        active_rows = [
            item
            for item in register
            if item["employeeId"] == employee["id"] and item["storedStatus"] == "Active"
        ]
        assert len(active_rows) == 1
    finally:
        await hr_client.aclose()
        await other_hr_client.aclose()


@pytest.mark.asyncio
async def test_contract_decisions_cancellation_and_reminder_milestones(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    contract_type = await _contract_type(owner)
    first_hr = await create_activated_user(owner, user_type_code="HR")
    second_hr = await create_activated_user(owner, user_type_code="HR")
    employee = await create_activated_user(owner, user_type_code="SE")
    first_client = await spawned_client()
    second_client = await spawned_client()
    try:
        await authenticate(first_client, first_hr["email"], "UserPass1!")
        await authenticate(second_client, second_hr["email"], "UserPass1!")
        returned = await _create_contract(
            first_client,
            employee_id=employee["id"],
            type_id=contract_type["id"],
            number=f"CON-{unique_tag().upper()}",
        )
        pending = (
            await first_client.post(
                f"/api/v1/contracts/{returned['id']}/submit",
                json={"lock_version": returned["lockVersion"]},
            )
        ).json()
        self_decision = await first_client.post(
            f"/api/v1/contracts/{returned['id']}/decision",
            json={
                "lock_version": pending["lockVersion"],
                "decision": "return",
                "comment": "Fix",
            },
        )
        assert self_decision.status_code == 403
        decision = await second_client.post(
            f"/api/v1/contracts/{returned['id']}/decision",
            json={
                "lock_version": pending["lockVersion"],
                "decision": "return",
                "comment": "Correct dates",
            },
        )
        assert decision.status_code == 200, decision.text
        assert decision.json()["storedStatus"] == "Draft"

        cancelled = await first_client.post(
            f"/api/v1/contracts/{returned['id']}/cancel",
            json={
                "lock_version": decision.json()["lockVersion"],
                "reason": "No longer required",
            },
        )
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["storedStatus"] == "Cancelled"

        end = business_today() + timedelta(days=30)
        expiring = await _create_contract(
            first_client,
            employee_id=employee["id"],
            type_id=contract_type["id"],
            number=f"CON-{unique_tag().upper()}",
            end_date=end.isoformat(),
        )
        submitted = (
            await first_client.post(
                f"/api/v1/contracts/{expiring['id']}/submit",
                json={"lock_version": expiring["lockVersion"]},
            )
        ).json()
        await _signed_attachment(first_client, expiring["id"])
        assert (
            await owner.post(
                f"/api/v1/contracts/{expiring['id']}/activate",
                json={"lock_version": submitted["lockVersion"]},
            )
        ).status_code == 200
        reminders = (await owner.get("/api/v1/contracts/reminders")).json()["items"]
        reminder = next(item for item in reminders if item["id"] == expiring["id"])
        assert reminder["daysRemaining"] == 30
        assert reminder["reminderMilestone"] == 30
    finally:
        await first_client.aclose()
        await second_client.aclose()
