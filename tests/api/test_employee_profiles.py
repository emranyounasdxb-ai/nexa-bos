from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from helpers import (
    business_today,
    create_activated_user,
    owner_client,
    spawned_client,
    unique_tag,
    utc_today,
)
from httpx import AsyncClient


async def _type_with_permissions(
    owner: AsyncClient, permissions: list[str], *, scope: str = "own"
) -> str:
    tag = unique_tag().upper()
    created = await owner.post(
        "/api/v1/user-types", json={"name": f"Profile Test {tag}", "code": f"P{tag[:8]}"}
    )
    assert created.status_code == 200, created.text
    type_id = created.json()["id"]
    assert (await owner.post(f"/api/v1/user-types/{type_id}/activate")).status_code == 200
    response = await owner.put(
        f"/api/v1/user-types/{type_id}/permissions", json={"permissions": permissions}
    )
    assert response.status_code == 200, response.text
    response = await owner.put(
        f"/api/v1/user-types/{type_id}/scope", json={"visibility_scope": scope}
    )
    assert response.status_code == 200, response.text
    return created.json()["code"]


@pytest.mark.asyncio
async def test_profile_completion_hr_calculation_and_optimistic_conflict(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    user_types = (await owner.get("/api/v1/user-types")).json()["items"]
    hr_type = next(row for row in user_types if row["code"] == "HR")
    pro_type = next(row for row in user_types if row["code"] == "PRO")
    assert {"UserProfiles.Basic.View", "UserProfiles.HR.View", "UserProfiles.HR.Update"} <= set(
        hr_type["permissions"]
    )
    assert {
        "UserProfiles.Basic.View",
        "UserProfiles.PRO.View",
        "UserProfiles.PRO.Update",
        "UserDocuments.Upload",
        "UserDocuments.Replace",
        "UserDocuments.View",
        "UserDocuments.Download",
        "UserDocuments.Delete",
        "UserDocuments.History",
    } <= set(pro_type["permissions"])
    employee = await create_activated_user(owner, user_type_code="SE")

    basic = await owner.patch(
        f"/api/v1/employee-profiles/{employee['id']}/basic",
        json={
            "first_name": "Test",
            "middle_name": "Profile",
            "last_name": "Employee",
            "personal_email": "personal-profile@example.test",
            "personal_mobile": "+971500002222",
        },
    )
    assert basic.status_code == 200, basic.text
    assert basic.json()["basic"]["fullName"] == "Test Profile Employee"

    initial = await owner.get(f"/api/v1/employee-profiles/{employee['id']}")
    assert initial.status_code == 200, initial.text
    assert initial.json()["hr"]["completion"]["state"] == "Pending"

    payload = {
        "date_of_birth": "1990-01-01",
        "gender": "Female",
        "nationality": "Test nationality",
        "marital_status": "Single",
        "emergency_contact_name": "Test Contact",
        "emergency_contact_relationship": "Sibling",
        "emergency_contact_mobile": "+971500001111",
        "employee_status": "Active",
        "employee_type": "Permanent",
        "employment_type": "Full Time",
        "probation_end_date": "2026-05-01",
        "job_title": "Test Executive",
        "business_unit": "Test Business Unit",
        "location": "Dubai",
        "work_email": employee["email"],
        "work_mobile": employee["mobile"],
        "employee_grade": "G1",
        "basic_salary": "1000.00",
        "housing_allowance": "200.00",
        "transport_allowance": "100.00",
        "other_allowances": "50.00",
        "payment_method": "Bank transfer",
        "bank_name": "Test Bank",
        "bank_account_name": "Test Employee",
        "iban": "AE070331234567890123456",
        "bank_account_number": "TEST-001",
        "hr_notes": "Synthetic profile test",
    }
    updated = await owner.put(f"/api/v1/employee-profiles/{employee['id']}/hr", json=payload)
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["hr"]["data"]["grossSalary"] == "1350.00"
    assert body["hr"]["completion"]["state"] == "Complete"
    version = body["hr"]["data"]["lockVersion"]

    concurrent = await asyncio.gather(
        owner.put(
            f"/api/v1/employee-profiles/{employee['id']}/hr",
            json={"hr_notes": "Concurrent update A", "lock_version": version},
        ),
        owner.put(
            f"/api/v1/employee-profiles/{employee['id']}/hr",
            json={"hr_notes": "Concurrent update B", "lock_version": version},
        ),
    )
    assert sorted(response.status_code for response in concurrent) == [200, 409]
    conflict = next(response for response in concurrent if response.status_code == 409)
    assert conflict.json()["error"]["code"] == "PROFILE_CONFLICT"


@pytest.mark.asyncio
async def test_own_profile_is_read_only_and_sensitive_hr_fields_are_redacted(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    type_code = await _type_with_permissions(owner, [])
    employee = await create_activated_user(owner, user_type_code=type_code)
    await owner.put(
        f"/api/v1/employee-profiles/{employee['id']}/hr",
        json={"basic_salary": "9999", "bank_name": "Private Test Bank", "hr_notes": "Private"},
    )

    viewer = await spawned_client()
    try:
        from helpers import authenticate

        await authenticate(viewer, employee["email"], "UserPass1!")
        own = await viewer.get(f"/api/v1/employee-profiles/{employee['id']}")
        assert own.status_code == 200, own.text
        assert own.json()["canUpdateHr"] is False
        assert own.json()["hr"]["data"]["basicSalary"] is None
        assert own.json()["hr"]["data"]["bankName"] is None
        assert own.json()["hr"]["data"]["hrNotes"] is None
        denied = await viewer.put(
            f"/api/v1/employee-profiles/{employee['id']}/hr", json={"job_title": "No"}
        )
        assert denied.status_code == 403
        attachments = await viewer.get(
            f"/api/v1/employee-profiles/{employee['id']}/documents/00000000-0000-0000-0000-000000000000/download"
        )
        assert attachments.status_code == 403
    finally:
        await viewer.aclose()


@pytest.mark.asyncio
async def test_profile_permissions_remain_bound_by_server_side_user_scope(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    type_code = await _type_with_permissions(
        owner, ["UserProfiles.Basic.View", "UserProfiles.HR.View"], scope="own"
    )
    viewer_user = await create_activated_user(owner, user_type_code=type_code)
    other_user = await create_activated_user(owner, user_type_code="SE")
    viewer = await spawned_client()
    try:
        from helpers import authenticate

        await authenticate(viewer, viewer_user["email"], "UserPass1!")
        own = await viewer.get(f"/api/v1/employee-profiles/{viewer_user['id']}")
        assert own.status_code == 200, own.text
        denied = await viewer.get(f"/api/v1/employee-profiles/{other_user['id']}")
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "OUT_OF_SCOPE"
        dashboard = await viewer.get("/api/v1/employee-profiles/dashboards/hr")
        assert dashboard.status_code == 200, dashboard.text
        assert dashboard.json()["cards"]["totalEmployees"] == 1
    finally:
        await viewer.aclose()


@pytest.mark.asyncio
async def test_hr_update_permission_can_load_scope_filtered_reporting_managers(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    type_code = await _type_with_permissions(
        owner,
        ["UserProfiles.Basic.View", "UserProfiles.HR.View", "UserProfiles.HR.Update"],
        scope="company",
    )
    hr_user = await create_activated_user(owner, user_type_code=type_code)
    viewer = await spawned_client()
    try:
        from helpers import authenticate

        await authenticate(viewer, hr_user["email"], "UserPass1!")
        managers = await viewer.get(f"/api/v1/users/managers?excludeUserId={hr_user['id']}")
        assert managers.status_code == 200, managers.text
        assert all(row["id"] != hr_user["id"] for row in managers.json()["items"])
    finally:
        await viewer.aclose()


@pytest.mark.asyncio
async def test_document_validation_version_history_soft_delete_and_purge(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    employee = await create_activated_user(owner, user_type_code="SE")
    created = await owner.post(
        f"/api/v1/employee-profiles/{employee['id']}/documents",
        json={
            "kind": "passport",
            "document_number": "TEST-PASSPORT-001",
            "expiry_date": (utc_today() + timedelta(days=80)).isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    document_id = created.json()["id"]
    metadata = await owner.patch(
        f"/api/v1/employee-profiles/{employee['id']}/documents/{document_id}",
        json={
            "kind": "passport",
            "document_number": "TEST-PASSPORT-002",
            "expiry_date": (utc_today() + timedelta(days=90)).isoformat(),
            "declared_status": "Recorded",
            "replacement_reason": "Corrected synthetic metadata",
        },
    )
    assert metadata.status_code == 200, metadata.text
    assert metadata.json()["version"] == 2
    document_id = metadata.json()["id"]

    invalid = await owner.post(
        f"/api/v1/employee-profiles/{employee['id']}/documents/{document_id}/upload",
        files={"file": ("not-an-image.png", b"not an image", "image/png")},
    )
    assert invalid.status_code == 422, invalid.text
    assert invalid.json()["error"]["code"] == "DOCUMENT_CONTENT_INVALID"

    pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"
    uploaded = await owner.post(
        f"/api/v1/employee-profiles/{employee['id']}/documents/{document_id}/upload",
        files={"file": ("passport.pdf", pdf, "application/pdf")},
    )
    assert uploaded.status_code == 200, uploaded.text
    active_id = uploaded.json()["id"]
    replacement = await owner.post(
        f"/api/v1/employee-profiles/{employee['id']}/documents/{active_id}/replace",
        data={"reason": "Updated synthetic copy"},
        files={"file": ("passport-new.pdf", pdf + b"\n%%EOF", "application/pdf")},
    )
    assert replacement.status_code == 200, replacement.text
    replacement_id = replacement.json()["id"]
    assert replacement.json()["version"] == 4

    history = await owner.get(
        f"/api/v1/employee-profiles/{employee['id']}/documents/{replacement_id}/history"
    )
    assert history.status_code == 200, history.text
    assert [row["version"] for row in history.json()["items"]] == [4, 3, 2, 1]
    historical_view = await owner.get(
        f"/api/v1/employee-profiles/{employee['id']}/documents/{active_id}/view"
    )
    assert historical_view.status_code == 200

    removed = await owner.request(
        "DELETE",
        f"/api/v1/employee-profiles/{employee['id']}/documents/{replacement_id}",
        json={"reason": "Synthetic record retired"},
    )
    assert removed.status_code == 204, removed.text
    profile = await owner.get(f"/api/v1/employee-profiles/{employee['id']}")
    assert profile.json()["pro"]["documents"] == []
    purged = await owner.request(
        "DELETE",
        f"/api/v1/employee-profiles/{employee['id']}/documents/{replacement_id}/purge",
        json={"reason": "Disposable test cleanup"},
    )
    assert purged.status_code == 200, purged.text
    assert purged.json()["versionsPurged"] == 4


@pytest.mark.asyncio
async def test_document_expiry_dashboard_boundaries(client: AsyncClient) -> None:
    owner, _ = await owner_client(client)
    employee = await create_activated_user(owner, user_type_code="SE")
    today = business_today()
    for kind, days in (("passport", 60), ("visa", 59), ("emirates_id", -1)):
        payload = {
            "kind": kind,
            "document_number": f"TEST-{kind}",
            "expiry_date": (today + timedelta(days=days)).isoformat(),
        }
        if kind == "visa":
            payload["visa_type"] = "Residence"
        response = await owner.post(
            f"/api/v1/employee-profiles/{employee['id']}/documents", json=payload
        )
        assert response.status_code == 201, response.text
    dashboard = await owner.get("/api/v1/employee-profiles/dashboards/pro")
    assert dashboard.status_code == 200, dashboard.text
    body = dashboard.json()
    row = next(item for item in body["compliance"] if item["employeeId"] == employee["id"])
    assert row["documents"]["passport"]["status"] == "Active"
    assert row["documents"]["visa"]["status"] == "Expiring Soon"
    assert row["documents"]["emirates_id"]["status"] == "Expired"
    assert row["documents"]["work_permit"]["status"] == "Missing"
