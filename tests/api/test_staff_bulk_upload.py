from __future__ import annotations

import asyncio
import csv
import io

import pytest
from helpers import authenticate, create_activated_user, owner_client, spawned_client, unique_tag
from httpx import AsyncClient
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import create_engine, create_session_factory
from nexa_bos_api.identity.models import User
from sqlalchemy import func, select


def csv_file(headers: list[str], rows: list[list[str]]) -> dict[str, tuple[str, bytes, str]]:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return {"file": ("staff.csv", output.getvalue().encode("utf-8"), "text/csv")}


async def find_user(email: str) -> User | None:
    engine = create_engine(get_settings())
    try:
        async with create_session_factory(engine)() as session:
            return await session.scalar(select(User).where(func.lower(User.email) == email.lower()))
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_bulk_upload_is_owner_only_and_sample_matches_schema(client: AsyncClient) -> None:
    owner, _ = await owner_client(client)
    schema = await owner.get("/api/v1/users/bulk-upload/schema")
    sample = await owner.get("/api/v1/users/bulk-upload/sample")
    assert schema.status_code == 200
    assert sample.status_code == 200
    assert sample.headers["content-type"].startswith("text/csv")
    parsed = list(csv.reader(io.StringIO(sample.content.decode("utf-8-sig"))))
    fields = schema.json()["fields"]
    assert parsed[0] == [field["name"] for field in fields]
    assert [field["name"] for field in fields if field["required"]] == [
        "full_name",
        "personal_email",
        "mobile",
    ]
    validation = await owner.post(
        "/api/v1/users/bulk-upload/validate",
        files={"file": ("sample.csv", sample.content, "text/csv")},
    )
    assert validation.status_code == 200
    assert validation.json() == {"valid": True, "rowCount": 1, "errors": []}
    assert await find_user("sample.staff@nexa-bos-sample.com") is None

    restricted_user = await create_activated_user(owner, user_type_code="SE")
    async with await spawned_client() as restricted:
        await authenticate(restricted, restricted_user["email"], "UserPass1!")
        payload = csv_file(
            ["full_name", "personal_email", "mobile"],
            [["Denied Staff", f"denied-{unique_tag()}@example.com", "+971500000001"]],
        )
        for response in (
            await restricted.get("/api/v1/users/bulk-upload/schema"),
            await restricted.get("/api/v1/users/bulk-upload/sample"),
            await restricted.post("/api/v1/users/bulk-upload/validate", files=payload),
            await restricted.post("/api/v1/users/bulk-upload/import", files=payload),
        ):
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "OWNER_REQUIRED"


@pytest.mark.asyncio
async def test_minimum_fields_import_optional_absence_and_retry_are_safe(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    tag = unique_tag()
    email = f"bulk-min-{tag}@example.com"
    payload = csv_file(
        ["full_name", "personal_email", "mobile"],
        [["Minimum Staff", email, "001234567"]],
    )
    validation = await owner.post("/api/v1/users/bulk-upload/validate", files=payload)
    assert validation.status_code == 200
    assert validation.json() == {"valid": True, "rowCount": 1, "errors": []}
    imported = await owner.post("/api/v1/users/bulk-upload/import", files=payload)
    assert imported.status_code == 200
    assert imported.json()["importedCount"] == 1

    user = await find_user(email)
    assert user is not None
    assert user.user_code.startswith("USR-")
    assert user.mobile == "001234567"
    assert user.personal_mobile == "001234567"
    assert user.employee_code is None
    assert user.joining_date is None
    assert user.user_type_id is None
    assert user.account_status == "pending"
    assert user.employment_status == "Inactive"
    profile = await owner.get(f"/api/v1/employee-profiles/{user.id}")
    assert profile.status_code == 200
    assert profile.json()["hr"]["data"] is None
    assert profile.json()["pro"]["documents"] == []

    repeated = await owner.post("/api/v1/users/bulk-upload/import", files=payload)
    assert repeated.status_code == 422
    assert repeated.json()["error"]["code"] == "CSV_VALIDATION_FAILED"
    assert await find_user(email) is not None

    blank_email = f"bulk-blank-{tag}@example.com"
    blank_payload = csv_file(
        [
            "full_name",
            "personal_email",
            "mobile",
            "employee_code",
            "date_of_joining",
            "nationality",
            "emirates_id_number",
            "passport_number",
            "designation_code",
            "user_type_code",
        ],
        [["Blank Optional Staff", blank_email, "009876543", "", "", "", "", "", "", ""]],
    )
    blank_validation = await owner.post("/api/v1/users/bulk-upload/validate", files=blank_payload)
    assert blank_validation.json() == {"valid": True, "rowCount": 1, "errors": []}
    assert (
        await owner.post("/api/v1/users/bulk-upload/import", files=blank_payload)
    ).status_code == 200
    blank_user = await find_user(blank_email)
    assert blank_user is not None
    blank_profile = (await owner.get(f"/api/v1/employee-profiles/{blank_user.id}")).json()
    assert blank_profile["hr"]["data"] is None
    assert blank_profile["pro"]["documents"] == []

    concurrent_email = f"bulk-concurrent-{tag}@example.com"
    concurrent_payload = csv_file(
        ["full_name", "personal_email", "mobile"],
        [["Concurrent Staff", concurrent_email, "+971500000099"]],
    )
    first, second = await asyncio.gather(
        owner.post("/api/v1/users/bulk-upload/import", files=concurrent_payload),
        owner.post("/api/v1/users/bulk-upload/import", files=concurrent_payload),
    )
    assert sorted([first.status_code, second.status_code]) == [200, 422]
    assert await find_user(concurrent_email) is not None


@pytest.mark.asyncio
async def test_validation_reports_headers_duplicates_formats_and_reserved_identity(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    existing = await create_activated_user(owner)
    duplicate = existing["email"]
    replacement_email = f"bulk-current-{unique_tag()}@example.com"
    changed = await owner.patch(
        f"/api/v1/users/{existing['id']}", json={"email": replacement_email}
    )
    assert changed.status_code == 200
    duplicate_employee_code = existing["employeeCode"]
    payload = csv_file(
        [
            "full_name",
            "personal_email",
            "mobile",
            "employee_code",
            "date_of_joining",
            "role",
        ],
        [
            [
                "Existing",
                duplicate,
                "+971500000010",
                duplicate_employee_code,
                "13/09/2026",
                "admin",
            ],
            [
                "Repeated",
                duplicate,
                "+971500000011",
                duplicate_employee_code,
                "2026-09-13",
                "coordinator",
            ],
        ],
    )
    header_failure = await owner.post("/api/v1/users/bulk-upload/validate", files=payload)
    assert header_failure.status_code == 200
    assert header_failure.json()["valid"] is False
    assert any(
        error["field"] == "role" and "designation_code or user_type_code" in error["message"]
        for error in header_failure.json()["errors"]
    )

    payload = csv_file(
        ["full_name", "personal_email", "mobile", "employee_code", "date_of_joining"],
        [
            ["Existing", duplicate, "+971500000010", duplicate_employee_code, "13/09/2026"],
            ["Repeated", duplicate, "+971500000011", duplicate_employee_code, "2026-09-13"],
        ],
    )
    validation = await owner.post("/api/v1/users/bulk-upload/validate", files=payload)
    assert validation.status_code == 200
    body = validation.json()
    assert body["valid"] is False
    assert {error["row"] for error in body["errors"]} == {2, 3}
    assert any(error["field"] == "date_of_joining" for error in body["errors"])
    assert any(
        error["field"] == "personal_email" and "historical" in error["message"]
        for error in body["errors"]
    )
    assert any(
        error["field"] == "personal_email" and "row 2" in error["message"]
        for error in body["errors"]
    )
    assert any(
        error["field"] == "employee_code" and "row 2" in error["message"]
        for error in body["errors"]
    )
    assert any(
        error["field"] == "employee_code" and "already been issued" in error["message"]
        for error in body["errors"]
    )

    missing_header = await owner.post(
        "/api/v1/users/bulk-upload/validate",
        files=csv_file(
            ["full_name", "personal_email"],
            [["Missing mobile", f"missing-{unique_tag()}@example.com"]],
        ),
    )
    assert any(error["field"] == "mobile" for error in missing_header.json()["errors"])


@pytest.mark.asyncio
async def test_optional_hr_pro_and_reference_codes_map_without_activation(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    tag = unique_tag().upper()
    office = (
        await owner.post("/api/v1/offices", json={"name": f"Bulk Office {tag}", "code": f"O{tag}"})
    ).json()
    department = (
        await owner.post(
            "/api/v1/departments",
            json={"office_id": office["id"], "name": f"Bulk Department {tag}", "code": f"D{tag}"},
        )
    ).json()
    unit = (
        await owner.post(
            "/api/v1/business-units",
            json={
                "office_id": office["id"],
                "department_id": department["id"],
                "name": f"Bulk Unit {tag}",
                "code": f"B{tag}",
            },
        )
    ).json()
    team = (
        await owner.post(
            "/api/v1/teams",
            json={
                "office_id": office["id"],
                "department_id": department["id"],
                "business_unit_id": unit["id"],
                "name": f"Bulk Team {tag}",
                "code": f"T{tag}",
            },
        )
    ).json()
    designation = (
        await owner.post(
            "/api/v1/designations",
            json={"name": f"Bulk Designation {tag}", "code": f"J{tag}"},
        )
    ).json()
    se_type = next(
        item
        for item in (await owner.get("/api/v1/user-types")).json()["items"]
        if item["code"] == "SE"
    )
    email = f"bulk-full-{tag.lower()}@example.com"
    headers = [
        "full_name",
        "personal_email",
        "mobile",
        "employee_code",
        "date_of_joining",
        "nationality",
        "gender",
        "marital_status",
        "emirates_id_number",
        "passport_number",
        "designation_code",
        "office_code",
        "department_code",
        "business_unit_code",
        "team_code",
        "user_type_code",
    ]
    payload = csv_file(
        headers,
        [
            [
                "Mapped Staff",
                email,
                "+971500000020",
                f"EMP-{tag}",
                "2026-09-01",
                "Pakistani",
                "Male",
                "Single",
                "000-0000-0000000-0",
                "P0000123",
                designation["code"],
                office["code"],
                department["code"],
                unit["code"],
                team["code"],
                se_type["code"],
            ]
        ],
    )
    assert (await owner.post("/api/v1/users/bulk-upload/validate", files=payload)).json()["valid"]
    imported = await owner.post("/api/v1/users/bulk-upload/import", files=payload)
    assert imported.status_code == 200
    user = await find_user(email)
    assert user is not None
    profile = (await owner.get(f"/api/v1/employee-profiles/{user.id}")).json()
    assert profile["basic"]["designation"]["code"] == designation["code"]
    assert profile["basic"]["office"]["code"] == office["code"]
    assert profile["basic"]["department"]["code"] == department["code"]
    assert profile["basic"]["businessUnit"]["code"] == unit["code"]
    assert profile["basic"]["team"]["code"] == team["code"]
    assert profile["basic"]["userType"]["code"] == "SE"
    assert profile["basic"]["accountStatus"] == "pending"
    assert profile["hr"]["data"]["nationality"] == "Pakistani"
    assert profile["hr"]["data"]["gender"] == "Male"
    assert profile["hr"]["data"]["maritalStatus"] == "Single"
    documents = {item["kind"]: item for item in profile["pro"]["documents"]}
    assert documents["emirates_id"]["documentNumber"] == "000-0000-0000000-0"
    assert documents["passport"]["documentNumber"] == "P0000123"


@pytest.mark.asyncio
async def test_inactive_mismatched_and_privileged_references_are_rejected(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    tag = unique_tag().upper()
    office_a = (
        await owner.post("/api/v1/offices", json={"name": f"Reference A {tag}", "code": f"RA{tag}"})
    ).json()
    office_b = (
        await owner.post("/api/v1/offices", json={"name": f"Reference B {tag}", "code": f"RB{tag}"})
    ).json()
    department = (
        await owner.post(
            "/api/v1/departments",
            json={
                "office_id": office_a["id"],
                "name": f"Reference Department {tag}",
                "code": f"RD{tag}",
            },
        )
    ).json()
    designation = (
        await owner.post(
            "/api/v1/designations",
            json={"name": f"Inactive Designation {tag}", "code": f"RI{tag}"},
        )
    ).json()
    assert (
        await owner.post(f"/api/v1/designations/{designation['id']}/deactivate")
    ).status_code == 200
    payload = csv_file(
        [
            "full_name",
            "personal_email",
            "mobile",
            "designation_code",
            "office_code",
            "department_code",
            "user_type_code",
        ],
        [
            [
                "Invalid References",
                f"invalid-ref-{tag.lower()}@example.com",
                "+971500000040",
                designation["code"],
                office_b["code"],
                department["code"],
                "OWNER",
            ]
        ],
    )
    validation = await owner.post("/api/v1/users/bulk-upload/validate", files=payload)
    assert validation.status_code == 200
    errors = validation.json()["errors"]
    assert any(
        error["field"] == "designation_code" and "inactive" in error["message"] for error in errors
    )
    assert any(
        error["field"] == "department_code" and "does not belong" in error["message"]
        for error in errors
    )
    assert any(
        error["field"] == "user_type_code" and "OWNER cannot" in error["message"]
        for error in errors
    )


@pytest.mark.asyncio
async def test_batch_failure_rolls_back_every_staged_user(client: AsyncClient, monkeypatch) -> None:
    owner, _ = await owner_client(client)
    from nexa_bos_api.identity import bulk_upload

    tag = unique_tag()
    emails = [f"bulk-rollback-a-{tag}@example.com", f"bulk-rollback-b-{tag}@example.com"]
    payload = csv_file(
        ["full_name", "personal_email", "mobile"],
        [["Rollback A", emails[0], "+971500000030"], ["Rollback B", emails[1], "+971500000031"]],
    )
    original = bulk_upload._stage_staff_row
    calls = 0

    async def fail_second(session, actor, row):
        nonlocal calls
        calls += 1
        user = await original(session, actor, row)
        if calls == 2:
            raise AppError(status_code=409, code="TEST_BATCH_FAILURE", message="Synthetic failure")
        return user

    monkeypatch.setattr(bulk_upload, "_stage_staff_row", fail_second)
    failed = await owner.post("/api/v1/users/bulk-upload/import", files=payload)
    assert failed.status_code == 409
    assert failed.json()["error"]["code"] == "TEST_BATCH_FAILURE"
    assert await find_user(emails[0]) is None
    assert await find_user(emails[1]) is None
