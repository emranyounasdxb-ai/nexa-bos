import os
from uuid import UUID, uuid4

import pytest
from helpers import authenticate, create_activated_user, owner_client, spawned_client
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

PERMISSION = "Users.TerminateSessions"


@pytest.mark.asyncio
async def test_owner_termination_revokes_sessions_only_and_is_audited(client):
    owner, actor = await owner_client(client)
    target = await create_activated_user(owner)
    other = await create_activated_user(owner)
    engine = create_async_engine(os.environ["DATABASE_URL"])
    async with await spawned_client() as user, await spawned_client() as unrelated:
        await authenticate(user, target["email"], "UserPass1!")
        await authenticate(unrelated, other["email"], "UserPass1!")
        async with engine.begin() as connection:
            # Defensive coverage for multiple pre-existing rows; normal login still
            # retains its unchanged single-active-session policy.
            await connection.execute(
                text(
                    "INSERT INTO sessions (id,user_id,token_hash,csrf_token_hash,"
                    "created_at,last_seen_at) "
                    "VALUES (:id,:user,:token,:csrf,now(),now())"
                ),
                {
                    "id": uuid4(),
                    "user": UUID(target["id"]),
                    "token": uuid4().hex * 2,
                    "csrf": uuid4().hex * 2,
                },
            )
        async with engine.connect() as connection:
            before = await connection.scalar(
                text("SELECT md5(to_jsonb(u)::text) FROM users u WHERE id=:id"),
                {"id": UUID(target["id"])},
            )
        response = await owner.post(
            f"/api/v1/users/{target['id']}/terminate-sessions",
            json={"reason": "  Reviewed session revocation  "},
        )
        assert response.status_code == 200, response.text
        assert response.json() == {"status": "ok", "sessionsRevoked": 2}
        assert (await user.get("/api/v1/auth/me")).status_code == 401
        assert (await unrelated.get("/api/v1/auth/me")).status_code == 200
        async with engine.connect() as connection:
            after = await connection.scalar(
                text("SELECT md5(to_jsonb(u)::text) FROM users u WHERE id=:id"),
                {"id": UUID(target["id"])},
            )
            assert after == before  # Entire user row, including status/password/contact/profile.
            event = (
                await connection.execute(
                    text(
                        "SELECT actor_id,target_user_id,new_values FROM audit_events "
                        "WHERE action='user.sessions.terminate' AND target_user_id=:id"
                    ),
                    {"id": UUID(target["id"])},
                )
            ).one()
            assert str(event.actor_id) == actor["id"]
            assert str(event.target_user_id) == target["id"]
            assert event.new_values == {
                "reason": "Reviewed session revocation",
                "sessionsRevoked": 2,
            }
        await authenticate(user, target["email"], "UserPass1!")
        assert (await user.get("/api/v1/auth/me")).status_code == 200
        # Deactivation retains its original, separate semantics.
        assert (await owner.post(f"/api/v1/users/{target['id']}/deactivate")).status_code == 200
        assert (await user.get("/api/v1/auth/me")).status_code == 401
        assert (await owner.get(f"/api/v1/users/{target['id']}")).json()[
            "accountStatus"
        ] == "deactivated"
    await engine.dispose()


@pytest.mark.asyncio
async def test_session_revocation_rolls_back_when_audit_cannot_persist(client):
    owner, _ = await owner_client(client)
    target = await create_activated_user(owner)
    engine = create_async_engine(os.environ["DATABASE_URL"])
    constraint = "test_session_audit_" + uuid4().hex
    async with await spawned_client() as user:
        await authenticate(user, target["email"], "UserPass1!")
        try:
            async with engine.begin() as connection:
                await connection.execute(
                    text(
                        f"ALTER TABLE audit_events ADD CONSTRAINT {constraint} "
                        "CHECK (action <> 'user.sessions.terminate' "
                        f"OR target_user_id <> '{UUID(target['id'])}')"
                    )
                )
            with pytest.raises(IntegrityError):
                await owner.post(
                    f"/api/v1/users/{target['id']}/terminate-sessions",
                    json={"reason": "Atomic audit test"},
                )
            assert (await user.get("/api/v1/auth/me")).status_code == 200
        finally:
            async with engine.begin() as connection:
                await connection.execute(
                    text(f"ALTER TABLE audit_events DROP CONSTRAINT {constraint}")
                )
            await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("code", ["GM", "HR", "PRO", "SE", "TL"])
async def test_no_default_grant_or_direct_id_access(client, code):
    owner, actor = await owner_client(client)
    target = await create_activated_user(owner, user_type_code=code)
    async with await spawned_client() as user:
        profile = await authenticate(user, target["email"], "UserPass1!")
        assert PERMISSION not in profile["permissions"]
        for user_id in (target["id"], actor["id"], str(uuid4())):
            denied = await user.post(
                f"/api/v1/users/{user_id}/terminate-sessions",
                json={"reason": "Unauthorized attempt"},
            )
            assert denied.status_code == 403
        assert (await user.get("/api/v1/auth/me")).status_code == 200


@pytest.mark.asyncio
async def test_termination_reason_csrf_and_missing_target(client):
    owner, _ = await owner_client(client)
    target = await create_activated_user(owner)
    path = f"/api/v1/users/{target['id']}/terminate-sessions"
    for body in (
        {},
        {"reason": "   "},
        {"reason": "x" * 1001},
        {"reason": "ok", "account_status": "deactivated"},
    ):
        assert (await owner.post(path, json=body)).status_code == 422
    assert (
        await owner.post(
            f"/api/v1/users/{uuid4()}/terminate-sessions", json={"reason": "Missing target"}
        )
    ).status_code == 404
    owner.headers.pop("X-CSRF-Token")
    assert (await owner.post(path, json={"reason": "No CSRF"})).status_code == 403


@pytest.mark.asyncio
async def test_explicit_permission_still_obeys_object_scope(client):
    owner, _ = await owner_client(client)
    actor = await create_activated_user(owner)
    target = await create_activated_user(owner)
    # A distinct, explicitly permissioned disposable type proves scope enforcement
    # independently of the permission denial; no default grants are modified.
    role = await owner.post(
        "/api/v1/user-types", json={"code": f"S{uuid4().hex[:10]}", "name": "Session scope test"}
    )
    assert role.status_code == 200, role.text
    role_id = role.json()["id"]
    activated = await owner.post(f"/api/v1/user-types/{role_id}/activate")
    assert activated.status_code == 200, activated.text
    permissions = await owner.put(
        f"/api/v1/user-types/{role_id}/permissions", json={"permissions": [PERMISSION]}
    )
    assert permissions.status_code == 200, permissions.text
    assert (
        await owner.post(f"/api/v1/users/{actor['id']}/assign-type", json={"user_type_id": role_id})
    ).status_code == 200
    async with await spawned_client() as user:
        await authenticate(user, actor["email"], "UserPass1!")
        denied = await user.post(
            f"/api/v1/users/{target['id']}/terminate-sessions", json={"reason": "Outside own scope"}
        )
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "OUT_OF_SCOPE"
        allowed = await user.post(
            f"/api/v1/users/{actor['id']}/terminate-sessions", json={"reason": "Own scoped control"}
        )
        assert allowed.status_code == 200
        assert (await user.get("/api/v1/auth/me")).status_code == 401
