from __future__ import annotations

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


async def _type_with(
    client: AsyncClient,
    permissions: list[str],
    *,
    scope: str,
    can_manage: bool = False,
) -> str:
    tag = unique_tag()[:8].upper()
    code = f"H{tag}"
    created = await client.post(
        "/api/v1/user-types",
        json={
            "name": f"Hierarchy Security {tag}",
            "code": code,
            "can_be_reporting_manager": can_manage,
        },
    )
    assert created.status_code == 200, created.text
    type_id = created.json()["id"]
    assert (await client.post(f"/api/v1/user-types/{type_id}/activate")).status_code == 200
    assigned = await client.put(
        f"/api/v1/user-types/{type_id}/permissions",
        json={"permissions": permissions},
    )
    assert assigned.status_code == 200, assigned.text
    scoped = await client.put(
        f"/api/v1/user-types/{type_id}/scope",
        json={"visibility_scope": scope},
    )
    assert scoped.status_code == 200, scoped.text
    return code


def _ids(payload: dict) -> set[str]:
    return {row["id"] for row in payload["nodes"]}


@pytest.mark.asyncio
async def test_hierarchy_requires_authentication_and_users_view(client: AsyncClient) -> None:
    anonymous = await client.get("/api/v1/organization/hierarchy")
    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "UNAUTHENTICATED"

    owner, _ = await owner_client(client)
    denied_type = await _type_with(owner, ["Notifications.View"], scope="company")
    denied_user = await create_activated_user(owner, user_type_code=denied_type)
    async with await spawned_client() as denied:
        await authenticate(denied, denied_user["email"], "UserPass1!")
        response = await denied.get("/api/v1/organization/hierarchy")
        assert response.status_code == 403
        assert response.json()["error"]["details"] == [{"permission": "Users.View"}]

    dxb = await office_id(owner, "DXB")
    auh = await office_id(owner, "AUH")
    dxb_employee = await create_activated_user(owner, user_type_code="SE", office_id=dxb)
    auh_employee = await create_activated_user(owner, user_type_code="SE", office_id=auh)
    company_type = await _type_with(owner, ["Users.View"], scope="company")
    company_user = await create_activated_user(owner, user_type_code=company_type)
    async with await spawned_client() as company:
        await authenticate(company, company_user["email"], "UserPass1!")
        payload = (await company.get("/api/v1/organization/hierarchy")).json()
        assert {dxb_employee["id"], auh_employee["id"]} <= _ids(payload)


@pytest.mark.asyncio
async def test_office_scope_blocks_hidden_nodes_search_ancestor_filters_and_manager_tampering(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    dxb = await office_id(owner, "DXB")
    auh = await office_id(owner, "AUH")
    hidden_manager = await create_activated_user(owner, user_type_code="GM", office_id=auh)
    visible_employee = await create_activated_user(
        owner,
        user_type_code="SE",
        office_id=dxb,
        manager_id=hidden_manager["id"],
    )
    hidden_employee = await create_activated_user(owner, user_type_code="SE", office_id=auh)
    office_type = await _type_with(
        owner,
        ["Users.View", "Users.Edit"],
        scope="office",
    )
    viewer = await create_activated_user(
        owner,
        user_type_code=office_type,
        office_id=dxb,
    )
    before = (await owner.get(f"/api/v1/users/{visible_employee['id']}")).json()
    before_history = (await owner.get(f"/api/v1/users/{visible_employee['id']}/history")).json()

    async with await spawned_client() as restricted:
        await authenticate(restricted, viewer["email"], "UserPass1!")
        hierarchy = await restricted.get("/api/v1/organization/hierarchy")
        assert hierarchy.status_code == 200, hierarchy.text
        payload = hierarchy.json()
        ids = _ids(payload)
        assert {viewer["id"], visible_employee["id"]} <= ids
        assert hidden_manager["id"] not in ids
        assert hidden_employee["id"] not in ids
        visible_node = next(row for row in payload["nodes"] if row["id"] == visible_employee["id"])
        assert visible_node["reportingManagerId"] is None
        assert {row["id"] for row in payload["filters"]["offices"]} == {dxb}

        hidden_search = await restricted.get(
            "/api/v1/organization/hierarchy",
            params={"q": hidden_employee["employeeCode"]},
        )
        assert hidden_search.json()["searchResults"] == []
        hidden_context = await restricted.get(
            "/api/v1/organization/hierarchy",
            params={"selectedUserId": hidden_employee["id"]},
        )
        assert hidden_context.status_code == 404
        assert hidden_context.json()["error"]["code"] == "HIERARCHY_EMPLOYEE_NOT_FOUND"
        filter_tamper = await restricted.get(
            "/api/v1/organization/hierarchy",
            params={"officeId": auh},
        )
        assert filter_tamper.status_code == 404
        assert filter_tamper.json()["error"]["code"] == "HIERARCHY_FILTER_NOT_FOUND"
        hidden_profile = await restricted.get(f"/api/v1/users/{hidden_employee['id']}")
        assert hidden_profile.status_code == 403

        manager_options = await restricted.get("/api/v1/users/managers")
        assert hidden_manager["id"] not in {row["id"] for row in manager_options.json()["items"]}
        manager_tamper = await restricted.patch(
            f"/api/v1/users/{visible_employee['id']}",
            json={"reporting_manager_id": hidden_manager["id"]},
        )
        assert manager_tamper.status_code == 404
        assert manager_tamper.json()["error"]["code"] == "MANAGER_NOT_FOUND"

    assert (await owner.get(f"/api/v1/users/{visible_employee['id']}")).json() == before
    assert (
        await owner.get(f"/api/v1/users/{visible_employee['id']}/history")
    ).json() == before_history


@pytest.mark.asyncio
async def test_team_and_own_scope_cannot_enumerate_unrelated_branches(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    team_type = await _type_with(
        owner,
        ["Users.View"],
        scope="team",
        can_manage=True,
    )
    lead = await create_activated_user(owner, user_type_code=team_type)
    middle = await create_activated_user(owner, user_type_code="GM", manager_id=lead["id"])
    leaf = await create_activated_user(owner, user_type_code="SE", manager_id=middle["id"])
    outsider = await create_activated_user(owner, user_type_code="GM")
    own_type = await _type_with(owner, ["Users.View"], scope="own")
    own_user = await create_activated_user(owner, user_type_code=own_type)

    async with await spawned_client() as team_client:
        await authenticate(team_client, lead["email"], "UserPass1!")
        payload = (await team_client.get("/api/v1/organization/hierarchy")).json()
        assert _ids(payload) == {lead["id"], middle["id"], leaf["id"]}
        assert outsider["id"] not in payload["rootIds"]
        hidden = await team_client.get(
            "/api/v1/organization/hierarchy",
            params={"q": outsider["employeeCode"]},
        )
        assert hidden.json()["searchResults"] == []

    async with await spawned_client() as own_client:
        await authenticate(own_client, own_user["email"], "UserPass1!")
        payload = (await own_client.get("/api/v1/organization/hierarchy")).json()
        assert _ids(payload) == {own_user["id"]}
        probe = await own_client.get(
            "/api/v1/organization/hierarchy",
            params={"selectedUserId": leaf["id"]},
        )
        assert probe.status_code == 404
