from uuid import UUID

import pytest
from helpers import authenticate, create_activated_user, owner_client, spawned_client, unique_tag
from httpx import AsyncClient
from nexa_bos_api.identity.enums import AssignmentField
from nexa_bos_api.identity.models import (
    AuditEvent,
    Department,
    DepartmentNameHistory,
    OfficeNameHistory,
    OrganizationMasterDeletion,
    UserAssignmentHistory,
)
from sqlalchemy import String, cast, func, or_, select, text
from sqlalchemy.exc import DBAPIError


async def master_fixture(client, kind):
    tag = unique_tag().upper()

    async def create(path, **data):
        response = await client.post(
            f"/api/v1/{path}",
            json={"name": f"Unused {path}", "code": f"M{unique_tag().upper()}", **data},
        )
        assert response.status_code == 200, response.text
        return response.json()

    if kind == "designations":
        return await create(kind)
    office = await create("offices")
    if kind == "offices":
        return office
    department = await create("departments", office_id=office["id"])
    if kind == "departments":
        return department
    unit = await create("business-units", office_id=office["id"], department_id=department["id"])
    if kind == "business-units":
        return unit
    return await create(
        "teams",
        office_id=office["id"],
        department_id=department["id"],
        business_unit_id=unit["id"],
        code=f"T{tag}",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind", ["offices", "departments", "business-units", "teams", "designations"]
)
async def test_delete_each_master_retains_snapshot_and_audit(client, kind):
    authed, owner = await owner_client(client)
    item = await master_fixture(authed, kind)
    rename = {"name": "Renamed unused master"}
    if kind == "teams":
        rename["business_unit_id"] = item["businessUnitId"]
    elif kind == "business-units":
        rename.update(office_id=item["officeId"], department_id=item["departmentId"])
    renamed = await authed.patch(f"/api/v1/{kind}/{item['id']}", json=rename)
    assert renamed.status_code == 200, renamed.text
    deleted = await authed.request(
        "DELETE",
        f"/api/v1/{kind}/{item['id']}",
        json={"confirmation": "DELETE", "reason": "Unused synthetic master"},
    )
    assert deleted.status_code == 200, deleted.text
    from nexa_bos_api.identity.models import AuditEvent
    from nexa_bos_api.main import app

    async with app.state.session_factory() as session:
        snapshot = await session.scalar(
            select(OrganizationMasterDeletion).where(
                OrganizationMasterDeletion.record_id == UUID(item["id"])
            )
        )
        assert snapshot.actor_id == UUID(owner["id"])
        assert snapshot.snapshot["id"] == item["id"]
        assert snapshot.code == item["code"]
        assert snapshot.name == rename["name"]
        assert snapshot.snapshot["created_at"] and snapshot.snapshot["updated_at"]
        assert {row["name"] for row in snapshot.name_history} == {item["name"], rename["name"]}
        assert len(snapshot.name_history) == 2
        audit = await session.scalar(
            select(AuditEvent).where(
                AuditEvent.entity_id == item["id"], AuditEvent.action.endswith(".delete")
            )
        )
        assert audit.note == snapshot.reason
        assert audit.new_values["deletionEvidenceId"] == str(snapshot.id)
        actions = list(
            await session.scalars(
                select(AuditEvent.action).where(AuditEvent.entity_id == item["id"])
            )
        )
        entity = "business_unit" if kind == "business-units" else kind[:-1]
        assert sorted(actions) == sorted(
            f"{entity}.{action}" for action in ("create", "rename", "delete")
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["GM", "HR", "PRO", "SE"])
async def test_delete_identity_is_owner_only_even_for_management_roles(client, role):
    owner, _ = await owner_client(client)
    item = await master_fixture(owner, "designations")
    actor = await create_activated_user(owner, user_type_code=role)
    async with await spawned_client() as other:
        await authenticate(other, actor["email"], "UserPass1!")
        for path in (f"/api/v1/designations/{item['id']}/deletion-preview",):
            assert (await other.get(path)).status_code == 403
        denied = await other.request(
            "DELETE",
            f"/api/v1/designations/{item['id']}",
            json={"confirmation": "DELETE", "reason": "Not OWNER"},
        )
        assert denied.status_code == 403, denied.text
        assert denied.json()["error"]["code"] == "OWNER_REQUIRED"
    assert (
        await owner.get(f"/api/v1/designations/{item['id']}/deletion-preview")
    ).status_code == 200


@pytest.mark.asyncio
async def test_usage_in_json_history_blocks_and_audit_failure_rolls_back(client, monkeypatch):
    owner, owner_user = await owner_client(client)
    item = await master_fixture(owner, "offices")
    from nexa_bos_api.identity import org_deletion
    from nexa_bos_api.identity.audit import record_audit
    from nexa_bos_api.main import app

    async with app.state.session_factory() as session:
        await record_audit(
            session,
            action="user.assignment",
            entity_type="user",
            entity_id=owner_user["id"],
            actor_id=UUID(owner_user["id"]),
            new_values={"nested": {"officeId": item["id"]}},
        )
        await session.commit()
    refused = await owner.request(
        "DELETE",
        f"/api/v1/offices/{item['id']}",
        json={"confirmation": "DELETE", "reason": "Historical usage must block"},
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["error"]["code"] == "MASTER_IN_USE"
    unused = await master_fixture(owner, "offices")

    async def fail_audit(*args, **kwargs):
        raise RuntimeError("Injected audit write failure")

    monkeypatch.setattr(org_deletion, "record_audit", fail_audit)
    with pytest.raises(RuntimeError, match="Injected audit write failure"):
        await owner.request(
            "DELETE",
            f"/api/v1/offices/{unused['id']}",
            json={"confirmation": "DELETE", "reason": "Rollback test"},
        )
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(OrganizationMasterDeletion).where(
                    OrganizationMasterDeletion.record_id == UUID(unused["id"])
                )
            )
            is None
        )
        history = await session.scalar(
            select(OfficeNameHistory).where(
                OfficeNameHistory.original_record_id == UUID(unused["id"])
            )
        )
        assert history.office_id == UUID(unused["id"])
    assert (await owner.get(f"/api/v1/offices/{unused['id']}/deletion-preview")).status_code == 200


@pytest.mark.asyncio
async def test_unused_office_deletion_preserves_all_name_history(client: AsyncClient):
    authed, _ = await owner_client(client)
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/offices", json={"name": "Unused office", "code": f"DEL{tag}"}
    )
    assert created.status_code == 200, created.text
    row = created.json()
    changed = await authed.patch(
        f"/api/v1/offices/{row['id']}", json={"name": "Renamed unused office"}
    )
    assert changed.status_code == 200, changed.text
    path = f"/api/v1/offices/{row['id']}"
    preview = await authed.get(f"{path}/deletion-preview")
    assert preview.status_code == 200, preview.text
    assert preview.json()["dependencies"] == []
    for confirmation, reason in (("delete", "Unused"), ("DELETE ", "Unused"), ("DELETE", " ")):
        rejected = await authed.request(
            "DELETE", path, json={"confirmation": confirmation, "reason": reason}
        )
        assert rejected.status_code == 422, rejected.text
        assert (await authed.get(f"{path}/deletion-preview")).status_code == 200
    deleted = await authed.request(
        "DELETE", path, json={"confirmation": "DELETE", "reason": "Unused duplicate setup"}
    )
    assert deleted.status_code == 200, deleted.text
    assert (await authed.get(f"{path}/deletion-preview")).status_code == 404
    from nexa_bos_api.main import app

    async with app.state.session_factory() as session:
        histories = list(
            await session.scalars(
                select(OfficeNameHistory).where(
                    OfficeNameHistory.original_record_id == UUID(row["id"])
                )
            )
        )
        assert {item.name for item in histories} == {"Unused office", "Renamed unused office"}
        assert all(item.office_id is None for item in histories)
        evidence = await session.scalar(
            select(OrganizationMasterDeletion).where(
                OrganizationMasterDeletion.record_id == UUID(row["id"])
            )
        )
        assert evidence.code == row["code"]
        assert evidence.reason == "Unused duplicate setup"
        assert len(evidence.name_history) == 2
        with pytest.raises(DBAPIError):
            await session.execute(
                text("DELETE FROM organization_master_deletions WHERE record_id=:id"),
                {"id": UUID(row["id"])},
            )
        await session.rollback()
        with pytest.raises(DBAPIError):
            await session.execute(
                text("DELETE FROM office_name_history WHERE original_record_id=:id"),
                {"id": UUID(row["id"])},
            )
        await session.rollback()


@pytest.mark.asyncio
async def test_child_dependency_blocks_deletion(client: AsyncClient):
    authed, _ = await owner_client(client)
    tag = unique_tag().upper()
    office = (
        await authed.post("/api/v1/offices", json={"name": "Parent office", "code": f"PAR{tag}"})
    ).json()
    dept = await authed.post(
        "/api/v1/departments", json={"name": "Child", "code": f"CH{tag}", "office_id": office["id"]}
    )
    assert dept.status_code == 200, dept.text
    denied = await authed.request(
        "DELETE",
        f"/api/v1/offices/{office['id']}",
        json={"confirmation": "DELETE", "reason": "Must refuse"},
    )
    assert denied.status_code == 409, denied.text
    assert denied.json()["error"]["code"] == "MASTER_IN_USE"
    assert any(item["type"] == "departments" for item in denied.json()["error"]["details"])


@pytest.mark.asyncio
async def test_concurrent_usage_writer_refuses_delete_without_partial_changes(client):
    from nexa_bos_api.main import app

    owner, _ = await owner_client(client)
    item = await master_fixture(owner, "offices")
    async with app.state.session_factory() as writer:
        # Real PostgreSQL writer lock, not a mocked race or timing-dependent sleep.
        await writer.execute(text("LOCK TABLE audit_events IN ROW EXCLUSIVE MODE"))
        response = await owner.request(
            "DELETE",
            f"/api/v1/offices/{item['id']}",
            json={"confirmation": "DELETE", "reason": "Must fail closed during a writer"},
        )
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "MASTER_DELETE_CONFLICT"
        await writer.rollback()
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(OrganizationMasterDeletion).where(
                    OrganizationMasterDeletion.record_id == UUID(item["id"])
                )
            )
            is None
        )
        history = await session.scalar(
            select(OfficeNameHistory).where(
                OfficeNameHistory.original_record_id == UUID(item["id"])
            )
        )
        assert history.office_id == UUID(item["id"])
    assert (await owner.get(f"/api/v1/offices/{item['id']}/deletion-preview")).status_code == 200


@pytest.mark.asyncio
async def test_employee_assignment_and_past_assignment_both_block_team_deletion(client):
    owner, _ = await owner_client(client)
    team = await master_fixture(owner, "teams")
    employee = await create_activated_user(
        owner, office_id=team["officeId"], department_id=team["departmentId"], team_id=team["id"]
    )
    path = f"/api/v1/teams/{team['id']}"
    data = {"confirmation": "DELETE", "reason": "Must preserve actual employee history"}
    current = await owner.request("DELETE", path, json=data)
    assert current.status_code == 409, current.text
    assert any(item["type"] == "users" for item in current.json()["error"]["details"])
    cleared = await owner.patch(
        f"/api/v1/users/{employee['id']}",
        json={
            "office_id": None,
            "department_id": None,
            "business_unit_id": None,
            "team_id": None,
        },
    )
    assert cleared.status_code == 200, cleared.text
    historical = await owner.request("DELETE", path, json=data)
    assert historical.status_code == 409, historical.text
    assert historical.json()["error"]["code"] == "MASTER_IN_USE"
    assert any(
        item["type"] == "user_assignment_history" for item in historical.json()["error"]["details"]
    )
    assert (await owner.get(f"{path}/deletion-preview")).status_code == 200


@pytest.mark.asyncio
async def test_department_delete_is_owner_only_and_current_dependencies_still_block(client):
    owner, _ = await owner_client(client)
    department = await master_fixture(owner, "departments")
    employee = await create_activated_user(
        owner,
        office_id=department["officeId"],
        department_id=department["id"],
    )
    unit = await owner.post(
        "/api/v1/business-units",
        json={
            "name": "Current department unit",
            "code": f"DU{unique_tag().upper()}",
            "office_id": department["officeId"],
            "department_id": department["id"],
        },
    )
    assert unit.status_code == 200, unit.text
    team = await owner.post(
        "/api/v1/teams",
        json={
            "name": "Current department team",
            "code": f"DT{unique_tag().upper()}",
            "office_id": department["officeId"],
            "department_id": department["id"],
            "business_unit_id": unit.json()["id"],
        },
    )
    assert team.status_code == 200, team.text
    path = f"/api/v1/departments/{department['id']}"

    non_owner = await create_activated_user(owner, user_type_code="GM")
    async with await spawned_client() as restricted:
        await authenticate(restricted, non_owner["email"], "UserPass1!")
        assert (await restricted.get(f"{path}/deletion-preview")).status_code == 403
        denied = await restricted.request(
            "DELETE",
            path,
            json={"confirmation": "DELETE", "reason": "Not allowed"},
        )
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "OWNER_REQUIRED"

    preview = await owner.get(f"{path}/deletion-preview")
    assert preview.status_code == 200, preview.text
    dependencies = {item["type"] for item in preview.json()["dependencies"]}
    assert {"users", "business_units", "teams"} <= dependencies
    blocked = await owner.request(
        "DELETE",
        path,
        json={"confirmation": "DELETE", "reason": "Current dependencies must block"},
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "MASTER_IN_USE"
    assert (await owner.get(f"/api/v1/users/{employee['id']}")).status_code == 200


@pytest.mark.asyncio
async def test_department_history_only_deletion_preserves_readable_evidence(client):
    owner, _ = await owner_client(client)
    department = await master_fixture(owner, "departments")
    renamed = await owner.patch(
        f"/api/v1/departments/{department['id']}",
        json={"name": "Historical department name"},
    )
    assert renamed.status_code == 200, renamed.text
    employee = await create_activated_user(
        owner,
        office_id=department["officeId"],
        department_id=department["id"],
    )
    cleared = await owner.patch(
        f"/api/v1/users/{employee['id']}",
        json={
            "office_id": None,
            "department_id": None,
            "business_unit_id": None,
            "team_id": None,
        },
    )
    assert cleared.status_code == 200, cleared.text
    path = f"/api/v1/departments/{department['id']}"
    preview = await owner.get(f"{path}/deletion-preview")
    assert preview.status_code == 200, preview.text
    assert preview.json()["dependencies"] == []

    deleted = await owner.request(
        "DELETE",
        path,
        json={"confirmation": "DELETE", "reason": "No current department usage"},
    )
    assert deleted.status_code == 200, deleted.text
    assert (await owner.get(f"{path}/deletion-preview")).status_code == 404

    from nexa_bos_api.main import app

    async with app.state.session_factory() as session:
        assert await session.get(Department, UUID(department["id"])) is None
        histories = list(
            await session.scalars(
                select(DepartmentNameHistory).where(
                    DepartmentNameHistory.original_record_id == UUID(department["id"])
                )
            )
        )
        assert {row.name for row in histories} == {
            department["name"],
            "Historical department name",
        }
        assert all(row.department_id is None for row in histories)
        assignment = await session.scalar(
            select(UserAssignmentHistory).where(
                UserAssignmentHistory.user_id == UUID(employee["id"]),
                UserAssignmentHistory.field == AssignmentField.DEPARTMENT,
                UserAssignmentHistory.value_id == department["id"],
            )
        )
        assert assignment is not None
        assert assignment.value_label == "Historical department name"
        assert assignment.effective_to is not None
        evidence = await session.scalar(
            select(OrganizationMasterDeletion).where(
                OrganizationMasterDeletion.record_id == UUID(department["id"])
            )
        )
        assert evidence is not None
        assert evidence.snapshot["id"] == department["id"]
        assert evidence.code == department["code"]
        assert len(evidence.name_history) == 2
        audit_count = await session.scalar(
            select(func.count())
            .select_from(AuditEvent)
            .where(
                or_(
                    AuditEvent.entity_id == department["id"],
                    cast(AuditEvent.old_values, String).contains(department["id"]),
                    cast(AuditEvent.new_values, String).contains(department["id"]),
                )
            )
        )
        assert audit_count and audit_count >= 3

    readable = await owner.get(f"/api/v1/users/{employee['id']}/history")
    assert readable.status_code == 200, readable.text
    assert any(
        row["field"] == AssignmentField.DEPARTMENT
        and row["valueId"] == department["id"]
        and row["valueLabel"] == "Historical department name"
        for row in readable.json()["assignments"]
    )


@pytest.mark.asyncio
async def test_department_history_detach_and_archive_roll_back_together(client, monkeypatch):
    owner, _ = await owner_client(client)
    department = await master_fixture(owner, "departments")
    from nexa_bos_api.identity import org_deletion
    from nexa_bos_api.main import app

    async def fail_audit(*args, **kwargs):
        raise RuntimeError("Injected department audit failure")

    monkeypatch.setattr(org_deletion, "record_audit", fail_audit)
    with pytest.raises(RuntimeError, match="Injected department audit failure"):
        await owner.request(
            "DELETE",
            f"/api/v1/departments/{department['id']}",
            json={"confirmation": "DELETE", "reason": "Rollback department deletion"},
        )

    async with app.state.session_factory() as session:
        assert await session.get(Department, UUID(department["id"])) is not None
        history = await session.scalar(
            select(DepartmentNameHistory).where(
                DepartmentNameHistory.original_record_id == UUID(department["id"])
            )
        )
        assert history is not None
        assert history.department_id == UUID(department["id"])
        assert (
            await session.scalar(
                select(OrganizationMasterDeletion).where(
                    OrganizationMasterDeletion.record_id == UUID(department["id"])
                )
            )
            is None
        )


@pytest.mark.asyncio
async def test_concurrent_master_reader_cannot_race_a_snapshot_only_reference(client):
    from nexa_bos_api.identity.models import Office
    from nexa_bos_api.main import app

    owner, _ = await owner_client(client)
    item = await master_fixture(owner, "offices")
    path = f"/api/v1/offices/{item['id']}"
    payload = {"confirmation": "DELETE", "reason": "Unused after concurrent reader finishes"}
    async with app.state.session_factory() as reader:
        # A reference-producing request validates a master before writing its JSON
        # snapshot. Its PostgreSQL read lock must make concurrent deletion refuse.
        assert await reader.scalar(select(Office).where(Office.id == UUID(item["id"])))
        denied = await owner.request("DELETE", path, json=payload)
        assert denied.status_code == 409, denied.text
        assert denied.json()["error"]["code"] == "MASTER_DELETE_CONFLICT"
        await reader.rollback()
    assert (await owner.get(f"{path}/deletion-preview")).status_code == 200
    deleted = await owner.request("DELETE", path, json=payload)
    assert deleted.status_code == 200, deleted.text
