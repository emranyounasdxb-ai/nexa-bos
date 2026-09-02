from __future__ import annotations

import os
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from nexa_bos_api.main import app

OWNER_EMAIL = "owner@example.com"
OWNER_PASSWORD = "OwnerPass1!"
BOOTSTRAP_SECRET = os.environ.get("BOOTSTRAP_SECRET", "nexa-test-bootstrap-secret")


async def ensure_owner(client: AsyncClient) -> None:
    status = await client.get("/api/v1/auth/bootstrap-status")
    assert status.status_code == 200, status.text
    if not status.json()["available"]:
        return
    response = await client.post(
        "/api/v1/auth/bootstrap",
        json={
            "secret": BOOTSTRAP_SECRET,
            "full_name": "Platform Owner",
            "employee_code": "EMP-OWNER",
            "email": OWNER_EMAIL,
            "mobile": "+971500000000",
            "joining_date": "2026-01-01",
            "employment_status": "Active",
            "password": OWNER_PASSWORD,
            "designation_name": "Owner",
            "designation_code": "OWN",
        },
    )
    assert response.status_code == 200, response.text


async def authenticate(client: AsyncClient, email: str, password: str) -> dict:
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    body = response.json()
    assert "token" not in body
    client.headers["X-CSRF-Token"] = body["csrfToken"]
    return body["user"]


async def owner_client(client: AsyncClient) -> tuple[AsyncClient, dict]:
    await ensure_owner(client)
    user = await authenticate(client, OWNER_EMAIL, OWNER_PASSWORD)
    return client, user


async def spawned_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def unique_tag() -> str:
    return uuid4().hex[:10]


async def create_product_variant(
    client: AsyncClient,
    *,
    bank_id: str,
    product_id: str,
) -> dict:
    mappings = (
        await client.get(
            "/api/v1/bank-products",
            params={"bankId": bank_id, "productId": product_id},
        )
    ).json()["items"]
    assert len(mappings) == 1, mappings
    tag = unique_tag().upper()
    response = await client.post(
        "/api/v1/product-variants",
        json={
            "bank_product_id": mappings[0]["id"],
            "name": f"Test Variant {tag}",
            "code": f"TV{tag}",
            "description": "Isolated automated-test variant",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def designation_id(client: AsyncClient) -> str:
    rows = (await client.get("/api/v1/designations")).json()["items"]
    assert rows
    return rows[0]["id"]


async def office_id(client: AsyncClient, code: str) -> str:
    rows = (await client.get("/api/v1/offices")).json()["items"]
    return next(item["id"] for item in rows if item["code"] == code)


async def create_activated_user(
    client: AsyncClient,
    *,
    user_type_code: str = "SE",
    password: str | None = "UserPass1!",
    office_id: str | None = None,
    department_id: str | None = None,
    team_id: str | None = None,
    manager_id: str | None = None,
) -> dict:
    tag = unique_tag()
    payload = {
        "full_name": f"User {tag}",
        "employee_code": f"EMP-{tag}",
        "email": f"user-{tag}@example.com",
        "mobile": "+971500000099",
        "designation_id": await designation_id(client),
        "employment_status": "Active",
        "joining_date": "2026-02-01",
        "office_id": office_id,
        "department_id": department_id,
        "team_id": team_id,
        "reporting_manager_id": manager_id,
    }
    created = await client.post("/api/v1/users", json=payload)
    assert created.status_code == 200, created.text
    user = created.json()
    types = (await client.get("/api/v1/user-types")).json()["items"]
    user_type = next(item for item in types if item["code"] == user_type_code)
    assigned = await client.post(
        f"/api/v1/users/{user['id']}/assign-type",
        json={"user_type_id": user_type["id"]},
    )
    assert assigned.status_code == 200, assigned.text
    activated = await client.post(f"/api/v1/users/{user['id']}/activate")
    assert activated.status_code == 200, activated.text
    if password:
        setup = await client.post(f"/api/v1/auth/users/{user['id']}/setup-link")
        assert setup.status_code == 200, setup.text
        set_pw = await client.post(
            "/api/v1/auth/setup",
            json={"token": setup.json()["token"], "password": password},
        )
        assert set_pw.status_code == 200, set_pw.text
    refreshed = await client.get(f"/api/v1/users/{user['id']}")
    return refreshed.json()
