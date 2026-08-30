from __future__ import annotations

from uuid import UUID

import pytest
from helpers import (
    create_activated_user,
    office_id,
    owner_client,
    unique_tag,
)
from httpx import AsyncClient
from nexa_bos_api.identity.models import User
from nexa_bos_api.main import app


async def _department_team(
    client: AsyncClient,
    office: str,
    *,
    prefix: str,
) -> tuple[str, str]:
    tag = unique_tag()[:7].upper()
    department = await client.post(
        "/api/v1/departments",
        json={
            "office_id": office,
            "name": f"{prefix} Department {tag}",
            "code": f"{prefix[:3].upper()}D{tag}",
        },
    )
    assert department.status_code == 200, department.text
    team = await client.post(
        "/api/v1/teams",
        json={
            "office_id": office,
            "department_id": department.json()["id"],
            "name": f"{prefix} Team {tag}",
            "code": f"{prefix[:3].upper()}T{tag}",
        },
    )
    assert team.status_code == 200, team.text
    return department.json()["id"], team.json()["id"]


async def _named_user(
    client: AsyncClient,
    name: str,
    *,
    user_type_code: str,
    office: str | None = None,
    department: str | None = None,
    team: str | None = None,
    manager: str | None = None,
) -> dict:
    user = await create_activated_user(
        client,
        user_type_code=user_type_code,
        office_id=office,
        department_id=department,
        team_id=team,
        manager_id=manager,
    )
    renamed = await client.patch(
        f"/api/v1/users/{user['id']}",
        json={"full_name": name},
    )
    assert renamed.status_code == 200, renamed.text
    return renamed.json()


def _nodes(payload: dict) -> dict[str, dict]:
    return {row["id"]: row for row in payload["nodes"]}


@pytest.mark.asyncio
async def test_company_hierarchy_filters_search_context_and_inactive_users(
    client: AsyncClient,
) -> None:
    owner, owner_user = await owner_client(client)
    dxb = await office_id(owner, "DXB")
    department, team = await _department_team(owner, dxb, prefix="Hierarchy")
    search_tag = unique_tag()[:8]
    manager = await _named_user(
        owner,
        "Hierarchy Manager",
        user_type_code="GM",
        office=dxb,
        department=department,
        team=team,
        manager=owner_user["id"],
    )
    employee = await _named_user(
        owner,
        f"Hierarchy Search Employee {search_tag}",
        user_type_code="SE",
        office=dxb,
        department=department,
        team=team,
        manager=manager["id"],
    )
    orphan = await _named_user(owner, "Hierarchy Orphan", user_type_code="SE")
    resigned = await _named_user(
        owner,
        "Hierarchy Historical Employee",
        user_type_code="SE",
        office=dxb,
        department=department,
        team=team,
        manager=manager["id"],
    )
    resigned_response = await owner.patch(
        f"/api/v1/users/{resigned['id']}",
        json={
            "employment_status": "Resigned",
            "last_working_date": "2026-08-30",
        },
    )
    assert resigned_response.status_code == 200, resigned_response.text

    company = await owner.get("/api/v1/organization/hierarchy")
    assert company.status_code == 200, company.text
    payload = company.json()
    nodes = _nodes(payload)
    assert payload["scope"] == "company"
    assert {owner_user["id"], manager["id"], employee["id"], orphan["id"]} <= set(nodes)
    assert resigned["id"] not in nodes
    assert nodes[manager["id"]]["reportingManagerId"] == owner_user["id"]
    assert nodes[employee["id"]]["reportingManagerId"] == manager["id"]
    assert employee["id"] in nodes[manager["id"]]["directReportIds"]
    assert nodes[orphan["id"]]["reportingManagerId"] is None
    assert orphan["id"] in payload["rootIds"]
    assert dxb in {row["id"] for row in payload["filters"]["offices"]}
    assert department in {row["id"] for row in payload["filters"]["departments"]}
    assert team in {row["id"] for row in payload["filters"]["teams"]}

    for params in (
        {"officeId": dxb},
        {"officeId": dxb, "departmentId": department},
        {"officeId": dxb, "departmentId": department, "teamId": team},
    ):
        filtered = await owner.get("/api/v1/organization/hierarchy", params=params)
        assert filtered.status_code == 200, filtered.text
        filtered_nodes = _nodes(filtered.json())
        assert {owner_user["id"], manager["id"], employee["id"]} <= set(filtered_nodes)
        assert filtered_nodes[owner_user["id"]]["contextOnly"] is True

    selected_ancestor = await owner.get(
        "/api/v1/organization/hierarchy",
        params={"officeId": dxb, "selectedUserId": owner_user["id"]},
    )
    assert selected_ancestor.status_code == 200, selected_ancestor.text
    assert selected_ancestor.json()["upwardChainIds"] == [owner_user["id"]]

    by_code = await owner.get(
        "/api/v1/organization/hierarchy",
        params={"q": employee["employeeCode"]},
    )
    assert [row["id"] for row in by_code.json()["searchResults"]] == [employee["id"]]
    by_name = await owner.get(
        "/api/v1/organization/hierarchy",
        params={
            "q": f"search employee {search_tag}",
            "selectedUserId": employee["id"],
        },
    )
    selected = by_name.json()
    assert [row["id"] for row in selected["searchResults"]] == [employee["id"]]
    assert selected["upwardChainIds"] == [
        employee["id"],
        manager["id"],
        owner_user["id"],
    ]

    historical = await owner.get(
        "/api/v1/organization/hierarchy",
        params={"includeInactive": True},
    )
    assert resigned["id"] in _nodes(historical.json())


@pytest.mark.asyncio
async def test_hierarchy_refetch_reflects_authoritative_user_changes(client: AsyncClient) -> None:
    owner, owner_user = await owner_client(client)
    dxb = await office_id(owner, "DXB")
    auh = await office_id(owner, "AUH")
    dxb_department, dxb_team = await _department_team(owner, dxb, prefix="Before")
    auh_department, auh_team = await _department_team(owner, auh, prefix="After")
    first_manager = await _named_user(
        owner,
        "First Hierarchy Manager",
        user_type_code="GM",
        office=dxb,
        department=dxb_department,
        team=dxb_team,
        manager=owner_user["id"],
    )
    second_manager = await _named_user(
        owner,
        "Second Hierarchy Manager",
        user_type_code="GM",
        office=auh,
        department=auh_department,
        team=auh_team,
        manager=owner_user["id"],
    )
    employee = await _named_user(
        owner,
        "Moving Hierarchy Employee",
        user_type_code="SE",
        office=dxb,
        department=dxb_department,
        team=dxb_team,
        manager=first_manager["id"],
    )
    designation = await owner.post(
        "/api/v1/designations",
        json={"name": "Hierarchy Specialist", "code": f"HS{unique_tag()[:8]}"},
    )
    assert designation.status_code == 200, designation.text

    before = _nodes((await owner.get("/api/v1/organization/hierarchy")).json())
    assert before[employee["id"]]["reportingManagerId"] == first_manager["id"]
    updated = await owner.patch(
        f"/api/v1/users/{employee['id']}",
        json={
            "reporting_manager_id": second_manager["id"],
            "office_id": auh,
            "department_id": auh_department,
            "team_id": auh_team,
            "designation_id": designation.json()["id"],
        },
    )
    assert updated.status_code == 200, updated.text
    user_types = (await owner.get("/api/v1/user-types")).json()["items"]
    gm_type = next(row for row in user_types if row["code"] == "GM")
    assigned = await owner.post(
        f"/api/v1/users/{employee['id']}/assign-type",
        json={"user_type_id": gm_type["id"]},
    )
    assert assigned.status_code == 200, assigned.text

    after = _nodes((await owner.get("/api/v1/organization/hierarchy")).json())
    moved = after[employee["id"]]
    assert moved["reportingManagerId"] == second_manager["id"]
    assert moved["office"]["id"] == auh
    assert moved["department"]["id"] == auh_department
    assert moved["team"]["id"] == auh_team
    assert moved["designation"]["id"] == designation.json()["id"]
    assert moved["userType"]["code"] == "GM"

    resigned = await owner.patch(
        f"/api/v1/users/{employee['id']}",
        json={"employment_status": "Resigned", "last_working_date": "2026-08-30"},
    )
    assert resigned.status_code == 200, resigned.text
    assert employee["id"] not in _nodes((await owner.get("/api/v1/organization/hierarchy")).json())
    included = await owner.get(
        "/api/v1/organization/hierarchy",
        params={"includeInactive": True},
    )
    assert _nodes(included.json())[employee["id"]]["employmentStatus"] == "Resigned"


@pytest.mark.asyncio
async def test_reporting_cycle_and_self_rejection_preserve_state_and_audit(
    client: AsyncClient,
) -> None:
    owner, owner_user = await owner_client(client)
    first = await _named_user(
        owner,
        "Cycle First",
        user_type_code="GM",
        manager=owner_user["id"],
    )
    second = await _named_user(
        owner,
        "Cycle Second",
        user_type_code="GM",
        manager=first["id"],
    )
    third = await _named_user(
        owner,
        "Cycle Third",
        user_type_code="GM",
        manager=second["id"],
    )
    before_detail = (await owner.get(f"/api/v1/users/{first['id']}")).json()
    before_history = (await owner.get(f"/api/v1/users/{first['id']}/history")).json()

    cycle = await owner.patch(
        f"/api/v1/users/{first['id']}",
        json={"reporting_manager_id": third["id"]},
    )
    assert cycle.status_code == 422, cycle.text
    assert cycle.json()["error"]["code"] == "HIERARCHY_CYCLE"
    self_report = await owner.patch(
        f"/api/v1/users/{first['id']}",
        json={"reporting_manager_id": first["id"]},
    )
    assert self_report.status_code == 422, self_report.text
    assert self_report.json()["error"]["code"] == "HIERARCHY_SELF"
    assert (await owner.get(f"/api/v1/users/{first['id']}")).json() == before_detail
    assert (await owner.get(f"/api/v1/users/{first['id']}/history")).json() == before_history

    valid = await owner.patch(
        f"/api/v1/users/{third['id']}",
        json={"reporting_manager_id": owner_user["id"]},
    )
    assert valid.status_code == 200, valid.text
    assert valid.json()["reportingManagerId"] == owner_user["id"]


@pytest.mark.asyncio
async def test_hierarchy_payload_terminates_safely_for_corrupt_existing_cycle(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    first = await create_activated_user(owner, user_type_code="GM")
    second = await create_activated_user(owner, user_type_code="GM")
    third = await create_activated_user(owner, user_type_code="GM")
    async with app.state.session_factory() as session:
        first_row = await session.get(User, UUID(first["id"]))
        second_row = await session.get(User, UUID(second["id"]))
        third_row = await session.get(User, UUID(third["id"]))
        assert first_row and second_row and third_row
        first_row.reporting_manager_id = second_row.id
        second_row.reporting_manager_id = third_row.id
        third_row.reporting_manager_id = first_row.id
        await session.commit()

    response = await owner.get(
        "/api/v1/organization/hierarchy",
        params={"selectedUserId": first["id"]},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    cycle_ids = {first["id"], second["id"], third["id"]}
    assert cycle_ids <= _nodes(payload).keys()
    assert cycle_ids.intersection(payload["rootIds"])
    assert len(payload["upwardChainIds"]) == len(set(payload["upwardChainIds"])) <= 3
