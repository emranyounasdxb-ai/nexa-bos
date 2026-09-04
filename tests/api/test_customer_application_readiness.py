from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from helpers import (
    authenticate,
    create_activated_user,
    create_product_variant,
    owner_client,
    spawned_client,
    unique_tag,
)
from httpx import AsyncClient
from test_applications import _catalog, _ensure_test_workflow


async def _configure_type(
    client: AsyncClient,
    code: str,
    *,
    permissions: list[str],
    application_scope: str | None = None,
    customer_scope: str | None = None,
    can_be_case_owner: bool | None = None,
) -> dict:
    rows = (await client.get("/api/v1/user-types")).json()["items"]
    user_type = next(item for item in rows if item["code"] == code)
    changed = await client.put(
        f"/api/v1/user-types/{user_type['id']}/permissions",
        json={"permissions": permissions},
    )
    assert changed.status_code == 200, changed.text
    for path, field, value in (
        ("application-scope", "application_visibility_scope", application_scope),
        ("customer-scope", "customer_visibility_scope", customer_scope),
    ):
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
    return user_type


async def _customer(client: AsyncClient, *, name: str, mobile: str, **identifiers: str) -> dict:
    response = await client.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": name,
            "mobile": mobile,
            **identifiers,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_owner_and_gm_customer_directory_and_se_notification_admin_denial(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    await _configure_type(
        owner,
        "GM",
        permissions=[
            "Customers.View",
            "Customers.Create",
            "Customers.Edit",
            "Customers.Activate",
            "Customers.Deactivate",
            "Customers.Merge",
        ],
        customer_scope="company",
    )
    await _configure_type(
        owner,
        "SE",
        permissions=[
            "Applications.View",
            "Applications.Create",
            "Customers.View",
            "Customers.Create",
            "Notifications.View",
            "Notifications.ManageRules",
            "Notifications.SendUrgent",
            "Notifications.ViewAudit",
        ],
        application_scope="own",
        customer_scope="own",
        can_be_case_owner=True,
    )
    gm = await create_activated_user(owner, user_type_code="GM")
    se = await create_activated_user(owner, user_type_code="SE")

    gm_client = await spawned_client()
    se_client = await spawned_client()
    try:
        await authenticate(gm_client, gm["email"], "UserPass1!")
        await authenticate(se_client, se["email"], "UserPass1!")
        assert (await owner.get("/api/v1/customers")).status_code == 200
        customer = await _customer(
            gm_client,
            name=f"GM Customer {unique_tag()}",
            mobile=f"+97150{unique_tag()[:8]}",
        )
        assert (await gm_client.get("/api/v1/customers")).status_code == 200
        assert (await gm_client.get(f"/api/v1/customers/{customer['id']}")).status_code == 200

        for response in (
            await se_client.get("/api/v1/customers"),
            await se_client.get(f"/api/v1/customers/{customer['id']}"),
            await se_client.post(
                "/api/v1/customers",
                json={
                    "customer_type": "individual",
                    "full_name": "Forbidden Customer",
                    "mobile": "+971500000099",
                },
            ),
            await se_client.get(f"/api/v1/customers/{customer['id']}/applications"),
        ):
            assert response.status_code == 403, response.text

        assert (await se_client.get("/api/v1/notifications")).status_code == 200
        for response in (
            await se_client.get("/api/v1/notifications/options"),
            await se_client.get("/api/v1/notifications/rules"),
            await se_client.get("/api/v1/notifications/audit"),
            await se_client.post(
                "/api/v1/notifications/urgent",
                json={
                    "category": "operations",
                    "title": "Forbidden",
                    "message": "Forbidden",
                    "acknowledgement_required": False,
                    "targets": [{"target_type": "company", "target_id": None}],
                },
            ),
        ):
            assert response.status_code == 403, response.text
    finally:
        await gm_client.aclose()
        await se_client.aclose()


@pytest.mark.asyncio
async def test_exact_identity_match_atomic_application_create_and_duplicate_prevention(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    await _configure_type(
        owner,
        "GM",
        permissions=["Customers.View", "Customers.Create", "Customers.Edit"],
        customer_scope="company",
    )
    await _configure_type(
        owner,
        "SE",
        permissions=["Applications.View", "Applications.Create", "Notifications.View"],
        application_scope="own",
        customer_scope=None,
        can_be_case_owner=True,
    )
    gm = await create_activated_user(owner, user_type_code="GM")
    se = await create_activated_user(owner, user_type_code="SE")
    dib, _eib, pf, _cc = await _catalog(owner)
    await _ensure_test_workflow(owner, dib["id"], pf["id"])
    variant = await create_product_variant(owner, bank_id=dib["id"], product_id=pf["id"])
    tag = unique_tag().upper()
    emirates_id = f"784-{tag}-1"
    passport = f"P{tag}"

    gm_client = await spawned_client()
    se_client = await spawned_client()
    try:
        await authenticate(gm_client, gm["email"], "UserPass1!")
        await authenticate(se_client, se["email"], "UserPass1!")
        existing = await _customer(
            gm_client,
            name=f"Canonical Person {tag}",
            mobile=f"+97151{tag[:8]}",
            emirates_id=emirates_id,
            passport=passport,
        )

        matched = await se_client.post(
            "/api/v1/applications/customer-match",
            json={"emirates_id": emirates_id.lower(), "passport": passport.lower()},
        )
        assert matched.status_code == 200, matched.text
        assert matched.json()["matched"] is True
        assert matched.json()["message"] == "This customer already exists in the system."
        assert matched.json()["customer"]["fullName"] == f"Canonical Person {tag}"
        assert matched.json()["history"] == []
        assert "id" not in matched.json()["customer"]
        assert "customerCode" not in matched.json()["customer"]

        payload = {
            "customer": {
                "customer_type": "individual",
                "full_name": "Client-supplied name must not replace canonical identity",
                "mobile": f"+97152{tag[:8]}",
                "email": f"matched-{tag.lower()}@example.com",
                "emirates_id": emirates_id.lower(),
                "passport": passport.lower(),
                "employer": "Updated during Application creation",
            },
            "bank_id": dib["id"],
            "product_id": pf["id"],
            "product_variant_id": variant["id"],
            "requested_amount": "25000",
        }
        created = await se_client.post("/api/v1/applications", json=payload)
        assert created.status_code == 200, created.text
        application = created.json()
        assert application["customerId"] == existing["id"]
        assert application["customerName"] == f"Canonical Person {tag}"
        assert application["caseOwnerId"] == se["id"]
        assert application["bankCaseNumber"] is None

        refreshed = await gm_client.get(f"/api/v1/customers/{existing['id']}")
        assert refreshed.status_code == 200, refreshed.text
        assert refreshed.json()["fullName"] == f"Canonical Person {tag}"
        assert refreshed.json()["emiratesId"] == emirates_id
        assert refreshed.json()["passport"] == passport
        assert refreshed.json()["mobile"] == f"+97152{tag[:8]}"

        with_history = await se_client.post(
            "/api/v1/applications/customer-match",
            json={"emirates_id": emirates_id, "passport": passport},
        )
        assert with_history.status_code == 200, with_history.text
        assert with_history.json()["history"] == [
            {
                "applicationId": application["id"],
                "applicationCode": application["applicationCode"],
                "bank": application["bankName"],
                "product": application["productName"],
                "status": application["currentStage"],
            }
        ]

        duplicate = await se_client.post(
            "/api/v1/applications",
            json={
                **payload,
                "customer": {
                    **payload["customer"],
                    "mobile": f"+97158{tag[:8]}",
                },
            },
        )
        assert duplicate.status_code == 409, duplicate.text
        assert duplicate.json()["error"]["code"] == "APPLICATION_ACTIVE_DUPLICATE"
        after_duplicate = await gm_client.get(f"/api/v1/customers/{existing['id']}")
        assert after_duplicate.json()["mobile"] == f"+97152{tag[:8]}"

        direct_link = await se_client.post(
            "/api/v1/applications",
            json={
                "customer_id": existing["id"],
                "bank_id": dib["id"],
                "product_id": pf["id"],
                "product_variant_id": variant["id"],
            },
        )
        assert direct_link.status_code == 403, direct_link.text

        stage_options = await se_client.get("/api/v1/applications/stages")
        assert stage_options.status_code == 200, stage_options.text
        assert {row["id"] for row in stage_options.json()["items"]} == {
            application["currentStageId"]
        }
        created_from = (datetime.now(UTC) - timedelta(minutes=2)).isoformat()
        filtered = await se_client.get(
            "/api/v1/applications",
            params={
                "q": application["applicationCode"],
                "bank_id": dib["id"],
                "product_id": pf["id"],
                "current_stage_id": application["currentStageId"],
                "created_from": created_from,
            },
        )
        assert filtered.status_code == 200, filtered.text
        assert [row["id"] for row in filtered.json()["items"]] == [application["id"]]

        rollback_id = f"784-ROLLBACK-{unique_tag().upper()}"
        failed = await se_client.post(
            "/api/v1/applications",
            json={
                **payload,
                "customer": {
                    **payload["customer"],
                    "full_name": "Atomic Rollback",
                    "mobile": "+971530000000",
                    "emirates_id": rollback_id,
                    "passport": None,
                },
                "bank_id": "00000000-0000-0000-0000-000000000000",
            },
        )
        assert failed.status_code == 404, failed.text
        rolled_back = await gm_client.get("/api/v1/customers", params={"q": rollback_id})
        assert rolled_back.status_code == 200, rolled_back.text
        assert rolled_back.json()["items"] == []
    finally:
        await gm_client.aclose()
        await se_client.aclose()


@pytest.mark.asyncio
async def test_conflicting_exact_identifiers_block_application_customer_match(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    await _configure_type(
        owner,
        "GM",
        permissions=["Customers.View", "Customers.Create"],
        customer_scope="company",
    )
    await _configure_type(
        owner,
        "SE",
        permissions=["Applications.Create", "Applications.View"],
        application_scope="own",
        can_be_case_owner=True,
    )
    gm = await create_activated_user(owner, user_type_code="GM")
    se = await create_activated_user(owner, user_type_code="SE")
    gm_client = await spawned_client()
    se_client = await spawned_client()
    try:
        await authenticate(gm_client, gm["email"], "UserPass1!")
        await authenticate(se_client, se["email"], "UserPass1!")
        tag = unique_tag().upper()
        emirates_id = f"784-CONFLICT-{tag}"
        passport = f"PCONFLICT{tag}"
        await _customer(
            gm_client,
            name=f"Emirates Identity {tag}",
            mobile=f"+97154{tag[:8]}",
            emirates_id=emirates_id,
        )
        await _customer(
            gm_client,
            name=f"Passport Identity {tag}",
            mobile=f"+97155{tag[:8]}",
            passport=passport,
        )
        conflict = await se_client.post(
            "/api/v1/applications/customer-match",
            json={"emirates_id": emirates_id, "passport": passport},
        )
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["error"]["code"] == "CUSTOMER_IDENTITY_CONFLICT"
        assert "different customers" in conflict.json()["error"]["message"]
    finally:
        await gm_client.aclose()
        await se_client.aclose()
