import pytest
from helpers import create_activated_user, owner_client, unique_tag
from test_org_master_deletion import master_fixture


@pytest.mark.asyncio
async def test_business_unit_parents_status_and_team_scope(client):
    owner, _ = await owner_client(client)
    first = await master_fixture(owner, "business-units")
    second = await master_fixture(owner, "business-units")
    path = f"/api/v1/business-units/{first['id']}"
    for name, code in ((" ", unique_tag()), ("Unit", " ")):
        blank = await owner.post(
            "/api/v1/business-units",
            json={
                "name": name,
                "code": code,
                "office_id": first["officeId"],
                "department_id": first["departmentId"],
            },
        )
        assert blank.status_code == 422
    renamed = await owner.patch(
        path,
        json={
            "name": "Renamed unit",
            "office_id": first["officeId"],
            "department_id": first["departmentId"],
        },
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["code"] == first["code"]
    immutable = await owner.patch(
        path,
        json={
            "name": "Rename",
            "code": "REPLACE",
            "office_id": first["officeId"],
            "department_id": first["departmentId"],
        },
    )
    assert immutable.status_code == 422
    bad_parent = await owner.post(
        "/api/v1/business-units",
        json={
            "name": "Invalid parent",
            "code": unique_tag(),
            "office_id": first["officeId"],
            "department_id": second["departmentId"],
        },
    )
    assert bad_parent.status_code == 422
    assert bad_parent.json()["error"]["code"] == "BUSINESS_UNIT_ORG_MISMATCH"
    filtered = await owner.get("/api/v1/business-units", params={"officeId": first["officeId"]})
    assert {item["id"] for item in filtered.json()["items"]} == {first["id"]}
    assert (await owner.post(f"{path}/deactivate")).status_code == 200
    assert (
        await owner.get("/api/v1/business-units", params={"officeId": first["officeId"]})
    ).json()["items"] == []
    body = {
        "name": "Team",
        "code": unique_tag(),
        "office_id": first["officeId"],
        "department_id": first["departmentId"],
    }
    assert (await owner.post("/api/v1/teams", json=body)).status_code == 422
    inactive = await owner.post("/api/v1/teams", json={**body, "business_unit_id": first["id"]})
    assert inactive.status_code == 422
    assert inactive.json()["error"]["code"] == "BUSINESS_UNIT_INACTIVE"
    assert (await owner.post(f"{path}/activate")).status_code == 200
    mismatched = await owner.post("/api/v1/teams", json={**body, "business_unit_id": second["id"]})
    assert mismatched.status_code == 422
    team = await owner.post("/api/v1/teams", json={**body, "business_unit_id": first["id"]})
    assert team.status_code == 200, team.text
    assert team.json()["businessUnitId"] == first["id"]
    assert (await owner.get("/api/v1/teams", params={"businessUnitId": second["id"]})).json()[
        "items"
    ] == []
    assert (await owner.post(f"{path}/deactivate")).status_code == 409
    employee = await create_activated_user(
        owner,
        office_id=first["officeId"],
        department_id=first["departmentId"],
        team_id=team.json()["id"],
    )
    assert employee["businessUnit"]["id"] == first["id"]
    bad_assignment = await owner.patch(
        f"/api/v1/users/{employee['id']}", json={"business_unit_id": second["id"]}
    )
    assert bad_assignment.status_code == 422, bad_assignment.text
    unchanged = await owner.get(f"/api/v1/users/{employee['id']}")
    assert unchanged.json()["businessUnit"]["id"] == first["id"]


@pytest.mark.asyncio
async def test_team_business_unit_correction_is_limited_to_unused_teams(client):
    owner, _ = await owner_client(client)
    team = await master_fixture(owner, "teams")
    unit = await owner.post(
        "/api/v1/business-units",
        json={
            "name": "Correct unit",
            "code": unique_tag(),
            "office_id": team["officeId"],
            "department_id": team["departmentId"],
        },
    )
    assert unit.status_code == 200, unit.text
    updated = await owner.patch(
        f"/api/v1/teams/{team['id']}",
        json={
            "name": team["name"],
            "business_unit_id": unit.json()["id"],
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["businessUnitId"] == unit.json()["id"]
    employee = await create_activated_user(
        owner, office_id=team["officeId"], department_id=team["departmentId"], team_id=team["id"]
    )
    denied = await owner.patch(
        f"/api/v1/teams/{team['id']}",
        json={
            "name": team["name"],
            "business_unit_id": team["businessUnitId"],
        },
    )
    assert denied.status_code == 409, denied.text
    assert denied.json()["error"]["code"] == "TEAM_BUSINESS_UNIT_LOCKED"
    assert (await owner.get(f"/api/v1/users/{employee['id']}")).json()["businessUnit"][
        "id"
    ] == unit.json()["id"]
