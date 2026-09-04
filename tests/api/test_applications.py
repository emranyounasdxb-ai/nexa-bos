from __future__ import annotations

from datetime import date

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
from httpx import AsyncClient, Response
from nexa_bos_api.identity.models import AuditEvent
from nexa_bos_api.main import app
from sqlalchemy import event, select


async def _customer(client: AsyncClient, name: str) -> dict:
    response = await client.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": f"{name} {unique_tag()}",
            "mobile": f"+97150{unique_tag()[:8]}",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _catalog(client: AsyncClient) -> tuple[dict, dict, dict, dict]:
    banks = {item["code"]: item for item in (await client.get("/api/v1/banks")).json()["items"]}
    products = {
        item["code"]: item for item in (await client.get("/api/v1/products")).json()["items"]
    }
    return banks["DIB"], banks["EIB"], products["PF"], products["CC"]


async def _enable_case_owner(client: AsyncClient, code: str = "OWNER") -> dict:
    types = (await client.get("/api/v1/user-types")).json()["items"]
    row = next(item for item in types if item["code"] == code)
    if row["canBeCaseOwner"]:
        return row
    response = await client.put(
        f"/api/v1/user-types/{row['id']}/case-owner",
        json={"can_be_case_owner": True},
    )
    assert response.status_code == 200, response.text
    return response.json()


_TEST_STAGES = (
    ("SUBMITTED", "Submitted", 20),
    ("RETURNED_REQUIREMENT_PENDING", "Returned / Requirement Pending", 30),
    ("RESUBMITTED", "Resubmitted", 40),
    ("APPROVED", "Approved", 50),
    ("BOOKED", "Booked", 60),
    ("FUND_RELEASED", "Fund Released", 70),
)
_TEST_TRANSITIONS = (
    ("application_created", "submitted"),
    ("submitted", "returned_requirement_pending"),
    ("submitted", "approved"),
    ("returned_requirement_pending", "resubmitted"),
    ("resubmitted", "returned_requirement_pending"),
    ("resubmitted", "approved"),
    ("approved", "booked"),
    ("booked", "fund_released"),
)


async def _ensure_test_workflow(client: AsyncClient, bank_id: str, product_id: str) -> dict:
    listed = await client.get(f"/api/v1/workflows?bank_id={bank_id}&product_id={product_id}")
    items = listed.json()["items"]
    active = next((item for item in items if item["status"] == "active"), None)
    if active and any(stage.get("systemKey") == "submitted" for stage in active["stages"]):
        return active
    created = await client.post(
        "/api/v1/workflows", json={"bank_id": bank_id, "product_id": product_id}
    )
    assert created.status_code == 200, created.text
    workflow = created.json()
    if any(stage.get("systemKey") == "submitted" for stage in workflow["stages"]):
        return workflow
    for code, name, order in _TEST_STAGES:
        added = await client.post(
            f"/api/v1/workflows/{workflow['id']}/stages",
            json={"name": name, "code": code, "sort_order": order},
        )
        assert added.status_code == 200, added.text
    workflow = (await client.get(f"/api/v1/workflows/{workflow['id']}")).json()
    by_key = {stage["systemKey"]: stage["id"] for stage in workflow["stages"]}
    updated = await client.put(
        f"/api/v1/workflows/{workflow['id']}/transitions",
        json={
            "items": [
                {"from_stage_id": by_key[source], "to_stage_id": by_key[target]}
                for source, target in _TEST_TRANSITIONS
            ]
        },
    )
    assert updated.status_code == 200, updated.text
    return updated.json()


async def _create_app(
    client: AsyncClient,
    *,
    customer_id: str,
    bank_id: str,
    product_id: str,
    case_owner_id: str,
    requested_amount: str | None = "10000",
    bank_case_number: str | None = None,
) -> dict:
    actor = (await client.get("/api/v1/auth/me")).json()
    payload: dict[str, object] = {
        "customer_id": customer_id,
        "bank_id": bank_id,
        "product_id": product_id,
        "case_owner_id": actor["id"],
        "requested_amount": requested_amount,
    }
    if bank_case_number:
        payload["bank_case_number"] = bank_case_number
    await _enable_case_owner(client)
    await _ensure_test_workflow(client, bank_id, product_id)
    variant = await create_product_variant(client, bank_id=bank_id, product_id=product_id)
    payload["product_variant_id"] = variant["id"]
    response = await client.post("/api/v1/applications", json=payload)
    assert response.status_code == 200, response.text
    application = response.json()
    if case_owner_id != actor["id"]:
        reassigned = await client.post(
            f"/api/v1/applications/{application['id']}/reassign-owner",
            json={"case_owner_id": case_owner_id, "reason": "Automated test setup"},
        )
        assert reassigned.status_code == 200, reassigned.text
        application = reassigned.json()
    return application


async def _stage_by_key(client: AsyncClient, workflow_id: str, key: str) -> dict:
    workflow = (await client.get(f"/api/v1/workflows/{workflow_id}")).json()
    return next(item for item in workflow["stages"] if item["systemKey"] == key)


@pytest.mark.asyncio
async def test_case_owner_defaults_no_and_owner_can_enable(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    types = (await authed.get("/api/v1/user-types")).json()["items"]
    for item in types:
        if item["isSystem"] and item["canBeCaseOwner"]:
            cleared = await authed.put(
                f"/api/v1/user-types/{item['id']}/case-owner",
                json={"can_be_case_owner": False},
            )
            assert cleared.status_code == 200, cleared.text
    types = (await authed.get("/api/v1/user-types")).json()["items"]
    for item in types:
        if item["isSystem"]:
            assert item["canBeCaseOwner"] is False, item["code"]
    owner_type = next(item for item in types if item["code"] == "OWNER")
    enabled = await authed.put(
        f"/api/v1/user-types/{owner_type['id']}/case-owner",
        json={"can_be_case_owner": True},
    )
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["canBeCaseOwner"] is True
    listed = await authed.get("/api/v1/users/case-owners")
    assert owner["id"] in {item["id"] for item in listed.json()["items"]}
    se = next(item for item in types if item["code"] == "SE")
    se_enabled = await authed.put(
        f"/api/v1/user-types/{se['id']}/case-owner",
        json={"can_be_case_owner": True},
    )
    assert se_enabled.json()["canBeCaseOwner"] is True
    await authed.put(
        f"/api/v1/user-types/{se['id']}/case-owner",
        json={"can_be_case_owner": False},
    )


@pytest.mark.asyncio
async def test_application_requires_manually_configured_workflow(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    await _enable_case_owner(authed)
    dib, _eib, _pf, _cc = await _catalog(authed)
    tag = unique_tag().upper()
    product = await authed.post(
        "/api/v1/products",
        json={"name": f"Manual {tag}", "code": f"M{tag[:6]}"},
    )
    assert product.status_code == 200, product.text
    mapping = await authed.post(
        "/api/v1/bank-products",
        json={"bank_id": dib["id"], "product_id": product.json()["id"]},
    )
    assert mapping.status_code == 200, mapping.text
    variant = await create_product_variant(
        authed,
        bank_id=dib["id"],
        product_id=product.json()["id"],
    )
    workflows = await authed.get(
        f"/api/v1/workflows?bank_id={dib['id']}&product_id={product.json()['id']}"
    )
    assert workflows.json()["items"] == []
    customer = await _customer(authed, "NoFlow")
    blocked = await authed.post(
        "/api/v1/applications",
        json={
            "customer_id": customer["id"],
            "bank_id": dib["id"],
            "product_id": product.json()["id"],
            "product_variant_id": variant["id"],
            "case_owner_id": owner["id"],
        },
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "WORKFLOW_NOT_CONFIGURED"
    created = await authed.post(
        "/api/v1/workflows",
        json={"bank_id": dib["id"], "product_id": product.json()["id"]},
    )
    assert created.status_code == 200, created.text
    assert [stage["name"] for stage in created.json()["stages"]] == ["Application Created"]
    assert created.json()["transitions"] == []
    allowed = await authed.post(
        "/api/v1/applications",
        json={
            "customer_id": customer["id"],
            "bank_id": dib["id"],
            "product_id": product.json()["id"],
            "product_variant_id": variant["id"],
            "case_owner_id": owner["id"],
        },
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["currentStage"] == "Application Created"


@pytest.mark.asyncio
async def test_application_id_generation_and_entry_stage(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "App ID")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    year = date.today().year
    assert created["applicationCode"].startswith(f"PF-DIB-{year}-")
    assert created["currentStage"] == "Application Created"
    assert created["terminalOutcome"] is None
    assert created["submitted"] is False
    products = {
        item["code"]: item for item in (await authed.get("/api/v1/products")).json()["items"]
    }
    assert products["PF"]["requestedAmountRequired"] is True
    assert products["PF"]["approvedAmountRequired"] is True


@pytest.mark.asyncio
async def test_duplicate_active_blocked_and_parallel_bank_product(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, eib, pf, cc = await _catalog(authed)
    customer = await _customer(authed, "Dup")
    first = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    duplicate = await authed.post(
        "/api/v1/applications",
        json={
            "customer_id": customer["id"],
            "bank_id": dib["id"],
            "product_id": pf["id"],
            "product_variant_id": first["productVariantId"],
            "case_owner_id": owner["id"],
            "requested_amount": "1",
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "APPLICATION_ACTIVE_DUPLICATE"
    other_bank = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=eib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    other_product = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=cc["id"],
        case_owner_id=owner["id"],
        requested_amount=None,
    )
    assert other_bank["id"] != first["id"]
    assert other_product["id"] != first["id"]


@pytest.mark.asyncio
async def test_submission_case_number_lock_and_correction(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "Submit")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    tag = unique_tag()[:8]
    submitted = await authed.post(
        f"/api/v1/applications/{created['id']}/case-number",
        json={"bank_case_number": f"DIB-{tag}"},
    )
    assert submitted.status_code == 200, submitted.text
    body = submitted.json()
    assert body["currentStage"] == "Submitted"
    assert body["submittedAt"]
    original_submitted = body["submittedAt"]
    locked = await authed.patch(
        f"/api/v1/applications/{created['id']}",
        json={"requested_amount": "999"},
    )
    assert locked.status_code == 422
    assert locked.json()["error"]["code"] == "SUBMITTED_DATA_LOCKED"
    corrected = await authed.post(
        f"/api/v1/applications/{created['id']}/correct-submitted",
        json={"reason": "Fix amount", "requested_amount": "12000"},
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["requestedAmount"] == "12000.00"
    replacement = await create_product_variant(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
    )
    corrected_variant = await authed.post(
        f"/api/v1/applications/{created['id']}/correct-submitted",
        json={
            "reason": "Correct Product Variant",
            "product_variant_id": replacement["id"],
        },
    )
    assert corrected_variant.status_code == 200, corrected_variant.text
    assert corrected_variant.json()["productVariantId"] == replacement["id"]
    timeline = (await authed.get(f"/api/v1/applications/{created['id']}/timeline")).json()["items"]
    variant_event = next(
        event
        for event in reversed(timeline)
        if event["eventType"] == "submitted_data_corrected"
        and event["payload"]["new"]["productVariantId"] == replacement["id"]
    )
    assert variant_event["payload"]["old"]["productVariantId"] == created["productVariantId"]
    async with app.state.session_factory() as session:
        audit = (
            (
                await session.execute(
                    select(AuditEvent)
                    .where(
                        AuditEvent.action == "application.correct_submitted",
                        AuditEvent.entity_id == created["id"],
                    )
                    .order_by(AuditEvent.created_at.desc())
                )
            )
            .scalars()
            .first()
        )
        assert audit is not None
    assert audit.old_values["productVariantId"] == created["productVariantId"]
    assert audit.new_values["productVariantId"] == replacement["id"]
    inactive_candidate = await create_product_variant(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
    )
    deactivated_candidate = await authed.post(
        f"/api/v1/product-variants/{inactive_candidate['id']}/deactivate"
    )
    assert deactivated_candidate.status_code == 200, deactivated_candidate.text
    inactive_correction = await authed.post(
        f"/api/v1/applications/{created['id']}/correct-submitted",
        json={
            "reason": "Attempt inactive Variant",
            "product_variant_id": inactive_candidate["id"],
        },
    )
    assert inactive_correction.status_code == 422
    assert inactive_correction.json()["error"]["code"] == "PRODUCT_VARIANT_INACTIVE"
    mismatched_variant = await create_product_variant(
        authed,
        bank_id=dib["id"],
        product_id=_cc["id"],
    )
    mismatched_correction = await authed.post(
        f"/api/v1/applications/{created['id']}/correct-submitted",
        json={
            "reason": "Attempt mismatched Variant",
            "product_variant_id": mismatched_variant["id"],
        },
    )
    assert mismatched_correction.status_code == 422
    assert mismatched_correction.json()["error"]["code"] == "PRODUCT_VARIANT_MAPPING_MISMATCH"
    unchanged = await authed.get(f"/api/v1/applications/{created['id']}")
    assert unchanged.json()["productVariantId"] == replacement["id"]
    other = await _create_app(
        authed,
        customer_id=(await _customer(authed, "Other"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    clash = await authed.post(
        f"/api/v1/applications/{other['id']}/case-number",
        json={"bank_case_number": f"DIB-{tag}"},
    )
    assert clash.status_code == 409
    renamed = await authed.post(
        f"/api/v1/applications/{created['id']}/case-number",
        json={"bank_case_number": f"DIB-{tag}-FIX", "reason": "Typo"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["submittedAt"] == original_submitted


@pytest.mark.asyncio
async def test_workflow_transitions_return_resubmit_approval_fund(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "Flow")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    approved = await _stage_by_key(authed, created["workflowId"], "approved")
    blocked = await authed.post(
        f"/api/v1/applications/{created['id']}/stage",
        json={"stage_id": approved["id"], "bank_stage_date": date.today().isoformat()},
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "TRANSITION_NOT_ALLOWED"
    await authed.post(
        f"/api/v1/applications/{created['id']}/case-number",
        json={"bank_case_number": f"FLOW-{unique_tag()[:8]}"},
    )
    returned = await _stage_by_key(authed, created["workflowId"], "returned_requirement_pending")
    missing_reason = await authed.post(
        f"/api/v1/applications/{created['id']}/stage",
        json={"stage_id": returned["id"], "bank_stage_date": date.today().isoformat()},
    )
    assert missing_reason.status_code == 422
    returned_ok = await authed.post(
        f"/api/v1/applications/{created['id']}/stage",
        json={
            "stage_id": returned["id"],
            "bank_stage_date": date.today().isoformat(),
            "requirement_text": "Salary certificate",
            "stage_note": "Bank query",
        },
    )
    assert returned_ok.json()["currentStage"] == "Returned / Requirement Pending"
    resubmitted = await _stage_by_key(authed, created["workflowId"], "resubmitted")
    resub = await authed.post(
        f"/api/v1/applications/{created['id']}/stage",
        json={"stage_id": resubmitted["id"], "bank_stage_date": date.today().isoformat()},
    )
    assert resub.json()["currentStage"] == "Resubmitted"
    approved_ok = await authed.post(
        f"/api/v1/applications/{created['id']}/stage",
        json={
            "stage_id": approved["id"],
            "bank_stage_date": date.today().isoformat(),
            "approved_amount": "9000",
        },
    )
    assert approved_ok.json()["currentStage"] == "Approved"
    assert approved_ok.json()["approvedAmount"] == "9000.00"
    booked = await _stage_by_key(authed, created["workflowId"], "booked")
    await authed.post(
        f"/api/v1/applications/{created['id']}/stage",
        json={
            "stage_id": booked["id"],
            "bank_stage_date": date.today().isoformat(),
            "booked_amount": "9000",
        },
    )
    funded = await _stage_by_key(authed, created["workflowId"], "fund_released")
    done = await authed.post(
        f"/api/v1/applications/{created['id']}/stage",
        json={
            "stage_id": funded["id"],
            "bank_stage_date": date.today().isoformat(),
            "funded_amount": "9000",
        },
    )
    assert done.json()["terminalOutcome"] == "Completed"
    assert done.json()["completedAt"]
    timeline = (await authed.get(f"/api/v1/applications/{created['id']}/timeline")).json()["items"]
    types = [item["eventType"] for item in timeline]
    assert "application_created" in types
    assert "submission" in types
    assert "returned_requirement_pending" in types
    assert "resubmission" in types
    assert "approval" in types
    assert "booking" in types
    assert "fund_release" in types
    assert "completed" in types
    reopen = await authed.post(
        f"/api/v1/applications/{created['id']}/outcome",
        json={"outcome": "Cancelled", "reason": "no"},
    )
    assert reopen.status_code == 422
    assert reopen.json()["error"]["code"] == "APPLICATION_TERMINAL"
    progress = (await authed.get(f"/api/v1/applications/{created['id']}/progress")).json()
    assert progress["version"] >= 1
    assert any(stage["current"] for stage in progress["stages"])


@pytest.mark.asyncio
async def test_terminal_outcomes_and_stage_correction(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "Reject")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    submitted = await _stage_by_key(authed, created["workflowId"], "submitted")
    future = await authed.post(
        f"/api/v1/applications/{created['id']}/correct-stage",
        json={
            "stage_id": submitted["id"],
            "bank_stage_date": "2099-01-01",
            "reason": "bad date",
        },
    )
    assert future.status_code == 422
    corrected = await authed.post(
        f"/api/v1/applications/{created['id']}/correct-stage",
        json={
            "stage_id": submitted["id"],
            "bank_stage_date": date.today().isoformat(),
            "reason": "Wrong stage recorded",
            "stage_note": "corrected note",
        },
    )
    assert corrected.status_code == 200
    timeline = (await authed.get(f"/api/v1/applications/{created['id']}/timeline")).json()["items"]
    assert any(item["eventType"] == "stage_corrected" for item in timeline)
    assert any(item["eventType"] == "application_created" for item in timeline)
    closed = await authed.post(
        f"/api/v1/applications/{created['id']}/outcome",
        json={"outcome": "Final Rejected", "reason": "Income insufficient"},
    )
    assert closed.json()["terminalOutcome"] == "Final Rejected"
    second = await _create_app(
        authed,
        customer_id=(await _customer(authed, "Cancel"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    cancelled = await authed.post(
        f"/api/v1/applications/{second['id']}/outcome",
        json={"outcome": "Cancelled", "reason": "Internal cancel"},
    )
    assert cancelled.json()["terminalOutcome"] == "Cancelled"
    third = await _create_app(
        authed,
        customer_id=(await _customer(authed, "Withdraw"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    withdrawn = await authed.post(
        f"/api/v1/applications/{third['id']}/outcome",
        json={"outcome": "Withdrawn", "reason": "Customer withdrew"},
    )
    assert withdrawn.json()["terminalOutcome"] == "Withdrawn"


@pytest.mark.asyncio
async def test_workflow_versioning_and_migration(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "Migrate")
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    original_version = created["workflowVersion"]
    versioned = await authed.post(
        "/api/v1/workflows", json={"bank_id": dib["id"], "product_id": pf["id"]}
    )
    assert versioned.status_code == 200, versioned.text
    assert versioned.json()["version"] == original_version + 1
    refreshed = (await authed.get(f"/api/v1/applications/{created['id']}")).json()
    assert refreshed["workflowVersion"] == original_version
    newer = await _create_app(
        authed,
        customer_id=(await _customer(authed, "NewVer"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    assert newer["workflowVersion"] == original_version + 1
    target = next(
        stage for stage in versioned.json()["stages"] if stage["systemKey"] == "application_created"
    )
    migrated = await authed.post(
        f"/api/v1/applications/{created['id']}/migrate",
        json={
            "workflow_id": versioned.json()["id"],
            "target_stage_id": target["id"],
            "reason": "Align with latest bank flow",
        },
    )
    assert migrated.status_code == 200, migrated.text
    assert migrated.json()["workflowVersion"] == original_version + 1
    timeline = (await authed.get(f"/api/v1/applications/{created['id']}/timeline")).json()["items"]
    assert any(item["eventType"] == "workflow_migrated" for item in timeline)


@pytest.mark.asyncio
async def test_customer_deactivate_and_merge_relink(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    source = await _customer(authed, "Source")
    primary = await _customer(authed, "Primary")
    app = await _create_app(
        authed,
        customer_id=source["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    blocked = await authed.post(f"/api/v1/customers/{source['id']}/deactivate")
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "CUSTOMER_HAS_ACTIVE_APPLICATIONS"
    merged = await authed.post(
        f"/api/v1/customers/{source['id']}/merge",
        json={"primary_customer_id": primary["id"]},
    )
    assert merged.status_code == 200, merged.text
    relinked = (await authed.get(f"/api/v1/applications/{app['id']}")).json()
    assert relinked["customerId"] == primary["id"]
    assert relinked["currentStage"] == "Application Created"
    timeline = (await authed.get(f"/api/v1/applications/{app['id']}/timeline")).json()["items"]
    assert any(item["eventType"] == "customer_relinked" for item in timeline)


@pytest.mark.asyncio
async def test_search_respects_application_scope(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    customer = await _customer(authed, "Search")
    app = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    listed = await authed.get(f"/api/v1/applications?application_id={app['applicationCode']}")
    assert listed.status_code == 200
    assert any(item["id"] == app["id"] for item in listed.json()["items"])
    tag = unique_tag().upper()
    created_type = await authed.post(
        "/api/v1/user-types", json={"name": f"OwnApp {tag}", "code": f"O{tag[:8]}"}
    )
    type_id = created_type.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    await authed.put(
        f"/api/v1/user-types/{type_id}/permissions",
        json={"permissions": ["Applications.View"]},
    )
    await authed.put(
        f"/api/v1/user-types/{type_id}/application-scope",
        json={"application_visibility_scope": "own"},
    )
    viewer = await create_activated_user(
        authed, user_type_code=created_type.json()["code"], password="UserPass1!"
    )
    async with await spawned_client() as other:
        await authenticate(other, viewer["email"], "UserPass1!")
        hidden_list = await other.get("/api/v1/applications")
        ids = {item["id"] for item in hidden_list.json()["items"]}
        assert app["id"] not in ids
        hidden = await other.get(f"/api/v1/applications/{app['id']}")
        assert hidden.status_code == 404
        hidden_variants = await other.get("/api/v1/applications/product-variants")
        assert hidden_variants.status_code == 200
        assert app["productVariantId"] not in {
            item["id"] for item in hidden_variants.json()["items"]
        }
        customer_apps = await other.get(f"/api/v1/customers/{customer['id']}/applications")
        assert customer_apps.status_code in {200, 403}
        if customer_apps.status_code == 200:
            assert customer_apps.json()["items"] == []


@pytest.mark.asyncio
async def test_application_list_query_count_does_not_grow_per_row(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    tag = unique_tag()
    applications = []
    for index in range(4):
        customer = await _customer(authed, f"Query batch {tag} {index}")
        applications.append(
            await _create_app(
                authed,
                customer_id=customer["id"],
                bank_id=dib["id"],
                product_id=pf["id"],
                case_owner_id=owner["id"],
            )
        )

    async def counted_get(path: str) -> tuple[int, Response]:
        statements: list[str] = []

        def count_selects(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: bool,
        ) -> None:
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        engine = app.state.engine.sync_engine
        event.listen(engine, "before_cursor_execute", count_selects)
        try:
            response = await authed.get(path)
        finally:
            event.remove(engine, "before_cursor_execute", count_selects)
        assert response.status_code == 200, response.text
        return len(statements), response

    single_count, single = await counted_get(
        f"/api/v1/applications?application_id={applications[0]['applicationCode']}"
    )
    batch_count, batch = await counted_get(f"/api/v1/applications?q={tag}")

    assert len(single.json()["items"]) == 1
    assert len(batch.json()["items"]) == 4
    assert batch_count <= single_count + 1, (single_count, batch_count)


@pytest.mark.asyncio
async def test_case_owner_reassignment_visibility_without_customer_directory_access(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    dubai = await office_id(authed, "DXB")
    abu_dhabi = await office_id(authed, "AUH")
    tag = unique_tag().upper()
    created_type = await authed.post(
        "/api/v1/user-types",
        json={
            "name": f"OfficeApp {tag}",
            "code": f"A{tag[:8]}",
            "can_be_case_owner": True,
        },
    )
    type_id = created_type.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    await authed.put(
        f"/api/v1/user-types/{type_id}/permissions",
        json={
            "permissions": [
                "Applications.View",
                "Applications.Create",
                "Customers.View",
            ]
        },
    )
    await authed.put(
        f"/api/v1/user-types/{type_id}/application-scope",
        json={"application_visibility_scope": "office"},
    )
    await authed.put(
        f"/api/v1/user-types/{type_id}/customer-scope",
        json={"customer_visibility_scope": "office"},
    )
    viewer = await create_activated_user(
        authed,
        user_type_code=created_type.json()["code"],
        password="UserPass1!",
        office_id=dubai,
    )
    other_owner = await create_activated_user(
        authed,
        user_type_code=created_type.json()["code"],
        password="UserPass1!",
        office_id=abu_dhabi,
    )
    visible_customer = await _customer(authed, "OfficeCust")
    hidden_customer = await _customer(authed, "HiddenCust")
    visible_app = await _create_app(
        authed,
        customer_id=visible_customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=viewer["id"],
    )
    hidden_app = await _create_app(
        authed,
        customer_id=hidden_customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=other_owner["id"],
    )
    async with await spawned_client() as other:
        await authenticate(other, viewer["email"], "UserPass1!")
        apps = {item["id"] for item in (await other.get("/api/v1/applications")).json()["items"]}
        assert visible_app["id"] in apps
        assert hidden_app["id"] not in apps
        customers = await other.get("/api/v1/customers")
        assert customers.status_code == 403
        shown = await other.get(f"/api/v1/customers/{visible_customer['id']}/applications")
        assert shown.status_code == 403
    reassigned = await authed.post(
        f"/api/v1/applications/{hidden_app['id']}/reassign-owner",
        json={"case_owner_id": viewer["id"], "reason": "Coverage"},
    )
    assert reassigned.status_code == 200, reassigned.text
    timeline = (await authed.get(f"/api/v1/applications/{hidden_app['id']}/timeline")).json()[
        "items"
    ]
    assert any(item["eventType"] == "case_owner_reassigned" for item in timeline)
    assert reassigned.json()["caseOwnerId"] == viewer["id"]
    async with await spawned_client() as other:
        await authenticate(other, viewer["email"], "UserPass1!")
        apps = {item["id"] for item in (await other.get("/api/v1/applications")).json()["items"]}
        assert hidden_app["id"] in apps
        customers = await other.get("/api/v1/customers")
        assert customers.status_code == 403


@pytest.mark.asyncio
async def test_filter_keeps_historical_ineligible_case_owner(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    tag = unique_tag().upper()
    created_type = await authed.post(
        "/api/v1/user-types",
        json={"name": f"HistOwn {tag}", "code": f"H{tag[:8]}", "can_be_case_owner": True},
    )
    type_id = created_type.json()["id"]
    await authed.post(f"/api/v1/user-types/{type_id}/activate")
    former = await create_activated_user(authed, user_type_code=created_type.json()["code"])
    customer = await _customer(authed, "HistFilter")
    app = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=former["id"],
    )
    disabled = await authed.put(
        f"/api/v1/user-types/{type_id}/case-owner",
        json={"can_be_case_owner": False},
    )
    assert disabled.json()["canBeCaseOwner"] is False
    eligible = {
        item["id"] for item in (await authed.get("/api/v1/users/case-owners")).json()["items"]
    }
    assert former["id"] not in eligible
    referenced = {
        item["id"]
        for item in (await authed.get("/api/v1/applications/case-owners")).json()["items"]
    }
    assert former["id"] in referenced
    filtered = await authed.get(f"/api/v1/applications?case_owner_id={former['id']}")
    assert app["id"] in {item["id"] for item in filtered.json()["items"]}
    moved = await authed.post(
        f"/api/v1/applications/{app['id']}/reassign-owner",
        json={"case_owner_id": owner["id"], "reason": "Keep history searchable"},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["caseOwnerId"] == owner["id"]
    historical = await authed.get(f"/api/v1/applications?case_owner_id={former['id']}")
    assert app["id"] in {item["id"] for item in historical.json()["items"]}
    still_listed = {
        item["id"]
        for item in (await authed.get("/api/v1/applications/case-owners")).json()["items"]
    }
    assert former["id"] in still_listed


@pytest.mark.asyncio
async def test_ineligible_case_owner_and_completed_not_manual(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    types = (await authed.get("/api/v1/user-types")).json()["items"]
    hr = next(item for item in types if item["code"] == "HR")
    assert hr["canBeCaseOwner"] is False
    owner_type = next(item for item in types if item["code"] == "OWNER")
    if not owner_type["canBeCaseOwner"]:
        await authed.put(
            f"/api/v1/user-types/{owner_type['id']}/case-owner",
            json={"can_be_case_owner": True},
        )
    assert (
        next(item for item in types if item["code"] == "OWNER")["applicationVisibilityScope"]
        == "company"
    )
    hr_user = await create_activated_user(authed, user_type_code="HR")
    dib, _eib, pf, _cc = await _catalog(authed)
    await _ensure_test_workflow(authed, dib["id"], pf["id"])
    customer = await _customer(authed, "HROwner")
    rejected = await authed.post(
        "/api/v1/applications",
        json={
            "customer_id": customer["id"],
            "bank_id": dib["id"],
            "product_id": pf["id"],
            "product_variant_id": (
                await create_product_variant(authed, bank_id=dib["id"], product_id=pf["id"])
            )["id"],
            "case_owner_id": hr_user["id"],
            "requested_amount": "1",
        },
    )
    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "INITIAL_OWNER_FORBIDDEN"
    created = await _create_app(
        authed,
        customer_id=customer["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=owner["id"],
    )
    disabled = await authed.put(
        f"/api/v1/user-types/{owner_type['id']}/case-owner",
        json={"can_be_case_owner": False},
    )
    assert disabled.json()["canBeCaseOwner"] is False
    still_visible = await authed.get(f"/api/v1/applications/{created['id']}")
    assert still_visible.status_code == 200
    assert still_visible.json()["caseOwnerId"] == owner["id"]
    later = await _customer(authed, "AfterDisable")
    blocked = await authed.post(
        "/api/v1/applications",
        json={
            "customer_id": later["id"],
            "bank_id": dib["id"],
            "product_id": pf["id"],
            "product_variant_id": (
                await create_product_variant(authed, bank_id=dib["id"], product_id=pf["id"])
            )["id"],
            "case_owner_id": owner["id"],
            "requested_amount": "1",
        },
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "CASE_OWNER_INELIGIBLE"
    await authed.put(
        f"/api/v1/user-types/{owner_type['id']}/case-owner",
        json={"can_be_case_owner": True},
    )
    completed = await authed.post(
        f"/api/v1/applications/{created['id']}/outcome",
        json={"outcome": "Completed", "reason": "no button"},
    )
    assert completed.status_code == 422
    assert completed.json()["error"]["code"] == "COMPLETED_AUTOMATIC"
