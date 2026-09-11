import asyncio
import os
from uuid import uuid4

import pytest
from helpers import authenticate, create_activated_user, owner_client, spawned_client
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine


async def reserve(owner):
    response = await owner.post("/api/v1/users/code-reservations")
    assert response.status_code == 200, response.text
    return response.json()["userCode"]


@pytest.mark.asyncio
async def test_hr_update_does_not_reopen_historical_employment(client):
    owner, _ = await owner_client(client)
    user = await create_activated_user(owner)
    engine = create_async_engine(os.environ["DATABASE_URL"])
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "UPDATE employment_periods SET is_current=false WHERE user_id=CAST(:id AS uuid)"
                ),
                {"id": user["id"]},
            )
            before = (
                await connection.execute(
                    text(
                        "SELECT id,is_current FROM employment_periods "
                        "WHERE user_id=CAST(:id AS uuid)"
                    ),
                    {"id": user["id"]},
                )
            ).all()
            assert before
        response = await owner.put(
            f"/api/v1/employee-profiles/{user['id']}/hr",
            json={"hr_notes": "Historical employee profile correction"},
        )
        assert response.status_code == 200, response.text
        async with engine.connect() as connection:
            assert (
                await connection.execute(
                    text(
                        "SELECT id,is_current FROM employment_periods "
                        "WHERE user_id=CAST(:id AS uuid)"
                    ),
                    {"id": user["id"]},
                )
            ).all() == before
    finally:
        await engine.dispose()


async def basic(owner):
    payload = {
        "full_name": "New Basic Employee",
        "personal_email": f"{uuid4().hex}@example.test",
        "personal_mobile": "+971500000123",
        "user_code": await reserve(owner),
    }
    response = await owner.post("/api/v1/users", json=payload)
    assert response.status_code == 200, response.text
    return response.json(), payload


@pytest.mark.asyncio
async def test_basic_unassigned_employee_remains_visible_in_hierarchy(client):
    owner, _ = await owner_client(client)
    user, _ = await basic(owner)
    existing = await create_activated_user(owner)
    response = await owner.get("/api/v1/organization/hierarchy", params={"includeInactive": True})
    assert response.status_code == 200, response.text
    nodes = {node["id"]: node for node in response.json()["nodes"]}
    assert nodes[user["id"]]["employeeCode"] is None
    assert nodes[existing["id"]]["employeeCode"] == existing["employeeCode"]
    search = await owner.get(
        "/api/v1/organization/hierarchy",
        params={"includeInactive": True, "q": user["fullName"]},
    )
    assert search.status_code == 200, search.text
    assert user["id"] in {row["id"] for row in search.json()["searchResults"]}


@pytest.mark.asyncio
async def test_basic_setup_and_hr_identity_are_separate(client):
    owner, _ = await owner_client(client)
    user, payload = await basic(owner)
    assert user["userType"] is None
    assert user["accountStatus"] == "pending"  # Existing API value; UI labels Pending Setup.
    assert user["employeeCode"] is None
    assert user["joiningDate"] is None
    assert user["email"] == payload["personal_email"]
    assert user["fullName"] == payload["full_name"]
    assert (await owner.post(f"/api/v1/auth/users/{user['id']}/setup-link")).status_code == 422
    types = (await owner.get("/api/v1/user-types")).json()["items"]
    se = next(row for row in types if row["code"] == "SE")
    assert (
        await owner.post(f"/api/v1/users/{user['id']}/assign-type", json={"user_type_id": se["id"]})
    ).status_code == 200
    setup = await owner.post(f"/api/v1/auth/users/{user['id']}/setup-link")
    assert setup.status_code == 200, setup.text
    async with await spawned_client() as subject:
        response = await subject.post(
            "/api/v1/auth/setup", json={"token": setup.json()["token"], "password": "UserPass1!"}
        )
        assert response.status_code == 200, response.text
        assert (await authenticate(subject, user["email"], "UserPass1!"))[
            "accountStatus"
        ] == "active"
        assert (
            await subject.post(
                "/api/v1/auth/setup",
                json={"token": setup.json()["token"], "password": "OtherPass1!"},
            )
        ).status_code == 400
    assert (await owner.post(f"/api/v1/auth/users/{user['id']}/setup-link")).status_code == 409
    code = f"EMP-{uuid4().hex[:12]}"
    hr = await owner.put(
        f"/api/v1/employee-profiles/{user['id']}/hr",
        json={
            "employee_code": code,
            "joining_date": "2026-01-01",
            "work_email": f"work-{uuid4().hex}@example.test",
            "work_mobile": "+971500000999",
        },
    )
    assert hr.status_code == 200, hr.text
    refreshed = (await owner.get(f"/api/v1/users/{user['id']}")).json()
    assert refreshed["email"] == user["email"]
    assert refreshed["employeeCode"] == code
    assert refreshed["workEmail"] != refreshed["email"]
    cleared = await owner.put(
        f"/api/v1/employee-profiles/{user['id']}/hr", json={"work_email": None, "work_mobile": None}
    )
    assert cleared.status_code == 200, cleared.text
    assert {"Work email", "Work mobile"} <= set(cleared.json()["hr"]["completion"]["missing"])
    assert (await owner.get(f"/api/v1/users/{user['id']}")).json()["email"] == user["email"]
    immutable = await owner.put(
        f"/api/v1/employee-profiles/{user['id']}/hr", json={"employee_code": code + "-NEW"}
    )
    assert immutable.status_code == 409, immutable.text
    other, _ = await basic(owner)
    duplicate = await owner.put(
        f"/api/v1/employee-profiles/{other['id']}/hr", json={"employee_code": code.lower()}
    )
    assert duplicate.status_code == 409, duplicate.text
    assert duplicate.json()["error"]["message"] == "Employee Code has already been issued"


@pytest.mark.asyncio
async def test_reserved_codes_concurrent_unique_and_single_consumption(client):
    owner, _ = await owner_client(client)
    codes = await asyncio.gather(*(reserve(owner) for _ in range(6)))
    assert len(set(codes)) == 6
    payload = {
        "full_name": "Concurrent Basic",
        "personal_mobile": "+971500000111",
        "user_code": codes[0],
    }
    responses = await asyncio.gather(
        *(
            owner.post(
                "/api/v1/users", json={**payload, "personal_email": f"{uuid4().hex}@example.test"}
            )
            for _ in range(2)
        )
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    loser = next(response for response in responses if response.status_code == 409)
    assert loser.json()["error"]["code"] == "USER_CODE_UNAVAILABLE"


@pytest.mark.asyncio
async def test_basic_validation_email_uniqueness_and_code_authorization(client):
    owner, _ = await owner_client(client)
    user, payload = await basic(owner)
    duplicate = await owner.post(
        "/api/v1/users",
        json={
            **payload,
            "personal_email": payload["personal_email"].upper(),
            "user_code": await reserve(owner),
        },
    )
    assert duplicate.status_code == 409, duplicate.text
    for invalid in ("", "   "):
        response = await owner.post(
            "/api/v1/users",
            json={**payload, "full_name": invalid, "user_code": await reserve(owner)},
        )
        assert response.status_code == 422, response.text
    async with await spawned_client() as anonymous:
        assert (await anonymous.post("/api/v1/users/code-reservations")).status_code == 401
        assert (await anonymous.post("/api/v1/users", json=payload)).status_code == 401


@pytest.mark.asyncio
async def test_basic_creation_audit_failure_rolls_back_user_and_reservation(client):
    owner, _ = await owner_client(client)
    code = await reserve(owner)
    payload = {
        "full_name": "Rollback Basic",
        "personal_mobile": "+971500000123",
        "personal_email": f"{uuid4().hex}@example.test",
        "user_code": code,
    }
    engine = create_async_engine(os.environ["DATABASE_URL"])
    constraint = "test_basic_audit_" + uuid4().hex
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    f"ALTER TABLE audit_events ADD CONSTRAINT {constraint} "
                    f"CHECK (action <> 'user.create' OR new_values->>'userCode' <> '{code}')"
                )
            )
        with pytest.raises(IntegrityError):
            await owner.post("/api/v1/users", json=payload)
        async with engine.connect() as connection:
            assert (
                await connection.scalar(
                    text("SELECT count(*) FROM users WHERE user_code=:code"), {"code": code}
                )
                == 0
            )
            assert (
                await connection.scalar(
                    text("SELECT user_id FROM user_code_reservations WHERE user_code=:code"),
                    {"code": code},
                )
                is None
            )
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f"ALTER TABLE audit_events DROP CONSTRAINT {constraint}"))
        await engine.dispose()
    response = await owner.post("/api/v1/users", json=payload)
    assert response.status_code == 200, response.text
