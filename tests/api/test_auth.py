from __future__ import annotations

import pytest
from httpx import AsyncClient

from helpers import (
    OWNER_EMAIL,
    OWNER_PASSWORD,
    authenticate,
    create_activated_user,
    owner_client,
    spawned_client,
)


@pytest.mark.asyncio
async def test_login_sets_httponly_cookie_not_bearer_token(client: AsyncClient) -> None:
    from helpers import ensure_owner

    await ensure_owner(client)
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
    )
    assert response.status_code == 200
    body = response.json()
    assert "token" not in body
    assert body["csrfToken"]
    assert body["user"]["userType"]["code"] == "OWNER"
    cookie = response.cookies.get("nexa_session")
    assert cookie
    assert "httponly" in response.headers.get("set-cookie", "").lower()


@pytest.mark.asyncio
async def test_login_rejects_bad_password(client: AsyncClient) -> None:
    from helpers import ensure_owner

    await ensure_owner(client)
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": OWNER_EMAIL, "password": "WrongPass1!"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_FAILED"


@pytest.mark.asyncio
async def test_me_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_csrf_required_on_state_changing_requests(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    authed.headers.pop("X-CSRF-Token", None)
    response = await authed.post("/api/v1/auth/logout")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_INVALID"


@pytest.mark.asyncio
async def test_lockout_after_five_failures(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    user = await create_activated_user(authed, password="TempPass1!")
    last = None
    for _ in range(5):
        last = await client.post(
            "/api/v1/auth/login",
            json={"email": user["email"], "password": "BadPass1!"},
        )
    assert last is not None
    assert last.status_code == 423
    assert last.json()["error"]["code"] == "ACCOUNT_LOCKED"


@pytest.mark.asyncio
async def test_password_policy(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    user = await create_activated_user(authed, password=None)
    setup = await authed.post(f"/api/v1/auth/users/{user['id']}/setup-link")
    response = await client.post(
        "/api/v1/auth/setup",
        json={"token": setup.json()["token"], "password": "noupperornumber"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PASSWORD_POLICY"


@pytest.mark.asyncio
async def test_mfa_not_required_for_login(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    setup = await authed.post("/api/v1/auth/mfa/setup")
    assert setup.status_code == 200
    assert setup.json()["secret"]
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
    )
    assert login.status_code == 200
    assert login.json()["user"]["id"] == owner["id"]


@pytest.mark.asyncio
async def test_one_active_session_replaces_previous(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    first_csrf = authed.headers["X-CSRF-Token"]
    async with await spawned_client() as other:
        await authenticate(other, OWNER_EMAIL, OWNER_PASSWORD)
        me = await other.get("/api/v1/auth/me")
        assert me.status_code == 200
        assert me.json()["id"] == owner["id"]
    authed.headers["X-CSRF-Token"] = first_csrf
    stale = await authed.get("/api/v1/auth/me")
    assert stale.status_code == 401


@pytest.mark.asyncio
async def test_csrf_token_stable_across_me_requests(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    csrf = authed.headers["X-CSRF-Token"]
    first = await authed.get("/api/v1/auth/me")
    second = await authed.get("/api/v1/auth/me")
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["csrfToken"] == csrf
    assert second.json()["csrfToken"] == csrf
    created = await create_activated_user(authed)
    assert created["id"]
    logout = await authed.post("/api/v1/auth/logout")
    assert logout.status_code == 200, logout.text
