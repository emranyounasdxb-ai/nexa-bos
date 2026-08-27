from __future__ import annotations

import pytest
from httpx import AsyncClient

from helpers import create_activated_user, designation_id, office_id, owner_client, unique_tag


@pytest.mark.asyncio
async def test_seeded_offices_and_department_requires_office(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    offices = (await authed.get("/api/v1/offices")).json()["items"]
    codes = {item["code"] for item in offices}
    assert {"DXB", "AUH"} <= codes
    dubai = await office_id(authed, "DXB")
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/departments",
        json={"office_id": dubai, "name": f"Sales {tag}", "code": f"SAL{tag[:6]}"},
    )
    assert created.status_code == 200, created.text
    user = await authed.post(
        "/api/v1/users",
        json={
            "full_name": "No office",
            "employee_code": f"EMP-{tag}",
            "email": f"nooff-{tag}@example.com",
            "mobile": "+971500000020",
            "designation_id": await designation_id(authed),
            "employment_status": "Active",
            "joining_date": "2026-04-01",
            "department_id": created.json()["id"],
        },
    )
    assert user.status_code == 422
    assert user.json()["error"]["code"] == "OFFICE_REQUIRED"


@pytest.mark.asyncio
async def test_team_and_tl_rules(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dubai = await office_id(authed, "DXB")
    tag = unique_tag().upper()
    dept = await authed.post(
        "/api/v1/departments",
        json={"office_id": dubai, "name": f"Ops {tag}", "code": f"OPS{tag[:6]}"},
    )
    assert dept.status_code == 200, dept.text
    team = await authed.post(
        "/api/v1/teams",
        json={
            "office_id": dubai,
            "department_id": dept.json()["id"],
            "name": f"Team {tag}",
            "code": f"TM{tag[:6]}",
        },
    )
    assert team.status_code == 200, team.text
    assert team.json()["teamLeaderId"] is None
    se = await create_activated_user(
        authed,
        user_type_code="SE",
        office_id=dubai,
        department_id=dept.json()["id"],
        team_id=team.json()["id"],
    )
    bad_tl = await authed.put(
        f"/api/v1/teams/{team.json()['id']}/leader",
        json={"user_id": se["id"]},
    )
    assert bad_tl.status_code == 422
    tl = await create_activated_user(
        authed,
        user_type_code="TL",
        office_id=dubai,
        department_id=dept.json()["id"],
        team_id=team.json()["id"],
    )
    assigned = await authed.put(
        f"/api/v1/teams/{team.json()['id']}/leader",
        json={"user_id": tl["id"]},
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["teamLeaderId"] == tl["id"]
    await authed.post(f"/api/v1/users/{tl['id']}/deactivate")
    refreshed = await authed.get("/api/v1/teams")
    current = next(item for item in refreshed.json()["items"] if item["id"] == team.json()["id"])
    assert current["teamLeaderId"] is None


@pytest.mark.asyncio
async def test_tl_eligibility_and_type_change_clears_assignment(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dubai = await office_id(authed, "DXB")
    abu_dhabi = await office_id(authed, "AUH")
    tag = unique_tag().upper()
    dept = await authed.post(
        "/api/v1/departments",
        json={"office_id": dubai, "name": f"Elig {tag}", "code": f"EL{tag[:6]}"},
    )
    other_dept = await authed.post(
        "/api/v1/departments",
        json={"office_id": dubai, "name": f"Other {tag}", "code": f"OT{tag[:6]}"},
    )
    auh_dept = await authed.post(
        "/api/v1/departments",
        json={"office_id": abu_dhabi, "name": f"Auh {tag}", "code": f"AU{tag[:6]}"},
    )
    team = await authed.post(
        "/api/v1/teams",
        json={
            "office_id": dubai,
            "department_id": dept.json()["id"],
            "name": f"Team A {tag}",
            "code": f"TA{tag[:6]}",
        },
    )
    other_team = await authed.post(
        "/api/v1/teams",
        json={
            "office_id": dubai,
            "department_id": dept.json()["id"],
            "name": f"Team B {tag}",
            "code": f"TB{tag[:6]}",
        },
    )
    auh_team = await authed.post(
        "/api/v1/teams",
        json={
            "office_id": abu_dhabi,
            "department_id": auh_dept.json()["id"],
            "name": f"Team C {tag}",
            "code": f"TC{tag[:6]}",
        },
    )
    assert team.status_code == 200, team.text
    team_id = team.json()["id"]
    wrong_dept = await create_activated_user(
        authed,
        user_type_code="TL",
        office_id=dubai,
        department_id=other_dept.json()["id"],
    )
    wrong_team = await create_activated_user(
        authed,
        user_type_code="TL",
        office_id=dubai,
        department_id=dept.json()["id"],
        team_id=other_team.json()["id"],
    )
    wrong_office = await create_activated_user(
        authed,
        user_type_code="TL",
        office_id=abu_dhabi,
        department_id=auh_dept.json()["id"],
        team_id=auh_team.json()["id"],
    )
    inactive = await create_activated_user(
        authed,
        user_type_code="TL",
        office_id=dubai,
        department_id=dept.json()["id"],
        team_id=team_id,
    )
    await authed.post(f"/api/v1/users/{inactive['id']}/deactivate")
    for candidate, code in (
        (wrong_dept, "TL_ORG_MISMATCH"),
        (wrong_team, "TL_ORG_MISMATCH"),
        (wrong_office, "TL_ORG_MISMATCH"),
        (inactive, "TL_INACTIVE"),
    ):
        response = await authed.put(
            f"/api/v1/teams/{team_id}/leader",
            json={"user_id": candidate["id"]},
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == code
    tl_one = await create_activated_user(
        authed,
        user_type_code="TL",
        office_id=dubai,
        department_id=dept.json()["id"],
        team_id=team_id,
    )
    tl_two = await create_activated_user(
        authed,
        user_type_code="TL",
        office_id=dubai,
        department_id=dept.json()["id"],
        team_id=team_id,
    )
    eligible = await authed.get(f"/api/v1/teams/{team_id}/eligible-leaders")
    assert eligible.status_code == 200, eligible.text
    eligible_ids = {item["id"] for item in eligible.json()["items"]}
    assert eligible_ids == {tl_one["id"], tl_two["id"]}
    first = await authed.put(f"/api/v1/teams/{team_id}/leader", json={"user_id": tl_one["id"]})
    assert first.json()["teamLeaderId"] == tl_one["id"]
    second = await authed.put(f"/api/v1/teams/{team_id}/leader", json={"user_id": tl_two["id"]})
    assert second.json()["teamLeaderId"] == tl_two["id"]
    types = (await authed.get("/api/v1/user-types")).json()["items"]
    se = next(item for item in types if item["code"] == "SE")
    changed = await authed.post(
        f"/api/v1/users/{tl_two['id']}/assign-type",
        json={"user_type_id": se["id"]},
    )
    assert changed.status_code == 200, changed.text
    teams = await authed.get("/api/v1/teams")
    current = next(item for item in teams.json()["items"] if item["id"] == team_id)
    assert current["teamLeaderId"] is None
    remaining = await authed.get(f"/api/v1/teams/{team_id}/eligible-leaders")
    assert {item["id"] for item in remaining.json()["items"]} == {tl_one["id"]}


@pytest.mark.asyncio
async def test_org_deactivation_blocked_by_active_dependencies(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag().upper()
    office = await authed.post(
        "/api/v1/offices",
        json={"name": f"Office {tag}", "code": f"O{tag[:6]}"},
    )
    assert office.status_code == 200, office.text
    office_id_value = office.json()["id"]
    empty_ok = await authed.post(f"/api/v1/offices/{office_id_value}/deactivate")
    assert empty_ok.status_code == 200, empty_ok.text
    await authed.post(f"/api/v1/offices/{office_id_value}/activate")
    dept = await authed.post(
        "/api/v1/departments",
        json={"office_id": office_id_value, "name": f"Dept {tag}", "code": f"D{tag[:6]}"},
    )
    assert dept.status_code == 200, dept.text
    blocked_office_dept = await authed.post(f"/api/v1/offices/{office_id_value}/deactivate")
    assert blocked_office_dept.status_code == 422
    assert blocked_office_dept.json()["error"]["code"] == "MASTER_IN_USE"
    empty_dept_ok = await authed.post(f"/api/v1/departments/{dept.json()['id']}/deactivate")
    assert empty_dept_ok.status_code == 200, empty_dept_ok.text
    await authed.post(f"/api/v1/departments/{dept.json()['id']}/activate")
    team = await authed.post(
        "/api/v1/teams",
        json={
            "office_id": office_id_value,
            "department_id": dept.json()["id"],
            "name": f"Team {tag}",
            "code": f"T{tag[:6]}",
        },
    )
    assert team.status_code == 200, team.text
    blocked_office_team = await authed.post(f"/api/v1/offices/{office_id_value}/deactivate")
    assert blocked_office_team.status_code == 422
    blocked_dept_team = await authed.post(f"/api/v1/departments/{dept.json()['id']}/deactivate")
    assert blocked_dept_team.status_code == 422
    assert blocked_dept_team.json()["error"]["code"] == "MASTER_IN_USE"
    empty_team_ok = await authed.post(f"/api/v1/teams/{team.json()['id']}/deactivate")
    assert empty_team_ok.status_code == 200, empty_team_ok.text
    await authed.post(f"/api/v1/teams/{team.json()['id']}/activate")
    user = await create_activated_user(
        authed,
        user_type_code="SE",
        office_id=office_id_value,
        department_id=dept.json()["id"],
        team_id=team.json()["id"],
    )
    blocked_team_user = await authed.post(f"/api/v1/teams/{team.json()['id']}/deactivate")
    assert blocked_team_user.status_code == 422
    assert blocked_team_user.json()["error"]["code"] == "MASTER_IN_USE"
    blocked_dept_user = await authed.post(f"/api/v1/departments/{dept.json()['id']}/deactivate")
    assert blocked_dept_user.status_code == 422
    blocked_office_user = await authed.post(f"/api/v1/offices/{office_id_value}/deactivate")
    assert blocked_office_user.status_code == 422
    tl = await create_activated_user(
        authed,
        user_type_code="TL",
        office_id=office_id_value,
        department_id=dept.json()["id"],
        team_id=team.json()["id"],
    )
    assigned = await authed.put(
        f"/api/v1/teams/{team.json()['id']}/leader",
        json={"user_id": tl["id"]},
    )
    assert assigned.status_code == 200, assigned.text
    blocked_team_tl = await authed.post(f"/api/v1/teams/{team.json()['id']}/deactivate")
    assert blocked_team_tl.status_code == 422
    designation = await authed.post(
        "/api/v1/designations",
        json={"name": f"Role {tag}", "code": f"R{tag[:6]}"},
    )
    assert designation.status_code == 200, designation.text
    empty_desig_ok = await authed.post(
        f"/api/v1/designations/{designation.json()['id']}/deactivate"
    )
    assert empty_desig_ok.status_code == 200, empty_desig_ok.text
    await authed.post(f"/api/v1/designations/{designation.json()['id']}/activate")
    patched = await authed.patch(
        f"/api/v1/users/{user['id']}",
        json={"designation_id": designation.json()["id"]},
    )
    assert patched.status_code == 200, patched.text
    blocked_desig = await authed.post(
        f"/api/v1/designations/{designation.json()['id']}/deactivate"
    )
    assert blocked_desig.status_code == 422
    assert blocked_desig.json()["error"]["code"] == "MASTER_IN_USE"


@pytest.mark.asyncio
async def test_office_deactivate_blocked_while_users_exist(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dubai = await office_id(authed, "DXB")
    await create_activated_user(authed, user_type_code="GM", office_id=dubai)
    blocked = await authed.post(f"/api/v1/offices/{dubai}/deactivate")
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "MASTER_IN_USE"
    deleted = await authed.delete(f"/api/v1/offices/{dubai}")
    assert deleted.status_code == 405


@pytest.mark.asyncio
async def test_ineligible_reporting_manager_rejected(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    se = await create_activated_user(authed, user_type_code="SE")
    tag = unique_tag()
    response = await authed.post(
        "/api/v1/users",
        json={
            "full_name": "Report",
            "employee_code": f"EMP-{tag}",
            "email": f"mgr-{tag}@example.com",
            "mobile": "+971500000021",
            "designation_id": await designation_id(authed),
            "employment_status": "Active",
            "joining_date": "2026-04-01",
            "reporting_manager_id": se["id"],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MANAGER_TYPE_INELIGIBLE"


@pytest.mark.asyncio
async def test_authenticated_users_can_view_active_masters(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    user = await create_activated_user(authed, password="UserPass1!")
    from helpers import authenticate, spawned_client

    async with await spawned_client() as other:
        await authenticate(other, user["email"], "UserPass1!")
        offices = await other.get("/api/v1/offices")
        assert offices.status_code == 200
        assert offices.json()["items"]
        create = await other.post(
            "/api/v1/offices",
            json={"name": "Sharjah", "code": "SHJ"},
        )
        assert create.status_code == 403
