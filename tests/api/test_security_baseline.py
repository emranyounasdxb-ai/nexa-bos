from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from helpers import (
    BOOTSTRAP_SECRET,
    OWNER_EMAIL,
    OWNER_PASSWORD,
    authenticate,
    create_activated_user,
    office_id,
    owner_client,
    spawned_client,
    unique_tag,
)
from httpx import AsyncClient
from nexa_bos_api.identity.models import AuditEvent, OneTimeToken, Session
from nexa_bos_api.main import app
from sqlalchemy import select

TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def _type_with(
    client: AsyncClient,
    permissions: list[str],
    *,
    directory_scope: str | None = "office",
    reporting_scope: str | None = None,
    application_scope: str | None = None,
    customer_scope: str | None = None,
) -> str:
    tag = unique_tag().upper()
    created = await client.post(
        "/api/v1/user-types",
        json={"name": f"Sec {tag}", "code": f"Z{tag[:8]}"},
    )
    assert created.status_code == 200, created.text
    type_id = created.json()["id"]
    await client.post(f"/api/v1/user-types/{type_id}/activate")
    await client.put(f"/api/v1/user-types/{type_id}/permissions", json={"permissions": permissions})
    if directory_scope is not None:
        await client.put(
            f"/api/v1/user-types/{type_id}/scope", json={"visibility_scope": directory_scope}
        )
    if reporting_scope is not None:
        await client.put(
            f"/api/v1/user-types/{type_id}/reporting-scope",
            json={"reporting_visibility_scope": reporting_scope},
        )
    if application_scope is not None:
        await client.put(
            f"/api/v1/user-types/{type_id}/application-scope",
            json={"application_visibility_scope": application_scope},
        )
    if customer_scope is not None:
        await client.put(
            f"/api/v1/user-types/{type_id}/customer-scope",
            json={"customer_visibility_scope": customer_scope},
        )
    return created.json()["code"]


@pytest.mark.asyncio
async def test_auth_session_csrf_lockout_and_deactivation(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    async with await spawned_client() as anon:
        unauth = await anon.get("/api/v1/users")
        assert unauth.status_code == 401

    async with await spawned_client() as bogus:
        bogus.cookies.set("nexa_session", "not-a-real-session")
        invalid = await bogus.get("/api/v1/auth/me")
        assert invalid.status_code == 401

    user = await create_activated_user(authed, password="UserPass1!")
    async with await spawned_client() as live:
        await authenticate(live, user["email"], "UserPass1!")
        assert (await live.get("/api/v1/auth/me")).status_code == 200
        async with app.state.session_factory() as session:
            row = (
                await session.execute(select(Session).where(Session.user_id == UUID(user["id"])))
            ).scalar_one()
            row.last_seen_at = datetime.now(UTC) - timedelta(hours=2)
            await session.commit()
        expired = await live.get("/api/v1/auth/me")
        assert expired.status_code == 401

    async with await spawned_client() as first, await spawned_client() as second:
        await authenticate(first, user["email"], "UserPass1!")
        await authenticate(second, user["email"], "UserPass1!")
        assert (await first.get("/api/v1/auth/me")).status_code == 401
        assert (await second.get("/api/v1/auth/me")).status_code == 200

    async with await spawned_client() as live:
        await authenticate(live, user["email"], "UserPass1!")
        await authed.post(f"/api/v1/users/{user['id']}/deactivate")
        assert (await live.get("/api/v1/auth/me")).status_code == 401
        login = await client.post(
            "/api/v1/auth/login", json={"email": user["email"], "password": "UserPass1!"}
        )
        assert login.status_code == 401

    code = await _type_with(authed, ["Users.View"], directory_scope="company")
    typed = await create_activated_user(authed, user_type_code=code, password="UserPass1!")
    types = (await authed.get("/api/v1/user-types")).json()["items"]
    type_id = next(item["id"] for item in types if item["code"] == code)
    async with await spawned_client() as live:
        await authenticate(live, typed["email"], "UserPass1!")
        assert (await live.get("/api/v1/users")).status_code == 200
        await authed.post(f"/api/v1/user-types/{type_id}/deactivate")
        assert (await live.get("/api/v1/users")).status_code == 401
        blocked_login = await client.post(
            "/api/v1/auth/login", json={"email": typed["email"], "password": "UserPass1!"}
        )
        assert blocked_login.status_code == 403
        assert blocked_login.json()["error"]["code"] == "USER_TYPE_INACTIVE"

    locked = await create_activated_user(authed, password="TempPass1!")
    last = None
    for _ in range(5):
        last = await client.post(
            "/api/v1/auth/login", json={"email": locked["email"], "password": "BadPass1!"}
        )
    assert last is not None and last.status_code == 423
    viewer_code = await _type_with(authed, ["Users.View"], directory_scope="company")
    viewer = await create_activated_user(
        authed, user_type_code=viewer_code, password="UserPass1!"
    )
    async with await spawned_client() as other:
        await authenticate(other, viewer["email"], "UserPass1!")
        unlock = await other.post(f"/api/v1/users/{locked['id']}/unlock")
        assert unlock.status_code == 403
    owner_unlock = await authed.post(f"/api/v1/users/{locked['id']}/unlock")
    assert owner_unlock.status_code == 200

    async with await spawned_client() as csrf_client:
        await authenticate(csrf_client, OWNER_EMAIL, OWNER_PASSWORD)
        csrf_client.headers.pop("X-CSRF-Token", None)
        missing_patch = await csrf_client.patch(
            "/api/v1/users/me", json={"mobile": "+971500000099"}
        )
        assert missing_patch.status_code == 403
        assert missing_patch.json()["error"]["code"] == "CSRF_INVALID"
        missing_post = await csrf_client.post(f"/api/v1/users/{locked['id']}/unlock")
        assert missing_post.status_code == 403
        assert missing_post.json()["error"]["code"] == "CSRF_INVALID"
        csrf_client.headers["X-CSRF-Token"] = "forged-csrf-token"
        forged_patch = await csrf_client.patch(
            "/api/v1/users/me", json={"mobile": "+971500000099"}
        )
        assert forged_patch.status_code == 403
        type_id = (await csrf_client.get("/api/v1/user-types")).json()["items"][0]["id"]
        forged_put = await csrf_client.put(
            f"/api/v1/user-types/{type_id}/permissions",
            json={"permissions": ["Users.View"]},
        )
        assert forged_put.status_code == 403
        forged_delete = await csrf_client.delete(f"/api/v1/users/{owner['id']}")
        assert forged_delete.status_code in {403, 405}


@pytest.mark.asyncio
async def test_authorization_six_scenarios_and_idor(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    office_code = await _type_with(
        authed,
        ["Users.View", "Customers.View", "Applications.View", "Targets.View", "Attendance.View"],
        directory_scope="office",
        reporting_scope="office",
        application_scope="office",
        customer_scope="office",
    )
    alice = await create_activated_user(
        authed, user_type_code=office_code, password="UserPass1!", office_id=dxb
    )
    bob = await create_activated_user(authed, user_type_code="SE", office_id=auh)
    customer = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": f"Bob Cust {unique_tag()}",
            "mobile": f"+97150{unique_tag()[:8]}",
        },
    )
    assert customer.status_code == 200, customer.text
    async with await spawned_client() as a_client:
        await authenticate(a_client, alice["email"], "UserPass1!")
        hidden_user = await a_client.get(f"/api/v1/users/{bob['id']}")
        assert hidden_user.status_code == 403
        hidden_customer = await a_client.get(f"/api/v1/customers/{customer.json()['id']}")
        assert hidden_customer.status_code in {403, 404}
        attendance = await a_client.get(
            f"/api/v1/attendance/employees/{bob['id']}/summary",
            params={"date_from": "2026-08-01", "date_to": "2026-08-31"},
        )
        assert attendance.status_code in {403, 404}
        admin = await a_client.post(
            "/api/v1/user-types", json={"name": "Nope", "code": f"N{unique_tag()[:8]}"}
        )
        assert admin.status_code == 403
        edit = await a_client.patch(f"/api/v1/users/{bob['id']}", json={"mobile": "+971500000088"})
        assert edit.status_code == 403
        security = await a_client.get("/api/v1/security-settings")
        assert security.status_code == 403
        owner_type_id = next(
            item["id"]
            for item in (await authed.get("/api/v1/user-types")).json()["items"]
            if item["code"] == "OWNER"
        )
        types = await a_client.post(
            f"/api/v1/users/{alice['id']}/assign-type",
            json={"user_type_id": owner_type_id},
        )
        assert types.status_code == 403
        escalate = await a_client.patch(
            "/api/v1/users/me",
            json={
                "mobile": "+971500000077",
                "user_type_id": bob["id"],
                "account_status": "active",
                "is_owner": True,
                "permissions": ["Users.Edit"],
            },
        )
        assert escalate.status_code == 200
        assert escalate.json()["userType"]["code"] != "OWNER"
        assert escalate.json()["mobile"] == "+971500000077"


@pytest.mark.asyncio
async def test_scope_tampering_targets_reports_and_privilege(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    own_code = await _type_with(
        authed,
        ["Reports.View", "Dashboard.View", "Targets.View", "Targets.Create", "Users.View"],
        directory_scope="own",
        reporting_scope="own",
    )
    scoped = await create_activated_user(
        authed, user_type_code=own_code, password="UserPass1!", office_id=dxb
    )
    other = await create_activated_user(authed, office_id=auh)
    catalog = (await authed.get("/api/v1/products")).json()["items"]
    products = {item["code"]: item for item in catalog}
    target = await authed.post(
        "/api/v1/targets",
        json={
            "level": "employee",
            "entity_id": other["id"],
            "period_month": "2035-01-01",
            "product_id": products["PF"]["id"],
            "milestone": "submitted",
            "target_value": "10",
        },
    )
    assert target.status_code == 200, target.text
    async with await spawned_client() as other_client:
        await authenticate(other_client, scoped["email"], "UserPass1!")
        leaked = await other_client.get(f"/api/v1/targets/{target.json()['id']}")
        assert leaked.status_code == 404
        bypass = await other_client.get(
            f"/api/v1/reports/dashboard?employee_id={other['id']}&office_id={auh}&reporting_scope=company"
        )
        assert bypass.status_code == 200
        assert bypass.json().get("empty") is True or bypass.json()["reportingScope"] != "Company"
        profile = await other_client.get(f"/api/v1/reports/employees/{other['id']}")
        assert profile.status_code == 404
        create_for_other = await other_client.post(
            "/api/v1/targets",
            json={
                "level": "employee",
                "entity_id": other["id"],
                "period_month": "2035-02-01",
                "product_id": products["PF"]["id"],
                "milestone": "approved",
                "target_value": "1",
            },
        )
        assert create_for_other.status_code == 403
        owner_type = next(
            item
            for item in (await authed.get("/api/v1/user-types")).json()["items"]
            if item["code"] == "OWNER"
        )
        self_owner = await other_client.post(
            f"/api/v1/users/{scoped['id']}/assign-type",
            json={"user_type_id": owner_type["id"]},
        )
        assert self_owner.status_code == 403
        perms = await other_client.put(
            f"/api/v1/user-types/{owner_type['id']}/permissions",
            json={"permissions": ["Users.Edit"]},
        )
        assert perms.status_code == 403
        deactivate_owner = await other_client.post(f"/api/v1/users/{owner['id']}/deactivate")
        assert deactivate_owner.status_code == 403


@pytest.mark.asyncio
async def test_export_leakage_and_csv_rejected(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    view_only = await _type_with(
        authed,
        ["Reports.View", "Dashboard.View"],
        directory_scope="company",
        reporting_scope="company",
    )
    limited = await create_activated_user(authed, user_type_code=view_only, password="UserPass1!")
    async with await spawned_client() as other:
        await authenticate(other, limited["email"], "UserPass1!")
        for fmt in ("xlsx", "pdf", "print"):
            denied = await other.post(
                "/api/v1/reports/export",
                json={"format": fmt, "report": "dashboard", "period": "mtd"},
            )
            assert denied.status_code == 403
        csv = await other.post(
            "/api/v1/reports/export",
            json={"format": "csv", "report": "dashboard", "period": "mtd"},
        )
        assert csv.status_code == 422


@pytest.mark.asyncio
async def test_mass_assignment_xss_injection_and_deletes_rejected(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    payload_name = f"<script>alert(1)</script> probe {unique_tag()}"
    created = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": payload_name,
            "mobile": f"+97150{unique_tag()[:8]}",
            "is_owner": True,
            "permissions": ["Users.Edit"],
                "account_status": "merged",
                "create_anyway": True,
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["fullName"] == payload_name
    assert body["status"] != "merged"
    listed = await authed.get("/api/v1/customers", params={"q": "' OR 1=1 --"})
    assert listed.status_code == 200
    assert body["id"] not in {item["id"] for item in listed.json()["items"]}
    injected = await authed.get("/api/v1/users", params={"q": "'; DROP TABLE users; --"})
    assert injected.status_code == 200
    assert owner["id"] not in {item["id"] for item in injected.json()["items"]}
    users = await authed.get("/api/v1/users")
    assert users.status_code == 200
    assert any(item["id"] == owner["id"] for item in users.json()["items"])
    deleted_user = await authed.delete(f"/api/v1/users/{owner['id']}")
    assert deleted_user.status_code == 405
    deleted_customer = await authed.delete(f"/api/v1/customers/{body['id']}")
    assert deleted_customer.status_code == 405
    offices = (await authed.get("/api/v1/offices")).json()["items"]
    deleted_office = await authed.delete(f"/api/v1/offices/{offices[0]['id']}")
    assert deleted_office.status_code == 405
    audit_delete = await authed.delete(f"/api/v1/users/{owner['id']}/history")
    assert audit_delete.status_code in {404, 405}
    history = await authed.get(f"/api/v1/users/{owner['id']}/history")
    assert history.status_code == 200
    assert history.json()["events"]


@pytest.mark.asyncio
async def test_bootstrap_and_one_time_tokens(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    status = await client.get("/api/v1/auth/bootstrap-status")
    assert status.json()["available"] is False
    reused = await client.post(
        "/api/v1/auth/bootstrap",
        json={
            "secret": BOOTSTRAP_SECRET,
            "full_name": "Second Owner",
            "employee_code": "EMP-SECOND",
            "email": "second-owner@example.com",
            "mobile": "+971500000001",
            "joining_date": "2026-01-01",
            "employment_status": "Active",
            "password": "OwnerPass1!",
            "designation_name": "Owner",
            "designation_code": "OWN",
        },
    )
    assert reused.status_code == 409
    user = await create_activated_user(authed, password=None)
    setup = await authed.post(f"/api/v1/auth/users/{user['id']}/setup-link")
    token = setup.json()["token"]
    first = await client.post(
        "/api/v1/auth/setup", json={"token": token, "password": "UserPass1!"}
    )
    assert first.status_code == 200, first.text
    second = await client.post(
        "/api/v1/auth/setup", json={"token": token, "password": "UserPass2!"}
    )
    assert second.status_code == 400
    reset = await authed.post(f"/api/v1/auth/users/{user['id']}/reset-link")
    reset_token = reset.json()["token"]
    wrong_purpose = await client.post(
        "/api/v1/auth/setup", json={"token": reset_token, "password": "UserPass3!"}
    )
    assert wrong_purpose.status_code == 400
    async with app.state.session_factory() as session:
        row = (
            await session.execute(
                select(OneTimeToken).where(OneTimeToken.user_id == UUID(user["id"]))
            )
        ).scalars().all()
        latest = max(row, key=lambda item: item.expires_at)
        latest.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()
    expired = await client.post(
        "/api/v1/auth/reset", json={"token": reset_token, "password": "UserPass3!"}
    )
    assert expired.status_code == 400


@pytest.mark.asyncio
async def test_audit_access_and_photo_upload_security(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    no_audit = await _type_with(authed, ["Users.View"], directory_scope="office")
    viewer = await create_activated_user(
        authed, user_type_code=no_audit, password="UserPass1!", office_id=dxb
    )
    outsider = await create_activated_user(authed, office_id=auh)
    async with await spawned_client() as other:
        await authenticate(other, viewer["email"], "UserPass1!")
        hidden = await other.get(f"/api/v1/users/{outsider['id']}/history")
        assert hidden.status_code == 403
        own = await other.get(f"/api/v1/users/{viewer['id']}/history")
        assert own.status_code == 200
        peer_history = await other.get(f"/api/v1/users/{owner['id']}/history")
        if peer_history.status_code == 200:
            assert peer_history.json()["events"] == []
        else:
            assert peer_history.status_code == 403

    photo = await authed.post(
        f"/api/v1/users/{outsider['id']}/photo",
        files={"file": ("note.exe", TINY_PNG, "application/x-msdownload")},
    )
    assert photo.status_code == 422
    huge = await authed.post(
        f"/api/v1/users/{outsider['id']}/photo",
        files={"file": ("big.png", b"x" * (2 * 1024 * 1024 + 1), "image/png")},
    )
    assert huge.status_code == 422
    stored = await authed.post(
        f"/api/v1/users/{outsider['id']}/photo",
        files={"file": ("../../etc/passwd.png", TINY_PNG, "image/png")},
    )
    assert stored.status_code == 200, stored.text
    assert stored.json()["hasPhoto"] is True
    fetched = await authed.get(f"/api/v1/users/{outsider['id']}/photo")
    assert fetched.status_code == 200
    async with await spawned_client() as other:
        await authenticate(other, viewer["email"], "UserPass1!")
        stolen = await other.get(f"/api/v1/users/{outsider['id']}/photo")
        assert stolen.status_code == 403
    async with app.state.session_factory() as session:
        actions = {
            row[0]
            for row in (
                await session.execute(
                    select(AuditEvent.action).where(AuditEvent.actor_id == UUID(owner["id"]))
                )
            ).all()
        }
    assert "user.photo" in actions
