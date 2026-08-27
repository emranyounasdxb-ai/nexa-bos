from __future__ import annotations

import pytest
from httpx import AsyncClient

from helpers import (
    authenticate,
    create_activated_user,
    office_id,
    owner_client,
    spawned_client,
    unique_tag,
)


async def _scoped_type(
    client: AsyncClient,
    scope: str,
    permissions: list[str],
    *,
    can_be_reporting_manager: bool = False,
) -> str:
    tag = unique_tag().upper()
    created = await client.post(
        "/api/v1/user-types",
        json={
            "name": f"Scope {tag}",
            "code": f"S{tag[:8]}",
            "can_be_reporting_manager": can_be_reporting_manager,
        },
    )
    assert created.status_code == 200, created.text
    type_id = created.json()["id"]
    await client.post(f"/api/v1/user-types/{type_id}/activate")
    await client.put(
        f"/api/v1/user-types/{type_id}/permissions",
        json={"permissions": permissions},
    )
    await client.put(
        f"/api/v1/user-types/{type_id}/scope",
        json={"visibility_scope": scope},
    )
    return created.json()["code"]


@pytest.mark.asyncio
async def test_office_scope_hides_other_offices(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    code = await _scoped_type(authed, "office", ["Users.View"])
    dubai = await office_id(authed, "DXB")
    abu_dhabi = await office_id(authed, "AUH")
    viewer = await create_activated_user(
        authed, user_type_code=code, password="UserPass1!", office_id=dubai
    )
    other = await create_activated_user(authed, user_type_code="GM", office_id=abu_dhabi)
    async with await spawned_client() as other_client:
        await authenticate(other_client, viewer["email"], "UserPass1!")
        directory = await other_client.get("/api/v1/users")
        ids = {item["id"] for item in directory.json()["items"]}
        assert viewer["id"] in ids
        assert other["id"] not in ids
        hidden = await other_client.get(f"/api/v1/users/{other['id']}")
        assert hidden.status_code == 403


@pytest.mark.asyncio
async def test_team_scope_includes_indirect_reports(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    code = await _scoped_type(
        authed, "team", ["Users.View"], can_be_reporting_manager=True
    )
    lead = await create_activated_user(authed, user_type_code=code, password="UserPass1!")
    mid = await create_activated_user(authed, user_type_code="GM", manager_id=lead["id"])
    leaf = await create_activated_user(authed, user_type_code="SE", manager_id=mid["id"])
    outsider = await create_activated_user(authed, user_type_code="GM")
    async with await spawned_client() as other_client:
        await authenticate(other_client, lead["email"], "UserPass1!")
        directory = await other_client.get("/api/v1/users")
        ids = {item["id"] for item in directory.json()["items"]}
        assert {lead["id"], mid["id"], leaf["id"]} <= ids
        assert outsider["id"] not in ids


@pytest.mark.asyncio
async def test_circular_hierarchy_rejected(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    first = await create_activated_user(authed, user_type_code="GM")
    second = await create_activated_user(authed, user_type_code="GM", manager_id=first["id"])
    response = await authed.patch(
        f"/api/v1/users/{first['id']}",
        json={"reporting_manager_id": second["id"]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "HIERARCHY_CYCLE"
    assert unique_tag()


@pytest.mark.asyncio
async def test_self_reporting_rejected(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    manager = await create_activated_user(authed, user_type_code="GM")
    response = await authed.patch(
        f"/api/v1/users/{manager['id']}",
        json={"reporting_manager_id": manager["id"]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "HIERARCHY_SELF"
