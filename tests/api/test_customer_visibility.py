from __future__ import annotations

import pytest
from httpx import AsyncClient

from helpers import (
    authenticate,
    create_activated_user,
    owner_client,
    spawned_client,
    unique_tag,
)


async def _type_with_scopes(
    client: AsyncClient,
    *,
    directory_scope: str | None,
    customer_scope: str | None,
    permissions: list[str],
) -> str:
    tag = unique_tag().upper()
    created = await client.post(
        "/api/v1/user-types",
        json={"name": f"Cust {tag}", "code": f"C{tag[:8]}"},
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
        json={"visibility_scope": directory_scope},
    )
    await client.put(
        f"/api/v1/user-types/{type_id}/customer-scope",
        json={"customer_visibility_scope": customer_scope},
    )
    return created.json()["code"]


async def _create_customer(client: AsyncClient, name: str) -> dict:
    response = await client.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": f"{name} {unique_tag()}",
            "mobile": f"+97150{unique_tag()[:8]}",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "ownerId" not in body
    return body


@pytest.mark.asyncio
async def test_company_customer_scope_sees_all_customers(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    created = await _create_customer(authed, "Company-visible customer")
    code = await _type_with_scopes(
        authed,
        directory_scope="own",
        customer_scope="company",
        permissions=["Customers.View"],
    )
    viewer = await create_activated_user(authed, user_type_code=code, password="UserPass1!")
    async with await spawned_client() as viewer_client:
        await authenticate(viewer_client, viewer["email"], "UserPass1!")
        directory = await viewer_client.get("/api/v1/customers")
        assert directory.status_code == 200, directory.text
        ids = {item["id"] for item in directory.json()["items"]}
        assert created["id"] in ids
        shown = await viewer_client.get(f"/api/v1/customers/{created['id']}")
        assert shown.status_code == 200


@pytest.mark.asyncio
async def test_directory_scope_does_not_grant_customer_visibility(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    created = await _create_customer(authed, "Hidden from directory-company")
    code = await _type_with_scopes(
        authed,
        directory_scope="company",
        customer_scope="office",
        permissions=["Customers.View", "Users.View"],
    )
    viewer = await create_activated_user(authed, user_type_code=code, password="UserPass1!")
    async with await spawned_client() as viewer_client:
        await authenticate(viewer_client, viewer["email"], "UserPass1!")
        users = await viewer_client.get("/api/v1/users")
        assert users.status_code == 200
        directory = await viewer_client.get("/api/v1/customers")
        assert directory.status_code == 200
        assert directory.json()["items"] == []
        hidden = await viewer_client.get(f"/api/v1/customers/{created['id']}")
        assert hidden.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("customer_scope", ["office", "team", "own", None])
async def test_application_derived_customer_scopes_fail_closed(
    client: AsyncClient, customer_scope: str | None
) -> None:
    authed, _owner = await owner_client(client)
    created = await _create_customer(authed, f"Deferred {unique_tag()}")
    code = await _type_with_scopes(
        authed,
        directory_scope="company",
        customer_scope=customer_scope,
        permissions=["Customers.View", "Customers.Create"],
    )
    viewer = await create_activated_user(authed, user_type_code=code, password="UserPass1!")
    async with await spawned_client() as viewer_client:
        await authenticate(viewer_client, viewer["email"], "UserPass1!")
        mine = await _create_customer(viewer_client, f"Mine {unique_tag()}")
        directory = await viewer_client.get("/api/v1/customers")
        ids = {item["id"] for item in directory.json()["items"]}
        assert created["id"] not in ids
        assert mine["id"] not in ids
        hidden = await viewer_client.get(f"/api/v1/customers/{created['id']}")
        assert hidden.status_code == 403


@pytest.mark.asyncio
async def test_owner_customer_scope_is_company_and_locked(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    types = (await authed.get("/api/v1/user-types")).json()["items"]
    owner_type = next(item for item in types if item["code"] == "OWNER")
    assert owner_type["visibilityScope"] == "company"
    assert owner_type["customerVisibilityScope"] == "company"
    assert owner_type["applicationVisibilityScope"] == "company"
    locked = await authed.put(
        f"/api/v1/user-types/{owner_type['id']}/customer-scope",
        json={"customer_visibility_scope": "own"},
    )
    assert locked.status_code == 403
    assert locked.json()["error"]["code"] == "OWNER_PROTECTED"
