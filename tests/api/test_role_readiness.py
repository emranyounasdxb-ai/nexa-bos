from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from helpers import (
    authenticate,
    create_activated_user,
    create_product_variant,
    office_id,
    owner_client,
    spawned_client,
    unique_tag,
)
from httpx import AsyncClient
from nexa_bos_api.applications.models import Application, ApplicationOwnerHistory
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.db.session import create_engine, create_session_factory
from nexa_bos_api.identity import schemas as identity_schemas
from pydantic import ValidationError
from sqlalchemy import select
from test_applications import _catalog, _enable_case_owner, _ensure_test_workflow


def test_review_test_email_domain_remains_disabled_in_production(monkeypatch) -> None:
    monkeypatch.setattr(
        identity_schemas,
        "get_settings",
        lambda: SimpleNamespace(is_production=True),
    )
    with pytest.raises(ValidationError):
        identity_schemas.LoginRequest(email="reviewer@review.test", password="not-a-secret")


async def _configure_system_type(
    client: AsyncClient,
    code: str,
    *,
    permissions: list[str],
    directory_scope: str | None = None,
    customer_scope: str | None = None,
    application_scope: str | None = None,
    reporting_scope: str | None = None,
    can_be_case_owner: bool | None = None,
) -> dict:
    rows = (await client.get("/api/v1/user-types")).json()["items"]
    user_type = next(item for item in rows if item["code"] == code)
    changed = await client.put(
        f"/api/v1/user-types/{user_type['id']}/permissions",
        json={"permissions": permissions},
    )
    assert changed.status_code == 200, changed.text
    scopes = (
        ("scope", "visibility_scope", directory_scope),
        ("customer-scope", "customer_visibility_scope", customer_scope),
        ("application-scope", "application_visibility_scope", application_scope),
        ("reporting-scope", "reporting_visibility_scope", reporting_scope),
    )
    for path, field, value in scopes:
        changed = await client.put(
            f"/api/v1/user-types/{user_type['id']}/{path}",
            json={field: value},
        )
        assert changed.status_code == 200, changed.text
    if can_be_case_owner is not None:
        changed = await client.put(
            f"/api/v1/user-types/{user_type['id']}/case-owner",
            json={"can_be_case_owner": can_be_case_owner},
        )
        assert changed.status_code == 200, changed.text
    rows = (await client.get("/api/v1/user-types")).json()["items"]
    return next(item for item in rows if item["code"] == code)


async def _variant(client: AsyncClient) -> tuple[dict, dict, dict]:
    dib, _eib, pf, _cc = await _catalog(client)
    await _ensure_test_workflow(client, dib["id"], pf["id"])
    variant = await create_product_variant(
        client,
        bank_id=dib["id"],
        product_id=pf["id"],
    )
    return dib, pf, variant


@pytest.mark.asyncio
async def test_atomic_application_create_forces_creator_ownership_and_rolls_back(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    await _enable_case_owner(authed)
    bank, product, variant = await _variant(authed)
    tag = unique_tag()
    mobile = f"+97155{tag[:8]}"
    created = await authed.post(
        "/api/v1/applications",
        json={
            "customer": {
                "customer_type": "individual",
                "full_name": f"Atomic Review {tag}",
                "mobile": mobile,
            },
            "bank_id": bank["id"],
            "product_id": product["id"],
            "product_variant_id": variant["id"],
            "requested_amount": "10000",
        },
    )
    assert created.status_code == 200, created.text
    application = created.json()
    assert application["caseOwnerId"] == owner["id"]
    assert application["customerId"]
    assert application["applicationCode"].startswith("PF-DIB-")

    engine = create_engine(get_settings())
    session_factory = create_session_factory(engine)
    try:
        async with session_factory() as session:
            stored = await session.get(Application, UUID(application["id"]))
            assert stored is not None
            assert stored.created_by_id == UUID(owner["id"])
            assert stored.case_owner_id == UUID(owner["id"])
            history = (
                await session.execute(
                    select(ApplicationOwnerHistory).where(
                        ApplicationOwnerHistory.application_id == stored.id,
                        ApplicationOwnerHistory.effective_to.is_(None),
                    )
                )
            ).scalar_one()
            assert history.owner_id == UUID(owner["id"])
    finally:
        await engine.dispose()

    rollback_tag = unique_tag()
    rollback_mobile = f"+97156{rollback_tag[:8]}"
    failed = await authed.post(
        "/api/v1/applications",
        json={
            "customer": {
                "customer_type": "individual",
                "full_name": f"Rollback Review {rollback_tag}",
                "mobile": rollback_mobile,
            },
            "bank_id": str(uuid4()),
            "product_id": product["id"],
            "product_variant_id": variant["id"],
            "requested_amount": "10000",
        },
    )
    assert failed.status_code == 404
    assert failed.json()["error"]["code"] == "BANK_PRODUCT_NOT_FOUND"
    customers = await authed.get("/api/v1/customers", params={"q": rollback_mobile})
    assert customers.status_code == 200, customers.text
    assert customers.json()["items"] == []


@pytest.mark.asyncio
async def test_application_linkage_and_mutation_boundaries(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    await _enable_case_owner(authed)
    await _configure_system_type(
        authed,
        "BDM",
        permissions=[
            "Applications.View",
            "Applications.Create",
            "Applications.Edit",
            "Customers.View",
            "Customers.Create",
        ],
        directory_scope="office",
        customer_scope="office",
        application_scope="office",
        reporting_scope="office",
        can_be_case_owner=True,
    )
    first = await create_activated_user(authed, user_type_code="BDM", office_id=dxb)
    second = await create_activated_user(authed, user_type_code="BDM", office_id=dxb)
    bank, product, variant = await _variant(authed)
    owner_customer = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": f"Owner Customer {unique_tag()}",
            "mobile": f"+97157{unique_tag()[:8]}",
        },
    )
    assert owner_customer.status_code == 200, owner_customer.text

    async with await spawned_client() as first_client:
        await authenticate(first_client, first["email"], "UserPass1!")
        arbitrary = await first_client.post(
            "/api/v1/applications",
            json={
                "customer": {
                    "customer_type": "individual",
                    "full_name": f"Arbitrary Owner {unique_tag()}",
                    "mobile": f"+97158{unique_tag()[:8]}",
                },
                "bank_id": bank["id"],
                "product_id": product["id"],
                "product_variant_id": variant["id"],
                "case_owner_id": second["id"],
                "requested_amount": "5000",
            },
        )
        assert arbitrary.status_code == 403
        assert arbitrary.json()["error"]["code"] == "INITIAL_OWNER_FORBIDDEN"
        hidden_link = await first_client.post(
            "/api/v1/applications",
            json={
                "customer_id": owner_customer.json()["id"],
                "bank_id": bank["id"],
                "product_id": product["id"],
                "product_variant_id": variant["id"],
                "requested_amount": "5000",
            },
        )
        assert hidden_link.status_code == 403, hidden_link.text
        assert hidden_link.json()["error"]["code"] == "FORBIDDEN"

        own = await first_client.post(
            "/api/v1/applications",
            json={
                "customer": {
                    "customer_type": "individual",
                    "full_name": f"Owned Customer {unique_tag()}",
                    "mobile": f"+97159{unique_tag()[:8]}",
                },
                "bank_id": bank["id"],
                "product_id": product["id"],
                "product_variant_id": variant["id"],
                "requested_amount": "5000",
            },
        )
        assert own.status_code == 200, own.text
        assert own.json()["caseOwnerId"] == first["id"]

    async with await spawned_client() as second_client:
        await authenticate(second_client, second["email"], "UserPass1!")
        visible = await second_client.get(f"/api/v1/applications/{own.json()['id']}")
        assert visible.status_code == 200, visible.text
        blocked = await second_client.patch(
            f"/api/v1/applications/{own.json()['id']}",
            json={"requested_amount": "6000"},
        )
        assert blocked.status_code == 404

    await _configure_system_type(
        authed,
        "COD",
        permissions=["Applications.View", "Applications.Edit"],
        application_scope="office",
    )
    cod = await create_activated_user(authed, user_type_code="COD", office_id=dxb)
    async with await spawned_client() as cod_client:
        await authenticate(cod_client, cod["email"], "UserPass1!")
        updated = await cod_client.patch(
            f"/api/v1/applications/{own.json()['id']}",
            json={"requested_amount": "7000"},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["requestedAmount"] == "7000.00"

    assert owner["id"] != first["id"]


@pytest.mark.asyncio
async def test_hr_cannot_assign_final_user_type_even_if_permission_is_misconfigured(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    hr_type = await _configure_system_type(
        authed,
        "HR",
        permissions=["Users.View", "Users.Create", "Users.Edit", "Users.AssignUserType"],
        directory_scope="company",
    )
    gm_type = next(
        item
        for item in (await authed.get("/api/v1/user-types")).json()["items"]
        if item["code"] == "GM"
    )
    hr = await create_activated_user(authed, user_type_code="HR")
    designation = (await authed.get("/api/v1/designations")).json()["items"][0]
    tag = unique_tag()
    async with await spawned_client() as hr_client:
        await authenticate(hr_client, hr["email"], "UserPass1!")
        escalated = await hr_client.post(
            "/api/v1/users",
            json={
                "full_name": f"Escalation Probe {tag}",
                "employee_code": f"ESC-{tag}",
                "email": f"escalation-{tag}@review.test",
                "mobile": "+971500001111",
                "designation_id": designation["id"],
                "employment_status": "Active",
                "joining_date": "2026-09-01",
                "user_type_id": gm_type["id"],
            },
        )
        assert escalated.status_code == 403
        assert escalated.json()["error"]["code"] == "USER_TYPE_ASSIGN_FORBIDDEN"
        pending = await hr_client.post(
            "/api/v1/users",
            json={
                "full_name": f"Pending Probe {tag}",
                "employee_code": f"PEN-{tag}",
                "email": f"pending-{tag}@review.test",
                "mobile": "+971500001112",
                "designation_id": designation["id"],
                "employment_status": "Active",
                "joining_date": "2026-09-01",
            },
        )
        assert pending.status_code == 200, pending.text
        assert pending.json()["userType"]["code"] == "PENDING"
        assigned = await hr_client.post(
            f"/api/v1/users/{pending.json()['id']}/assign-type",
            json={"user_type_id": gm_type["id"]},
        )
        assert assigned.status_code == 403
        assert assigned.json()["error"]["code"] == "USER_TYPE_ASSIGN_FORBIDDEN"
    assert "Users.AssignUserType" in hr_type["permissions"]


@pytest.mark.asyncio
async def test_office_attendance_permission_is_narrow_and_workflow_reads_are_owner_gm_only(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    await _configure_system_type(
        authed,
        "OM",
        permissions=["Attendance.View", "Attendance.ManageOffice"],
        directory_scope="office",
    )
    await _configure_system_type(authed, "GM", permissions=["Dashboard.View"])
    await _configure_system_type(
        authed,
        "BDM",
        permissions=["Applications.View", "Dashboard.View"],
        application_scope="office",
    )
    om = await create_activated_user(authed, user_type_code="OM", office_id=dxb)
    same_office = await create_activated_user(authed, user_type_code="SE", office_id=dxb)
    other_office = await create_activated_user(authed, user_type_code="SE", office_id=auh)
    gm = await create_activated_user(authed, user_type_code="GM")
    bdm = await create_activated_user(authed, user_type_code="BDM", office_id=dxb)

    async with await spawned_client() as om_client:
        await authenticate(om_client, om["email"], "UserPass1!")
        saved = await om_client.put(
            "/api/v1/attendance/records",
            json={
                "attendance_date": "2026-09-03",
                "entries": [{"employee_id": same_office["id"], "status": "Present"}],
            },
        )
        assert saved.status_code == 200, saved.text
        denied = await om_client.put(
            "/api/v1/attendance/records",
            json={
                "attendance_date": "2026-09-03",
                "entries": [{"employee_id": other_office["id"], "status": "Present"}],
            },
        )
        assert denied.status_code == 404
        global_config = await om_client.put(
            "/api/v1/attendance/working-days",
            json={"weekdays": [0, 1, 2, 3, 4]},
        )
        assert global_config.status_code == 403

    async with await spawned_client() as gm_client:
        await authenticate(gm_client, gm["email"], "UserPass1!")
        allowed = await gm_client.get("/api/v1/workflows")
        assert allowed.status_code == 200, allowed.text
    async with await spawned_client() as bdm_client:
        await authenticate(bdm_client, bdm["email"], "UserPass1!")
        blocked = await bdm_client.get("/api/v1/workflows")
        assert blocked.status_code == 403


@pytest.mark.asyncio
async def test_system_type_hierarchy_defaults_and_pending_are_fail_closed(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    types = {
        item["code"]: item for item in (await authed.get("/api/v1/user-types")).json()["items"]
    }
    assert set(types) >= {
        "PENDING",
        "OWNER",
        "GM",
        "BDM",
        "SM",
        "COD",
        "TL",
        "SE",
        "OM",
        "ITM",
        "HR",
        "PRO",
        "AUDITOR",
    }
    for code in ("OWNER", "GM", "BDM", "SM", "COD", "TL"):
        assert types[code]["canBeReportingManager"] is True
    for code in ("PENDING", "SE", "OM", "ITM", "HR", "PRO", "AUDITOR"):
        assert types[code]["canBeReportingManager"] is False
    assert types["PENDING"]["permissions"] == []
    assert types["PENDING"]["visibilityScope"] is None
    assert types["PENDING"]["customerVisibilityScope"] is None
    assert types["PENDING"]["applicationVisibilityScope"] is None
    assert types["PENDING"]["reportingVisibilityScope"] is None
    pending_id = types["PENDING"]["id"]
    permission_change = await authed.put(
        f"/api/v1/user-types/{pending_id}/permissions",
        json={"permissions": ["Dashboard.View"]},
    )
    assert permission_change.status_code == 403
    scope_change = await authed.put(
        f"/api/v1/user-types/{pending_id}/scope",
        json={"visibility_scope": "company"},
    )
    assert scope_change.status_code == 403
    owner_change = await authed.put(
        f"/api/v1/user-types/{pending_id}/case-owner",
        json={"can_be_case_owner": True},
    )
    assert owner_change.status_code == 403
    deactivate = await authed.post(f"/api/v1/user-types/{pending_id}/deactivate")
    assert deactivate.status_code == 403
    assert deactivate.json()["error"]["code"] == "PENDING_USER_TYPE_PROTECTED"


@pytest.mark.asyncio
async def test_office_hierarchy_drives_team_visibility_without_cross_office_leakage(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    await _configure_system_type(
        authed,
        "BDM",
        permissions=["Users.View"],
        directory_scope="office",
    )
    await _configure_system_type(
        authed,
        "TL",
        permissions=["Users.View"],
        directory_scope="team",
    )

    async def create_sales_org(office: str, suffix: str) -> tuple[str, str]:
        department = await authed.post(
            "/api/v1/departments",
            json={
                "office_id": office,
                "name": f"Review Sales {suffix}",
                "code": f"RS-{suffix}",
            },
        )
        assert department.status_code == 200, department.text
        team = await authed.post(
            "/api/v1/teams",
            json={
                "office_id": office,
                "department_id": department.json()["id"],
                "name": f"Review Team {suffix}",
                "code": f"RT-{suffix}",
            },
        )
        assert team.status_code == 200, team.text
        return department.json()["id"], team.json()["id"]

    dxb_department, dxb_team = await create_sales_org(dxb, unique_tag()[:8])
    auh_department, auh_team = await create_sales_org(auh, unique_tag()[:8])

    async def create_chain(office: str, department: str, team: str) -> list[dict]:
        chain: list[dict] = []
        manager_id: str | None = None
        for code in ("BDM", "SM", "COD", "TL", "SE"):
            user = await create_activated_user(
                authed,
                user_type_code=code,
                office_id=office,
                department_id=department,
                team_id=team,
                manager_id=manager_id,
            )
            assert user["reportingManagerId"] == manager_id
            chain.append(user)
            manager_id = user["id"]
        leader = await authed.put(
            f"/api/v1/teams/{team}/leader",
            json={"user_id": chain[3]["id"]},
        )
        assert leader.status_code == 200, leader.text
        return chain

    dxb_chain = await create_chain(dxb, dxb_department, dxb_team)
    auh_chain = await create_chain(auh, auh_department, auh_team)

    async with await spawned_client() as tl_client:
        await authenticate(tl_client, dxb_chain[3]["email"], "UserPass1!")
        visible = await tl_client.get("/api/v1/users", params={"page_size": 50})
        assert visible.status_code == 200, visible.text
        visible_ids = {item["id"] for item in visible.json()["items"]}
        assert visible_ids == {dxb_chain[3]["id"], dxb_chain[4]["id"]}

    async with await spawned_client() as bdm_client:
        await authenticate(bdm_client, dxb_chain[0]["email"], "UserPass1!")
        for user in dxb_chain:
            visible = await bdm_client.get(f"/api/v1/users/{user['id']}")
            assert visible.status_code == 200, visible.text
        for user in auh_chain:
            hidden = await bdm_client.get(f"/api/v1/users/{user['id']}")
            assert hidden.status_code == 403


@pytest.mark.asyncio
async def test_application_stage_metadata_respects_application_scope_without_workflow_access(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    dxb = await office_id(authed, "DXB")
    auh = await office_id(authed, "AUH")
    bank, product, variant = await _variant(authed)

    await _configure_system_type(
        authed,
        "COD",
        permissions=["Applications.View", "Applications.Submit", "Applications.UpdateStage"],
        application_scope="office",
        can_be_case_owner=True,
    )
    await _configure_system_type(
        authed,
        "TL",
        permissions=["Applications.View", "Applications.Edit"],
        application_scope="team",
        can_be_case_owner=True,
    )
    await _configure_system_type(
        authed,
        "SE",
        permissions=[
            "Applications.View",
            "Applications.Create",
            "Customers.View",
            "Customers.Create",
        ],
        customer_scope="own",
        application_scope="own",
        can_be_case_owner=True,
    )

    async def sales_team(office: str, label: str) -> tuple[str, str]:
        department = await authed.post(
            "/api/v1/departments",
            json={"office_id": office, "name": f"Stage Sales {label}", "code": f"SS-{label}"},
        )
        assert department.status_code == 200, department.text
        team = await authed.post(
            "/api/v1/teams",
            json={
                "office_id": office,
                "department_id": department.json()["id"],
                "name": f"Stage Team {label}",
                "code": f"ST-{label}",
            },
        )
        assert team.status_code == 200, team.text
        return department.json()["id"], team.json()["id"]

    dxb_department, dxb_team = await sales_team(dxb, unique_tag()[:8])
    auh_department, auh_team = await sales_team(auh, unique_tag()[:8])
    dxb_tl = await create_activated_user(
        authed,
        user_type_code="TL",
        office_id=dxb,
        department_id=dxb_department,
        team_id=dxb_team,
    )
    dxb_se = await create_activated_user(
        authed,
        user_type_code="SE",
        office_id=dxb,
        department_id=dxb_department,
        team_id=dxb_team,
        manager_id=dxb_tl["id"],
    )
    auh_tl = await create_activated_user(
        authed,
        user_type_code="TL",
        office_id=auh,
        department_id=auh_department,
        team_id=auh_team,
    )
    auh_se = await create_activated_user(
        authed,
        user_type_code="SE",
        office_id=auh,
        department_id=auh_department,
        team_id=auh_team,
        manager_id=auh_tl["id"],
    )
    dxb_cod = await create_activated_user(authed, user_type_code="COD", office_id=dxb)

    async def create_owned_application(user: dict, label: str) -> dict:
        async with await spawned_client() as scoped:
            await authenticate(scoped, user["email"], "UserPass1!")
            response = await scoped.post(
                "/api/v1/applications",
                json={
                    "customer": {
                        "customer_type": "individual",
                        "full_name": f"Stage Metadata {label}",
                        "mobile": f"+97155{unique_tag()[:8]}",
                    },
                    "bank_id": bank["id"],
                    "product_id": product["id"],
                    "product_variant_id": variant["id"],
                    "requested_amount": "10000",
                },
            )
            assert response.status_code == 200, response.text
            return response.json()

    dxb_application = await create_owned_application(dxb_se, "DXB")
    auh_application = await create_owned_application(auh_se, "AUH")

    async def assert_scoped_metadata(user: dict, visible: dict, hidden: dict) -> None:
        async with await spawned_client() as scoped:
            await authenticate(scoped, user["email"], "UserPass1!")
            metadata = await scoped.get(f"/api/v1/applications/{visible['id']}/progress")
            assert metadata.status_code == 200, metadata.text
            payload = metadata.json()
            assert payload["workflowId"] == visible["workflowId"]
            assert payload["status"] == "active"
            assert payload["stages"]
            assert payload["transitions"]
            assert all("status" in stage for stage in payload["stages"])
            assert "bank" not in payload
            assert "product" not in payload
            assert (
                await scoped.get(f"/api/v1/applications/{hidden['id']}/progress")
            ).status_code == 404
            assert (await scoped.get("/api/v1/workflows")).status_code == 403
            assert (
                await scoped.get(f"/api/v1/workflows/{visible['workflowId']}")
            ).status_code == 403

    await assert_scoped_metadata(dxb_tl, dxb_application, auh_application)
    await assert_scoped_metadata(dxb_se, dxb_application, auh_application)
    await assert_scoped_metadata(dxb_cod, dxb_application, auh_application)

    async with await spawned_client() as reviewer:
        await authenticate(reviewer, dxb_tl["email"], "UserPass1!")
        path = f"/api/v1/applications/{dxb_application['id']}/internal-review"
        state = (await reviewer.get(path)).json()
        forwarded = await reviewer.post(
            path,
            json={
                "action": "forward",
                "expected_event_id": state["eventId"],
            },
        )
        assert forwarded.status_code == 200, forwarded.text

    async with await spawned_client() as cod_client:
        await authenticate(cod_client, dxb_cod["email"], "UserPass1!")
        submitted = await cod_client.post(
            f"/api/v1/applications/{dxb_application['id']}/case-number",
            json={"bank_case_number": f"STAGE-{unique_tag()[:8]}"},
        )
        assert submitted.status_code == 200, submitted.text
        assert submitted.json()["currentStageKey"] == "submitted"
