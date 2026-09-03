from __future__ import annotations

import asyncio

import pytest
from helpers import (
    OWNER_EMAIL,
    OWNER_PASSWORD,
    authenticate,
    create_activated_user,
    ensure_owner,
    owner_client,
    spawned_client,
)
from httpx import ASGITransport, AsyncClient


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
@pytest.mark.parametrize(
    "protected_path",
    [
        "/api/v1/auth/me",
        "/api/v1/notifications/unread-count",
        "/api/v1/reports/filters",
        "/api/v1/reports/comparisons?kind=period&period=month&metric=funded_value",
    ],
)
async def test_concurrent_session_replacement_fails_closed(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    protected_path: str,
) -> None:
    from nexa_bos_api.identity import auth_service
    from nexa_bos_api.main import app

    await ensure_owner(client)

    for _attempt in range(3):
        old_session_loaded = asyncio.Event()
        replacement_committed = asyncio.Event()
        gate_pending = True
        original_load_user = auth_service.load_user_with_type

        async def load_user_after_replacement(
            *args: object,
            _original_load_user=original_load_user,
            _old_session_loaded=old_session_loaded,
            _replacement_committed=replacement_committed,
            **kwargs: object,
        ) -> object:
            nonlocal gate_pending
            user = await _original_load_user(*args, **kwargs)
            if gate_pending:
                gate_pending = False
                _old_session_loaded.set()
                await asyncio.wait_for(_replacement_committed.wait(), timeout=5)
            return user

        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with (
            AsyncClient(transport=transport, base_url="http://testserver") as old_client,
            AsyncClient(
                transport=ASGITransport(app=app, raise_app_exceptions=False),
                base_url="http://testserver",
            ) as new_client,
        ):
            await authenticate(old_client, OWNER_EMAIL, OWNER_PASSWORD)
            with monkeypatch.context() as scoped_patch:
                scoped_patch.setattr(
                    auth_service,
                    "load_user_with_type",
                    load_user_after_replacement,
                )
                old_request = asyncio.create_task(old_client.get(protected_path))
                await asyncio.wait_for(old_session_loaded.wait(), timeout=5)
                try:
                    replacement = await new_client.post(
                        "/api/v1/auth/login",
                        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
                    )
                    assert replacement.status_code == 200, replacement.text
                finally:
                    replacement_committed.set()
                stale_response = await asyncio.wait_for(old_request, timeout=5)

            assert stale_response.status_code == 401, stale_response.text
            error = stale_response.json()["error"]
            assert error["code"] == "UNAUTHENTICATED"
            assert error["message"] == "Authentication required"
            assert error["details"] in (None, [])
            assert "StaleDataError" not in stale_response.text
            assert "expected to update" not in stale_response.text.lower()

            next_old_response = await old_client.get(protected_path)
            assert next_old_response.status_code == 401, next_old_response.text

            new_response = await new_client.get(protected_path)
            assert new_response.status_code == 200, new_response.text


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
