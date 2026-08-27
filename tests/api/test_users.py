from __future__ import annotations

import pytest
from httpx import AsyncClient

from helpers import create_activated_user, designation_id, office_id, owner_client, unique_tag


@pytest.mark.asyncio
async def test_user_code_sequence_and_required_fields(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag()
    response = await authed.post(
        "/api/v1/users",
        json={
            "full_name": "Ada Lovelace",
            "employee_code": f"EMP-{tag}",
            "email": f"ada-{tag}@example.com",
            "mobile": "+971500000010",
            "designation_id": await designation_id(authed),
            "employment_status": "Probation",
            "joining_date": "2026-03-01",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["userCode"].startswith("USR-")
    assert body["accountStatus"] == "pending"
    assert body["joiningDate"] == "2026-03-01"


@pytest.mark.asyncio
async def test_duplicate_employee_code_includes_conflict_profile(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    first = await create_activated_user(authed)
    response = await authed.post(
        "/api/v1/users",
        json={
            "full_name": "Copy",
            "employee_code": first["employeeCode"],
            "email": f"copy-{unique_tag()}@example.com",
            "mobile": "+971500000011",
            "designation_id": await designation_id(authed),
            "employment_status": "Active",
            "joining_date": "2026-03-01",
        },
    )
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "EMPLOYEE_CODE_DUPLICATE"
    assert error["details"][0]["userCode"] == first["userCode"]


@pytest.mark.asyncio
async def test_cannot_assign_owner_or_delete_user(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    user = await create_activated_user(authed)
    types = (await authed.get("/api/v1/user-types")).json()["items"]
    owner_type = next(item for item in types if item["code"] == "OWNER")
    assign = await authed.post(
        f"/api/v1/users/{user['id']}/assign-type",
        json={"user_type_id": owner_type["id"]},
    )
    assert assign.status_code == 403
    assert assign.json()["error"]["code"] == "OWNER_ASSIGN_FORBIDDEN"
    deleted = await authed.delete(f"/api/v1/users/{user['id']}")
    assert deleted.status_code == 405


@pytest.mark.asyncio
async def test_self_edit_mobile_only(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    user = await create_activated_user(authed, password="UserPass1!")
    from helpers import authenticate

    await authenticate(client, user["email"], "UserPass1!")
    patched = await client.patch("/api/v1/users/me", json={"mobile": "+971500000012"})
    assert patched.status_code == 200
    assert patched.json()["mobile"] == "+971500000012"


@pytest.mark.asyncio
async def test_employee_code_history(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    user = await create_activated_user(authed)
    old_code = user["employeeCode"]
    new_code = f"EMP-{unique_tag()}"
    updated = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"employee_code": new_code},
    )
    assert updated.status_code == 200
    history = await authed.get(f"/api/v1/users/{user['id']}/history")
    assert history.status_code == 200
    codes = [row["employeeCode"] for row in history.json()["employeeCodes"]]
    assert old_code in codes
    assert updated.json()["employeeCode"] == new_code


@pytest.mark.asyncio
async def test_reporting_manager_must_be_active(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    manager = await create_activated_user(authed, user_type_code="GM")
    await authed.post(f"/api/v1/users/{manager['id']}/deactivate")
    tag = unique_tag()
    response = await authed.post(
        "/api/v1/users",
        json={
            "full_name": "Report",
            "employee_code": f"EMP-{tag}",
            "email": f"report-{tag}@example.com",
            "mobile": "+971500000013",
            "designation_id": await designation_id(authed),
            "employment_status": "Active",
            "joining_date": "2026-03-01",
            "reporting_manager_id": manager["id"],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MANAGER_INACTIVE"


@pytest.mark.asyncio
async def test_reporting_managers_list_only_eligible_active(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    gm = await create_activated_user(authed, user_type_code="GM")
    se = await create_activated_user(authed, user_type_code="SE")
    inactive = await create_activated_user(authed, user_type_code="GM")
    await authed.post(f"/api/v1/users/{inactive['id']}/deactivate")
    listed = await authed.get("/api/v1/users/managers")
    assert listed.status_code == 200, listed.text
    ids = {item["id"] for item in listed.json()["items"]}
    assert owner["id"] in ids
    assert gm["id"] in ids
    assert se["id"] not in ids
    assert inactive["id"] not in ids
    excluded = await authed.get(f"/api/v1/users/managers?excludeUserId={gm['id']}")
    assert gm["id"] not in {item["id"] for item in excluded.json()["items"]}
    self_report = await authed.patch(
        f"/api/v1/users/{gm['id']}",
        json={"reporting_manager_id": gm["id"]},
    )
    assert self_report.status_code == 422
    assert self_report.json()["error"]["code"] == "HIERARCHY_SELF"


@pytest.mark.asyncio
async def test_resigned_requires_last_working_date_and_deactivates(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    user = await create_activated_user(authed)
    missing = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"employment_status": "Resigned"},
    )
    assert missing.status_code == 422
    updated = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"employment_status": "Resigned", "last_working_date": "2026-08-01"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["accountStatus"] == "deactivated"
    reactivated_status = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"employment_status": "Active"},
    )
    assert reactivated_status.json()["accountStatus"] == "deactivated"
    rehire = await authed.post(
        f"/api/v1/users/{user['id']}/rehire",
        json={
            "joining_date": "2026-09-01",
            "employment_status": "Probation",
            "employee_code": f"EMP-{unique_tag()}",
        },
    )
    assert rehire.status_code == 200, rehire.text
    assert rehire.json()["accountStatus"] == "deactivated"
    assert rehire.json()["userCode"] == user["userCode"]


@pytest.mark.asyncio
async def test_edit_user_office_department_team_consistency(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dubai = await office_id(authed, "DXB")
    abu_dhabi = await office_id(authed, "AUH")
    tag = unique_tag().upper()
    dxb_dept = await authed.post(
        "/api/v1/departments",
        json={"office_id": dubai, "name": f"DXB {tag}", "code": f"DX{tag[:6]}"},
    )
    auh_dept = await authed.post(
        "/api/v1/departments",
        json={"office_id": abu_dhabi, "name": f"AUH {tag}", "code": f"AH{tag[:6]}"},
    )
    assert dxb_dept.status_code == 200, dxb_dept.text
    assert auh_dept.status_code == 200, auh_dept.text
    dxb_team = await authed.post(
        "/api/v1/teams",
        json={
            "office_id": dubai,
            "department_id": dxb_dept.json()["id"],
            "name": f"DXB Team {tag}",
            "code": f"DT{tag[:6]}",
        },
    )
    auh_team = await authed.post(
        "/api/v1/teams",
        json={
            "office_id": abu_dhabi,
            "department_id": auh_dept.json()["id"],
            "name": f"AUH Team {tag}",
            "code": f"AT{tag[:6]}",
        },
    )
    assert dxb_team.status_code == 200, dxb_team.text
    assert auh_team.status_code == 200, auh_team.text
    user = await create_activated_user(
        authed,
        office_id=dubai,
        department_id=dxb_dept.json()["id"],
        team_id=dxb_team.json()["id"],
    )
    office_only = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"office_id": abu_dhabi},
    )
    assert office_only.status_code == 422
    assert office_only.json()["error"]["code"] in {
        "DEPARTMENT_OFFICE_MISMATCH",
        "TEAM_ORG_MISMATCH",
    }
    unchanged = await authed.get(f"/api/v1/users/{user['id']}")
    assert unchanged.json()["office"]["id"] == dubai
    assert unchanged.json()["department"]["id"] == dxb_dept.json()["id"]
    assert unchanged.json()["team"]["id"] == dxb_team.json()["id"]
    no_office = await create_activated_user(authed)
    dept_without_office = await authed.patch(
        f"/api/v1/users/{no_office['id']}",
        json={"department_id": dxb_dept.json()["id"]},
    )
    assert dept_without_office.status_code == 422
    assert dept_without_office.json()["error"]["code"] == "OFFICE_REQUIRED"
    team_without_dept = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"office_id": abu_dhabi, "department_id": None, "team_id": auh_team.json()["id"]},
    )
    assert team_without_dept.status_code == 422
    assert team_without_dept.json()["error"]["code"] == "TEAM_REQUIRES_ORG"
    team_mismatch = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={
            "office_id": abu_dhabi,
            "department_id": auh_dept.json()["id"],
            "team_id": dxb_team.json()["id"],
        },
    )
    assert team_mismatch.status_code == 422
    assert team_mismatch.json()["error"]["code"] == "TEAM_ORG_MISMATCH"
    updated = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={
            "office_id": abu_dhabi,
            "department_id": auh_dept.json()["id"],
            "team_id": auh_team.json()["id"],
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["office"]["id"] == abu_dhabi
    assert updated.json()["department"]["id"] == auh_dept.json()["id"]
    assert updated.json()["team"]["id"] == auh_team.json()["id"]


@pytest.mark.asyncio
async def test_edit_user_does_not_silently_clear_department_or_team(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dubai = await office_id(authed, "DXB")
    tag = unique_tag().upper()
    dept = await authed.post(
        "/api/v1/departments",
        json={"office_id": dubai, "name": f"Keep {tag}", "code": f"KP{tag[:6]}"},
    )
    assert dept.status_code == 200, dept.text
    team = await authed.post(
        "/api/v1/teams",
        json={
            "office_id": dubai,
            "department_id": dept.json()["id"],
            "name": f"Keep Team {tag}",
            "code": f"KT{tag[:6]}",
        },
    )
    assert team.status_code == 200, team.text
    user = await create_activated_user(
        authed,
        office_id=dubai,
        department_id=dept.json()["id"],
        team_id=team.json()["id"],
    )
    clear_office_only = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"office_id": None},
    )
    assert clear_office_only.status_code == 422
    assert clear_office_only.json()["error"]["code"] == "OFFICE_REQUIRED"
    after_office = await authed.get(f"/api/v1/users/{user['id']}")
    assert after_office.json()["office"]["id"] == dubai
    assert after_office.json()["department"]["id"] == dept.json()["id"]
    assert after_office.json()["team"]["id"] == team.json()["id"]
    clear_department_only = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"department_id": None},
    )
    assert clear_department_only.status_code == 422
    assert clear_department_only.json()["error"]["code"] == "TEAM_REQUIRES_ORG"
    after_department = await authed.get(f"/api/v1/users/{user['id']}")
    assert after_department.json()["office"]["id"] == dubai
    assert after_department.json()["department"]["id"] == dept.json()["id"]
    assert after_department.json()["team"]["id"] == team.json()["id"]
    history_before = await authed.get(f"/api/v1/users/{user['id']}/history")
    office_rows_before = [
        row for row in history_before.json()["assignments"] if row["field"] == "office"
    ]
    cleared = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"office_id": None, "department_id": None, "team_id": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["office"] is None
    assert cleared.json()["department"] is None
    assert cleared.json()["team"] is None
    history_after = await authed.get(f"/api/v1/users/{user['id']}/history")
    office_rows_after = [
        row for row in history_after.json()["assignments"] if row["field"] == "office"
    ]
    assert len(office_rows_after) == len(office_rows_before) + 1
    assert any(row["valueId"] is None and row["effectiveTo"] is None for row in office_rows_after)
    assert any(
        row["valueId"] == dubai and row["effectiveTo"] is not None for row in office_rows_after
    )


def test_storage_dir_created_on_demand(tmp_path, monkeypatch) -> None:
    from nexa_bos_api.core.config import get_settings
    from nexa_bos_api.identity.users_service import storage_dir

    target = tmp_path / "uploads"
    monkeypatch.setenv("FILE_STORAGE_DIR", str(target))
    get_settings.cache_clear()
    try:
        assert not target.exists()
        path = storage_dir()
        assert path == target
        assert target.is_dir()
    finally:
        get_settings.cache_clear()
