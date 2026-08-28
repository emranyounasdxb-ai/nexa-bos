from __future__ import annotations

import pytest
from httpx import AsyncClient

from helpers import (
    authenticate,
    create_activated_user,
    designation_id,
    owner_client,
    spawned_client,
    unique_tag,
)


@pytest.mark.asyncio
async def test_system_types_cannot_be_renamed(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    types = (await authed.get("/api/v1/user-types")).json()["items"]
    se = next(item for item in types if item["code"] == "SE")
    response = await authed.patch(f"/api/v1/user-types/{se['id']}", json={"name": "Renamed"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "SYSTEM_USER_TYPE_LOCKED"


@pytest.mark.asyncio
async def test_custom_type_starts_inactive_without_permissions(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/user-types",
        json={"name": f"Custom {tag}", "code": f"C{tag[:8]}", "description": "custom"},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["status"] == "inactive"
    assert body["permissions"] == []
    assert body["visibilityScope"] is None
    assert body["customerVisibilityScope"] is None
    assert body["applicationVisibilityScope"] is None
    assert body["mfaRequired"] is False
    assert body["canBeReportingManager"] is False
    assert body["canBeCaseOwner"] is False
    assert body["isSystem"] is False
    toggled = await authed.patch(
        f"/api/v1/user-types/{body['id']}",
        json={"can_be_reporting_manager": True},
    )
    assert toggled.status_code == 200, toggled.text
    assert toggled.json()["canBeReportingManager"] is True
    se = next(item for item in (await authed.get("/api/v1/user-types")).json()["items"] if item["code"] == "SE")
    locked = await authed.patch(
        f"/api/v1/user-types/{se['id']}",
        json={"can_be_reporting_manager": False},
    )
    assert locked.status_code == 403
    assert locked.json()["error"]["code"] == "SYSTEM_USER_TYPE_LOCKED"


@pytest.mark.asyncio
async def test_permission_change_terminates_session(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/user-types",
        json={"name": f"Perm {tag}", "code": f"P{tag[:8]}"},
    )
    type_id = created.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    await authed.put(
        f"/api/v1/user-types/{type_id}/permissions",
        json={"permissions": ["Users.View"]},
    )
    user = await create_activated_user(
        authed, user_type_code=created.json()["code"], password="UserPass1!"
    )
    async with await spawned_client() as other:
        await authenticate(other, user["email"], "UserPass1!")
        await authed.put(
            f"/api/v1/user-types/{type_id}/permissions",
            json={"permissions": ["Users.View", "Users.Edit"]},
        )
        me = await other.get("/api/v1/auth/me")
        assert me.status_code == 401


@pytest.mark.asyncio
async def test_users_view_required_for_directory(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/user-types",
        json={"name": f"Noperm {tag}", "code": f"N{tag[:8]}"},
    )
    type_id = created.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    user = await create_activated_user(
        authed, user_type_code=created.json()["code"], password="UserPass1!"
    )
    async with await spawned_client() as other:
        await authenticate(other, user["email"], "UserPass1!")
        directory = await other.get("/api/v1/users")
        assert directory.status_code == 403


@pytest.mark.asyncio
async def test_custom_type_reporting_manager_flag_enforced(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/user-types",
        json={"name": f"Lead {tag}", "code": f"L{tag[:8]}"},
    )
    assert created.status_code == 200, created.text
    assert created.json()["canBeReportingManager"] is False
    type_id = created.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    manager = await create_activated_user(authed, user_type_code=created.json()["code"])
    tag_user = unique_tag()
    rejected = await authed.post(
        "/api/v1/users",
        json={
            "full_name": "Report",
            "employee_code": f"EMP-{tag_user}",
            "email": f"rpt-{tag_user}@example.com",
            "mobile": "+971500000022",
            "designation_id": await designation_id(authed),
            "employment_status": "Active",
            "joining_date": "2026-04-01",
            "reporting_manager_id": manager["id"],
        },
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "MANAGER_TYPE_INELIGIBLE"
    enabled = await authed.patch(
        f"/api/v1/user-types/{type_id}",
        json={"can_be_reporting_manager": True},
    )
    assert enabled.status_code == 200
    assert enabled.json()["canBeReportingManager"] is True
    listed = await authed.get("/api/v1/users/managers")
    assert listed.status_code == 200
    assert manager["id"] in {item["id"] for item in listed.json()["items"]}
    tag_ok = unique_tag()
    accepted = await authed.post(
        "/api/v1/users",
        json={
            "full_name": "Report Ok",
            "employee_code": f"EMP-{tag_ok}",
            "email": f"ok-{tag_ok}@example.com",
            "mobile": "+971500000023",
            "designation_id": await designation_id(authed),
            "employment_status": "Active",
            "joining_date": "2026-04-01",
            "reporting_manager_id": manager["id"],
        },
    )
    assert accepted.status_code == 200, accepted.text
    disabled = await authed.patch(
        f"/api/v1/user-types/{type_id}",
        json={"can_be_reporting_manager": False},
    )
    assert disabled.json()["canBeReportingManager"] is False
    tag_no = unique_tag()
    blocked = await authed.post(
        "/api/v1/users",
        json={
            "full_name": "Report No",
            "employee_code": f"EMP-{tag_no}",
            "email": f"no-{tag_no}@example.com",
            "mobile": "+971500000024",
            "designation_id": await designation_id(authed),
            "employment_status": "Active",
            "joining_date": "2026-04-01",
            "reporting_manager_id": manager["id"],
        },
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "MANAGER_TYPE_INELIGIBLE"
