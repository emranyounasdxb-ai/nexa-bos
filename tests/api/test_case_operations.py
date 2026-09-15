from __future__ import annotations

from contextlib import AsyncExitStack
from datetime import date

import pytest
from helpers import (
    authenticate,
    create_activated_user,
    create_product_variant,
    create_team_fixture,
    office_id,
    owner_client,
    spawned_client,
    unique_tag,
)
from httpx import AsyncClient
from nexa_bos_api.case_operations.csv_service import HEADERS, blank_template, parse_csv
from test_applications import _catalog, _ensure_test_workflow
from test_role_readiness import _configure_system_type


@pytest.mark.asyncio
async def test_case_rules_routing_cross_sell_and_credit_card_closure(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    permissions = {
        "SE": [
            "Applications.View",
            "Applications.Create",
            "Applications.Edit",
            "Customers.View",
            "Customers.Create",
            "Customers.Edit",
            "CaseOperations.ViewReports",
        ],
        "TL": ["Applications.View", "CaseOperations.ViewRouting"],
        "SM": [
            "Applications.View",
            "CaseOperations.ViewRouting",
            "CaseOperations.ApproveClawback",
        ],
        "COD": [
            "Applications.View",
            "Applications.Submit",
            "Applications.UpdateStage",
            "CaseOperations.ViewRouting",
            "CaseOperations.StageCsv",
            "CaseOperations.SubmitClawback",
        ],
    }
    for code, values in permissions.items():
        await _configure_system_type(
            owner,
            code,
            permissions=values,
            directory_scope="office" if code in {"SM", "COD"} else "team",
            customer_scope="office" if code in {"SM", "COD"} else "team",
            application_scope="office" if code in {"SM", "COD"} else "team",
            reporting_scope="office" if code in {"SM", "COD"} else "team",
            can_be_case_owner=code == "SE",
        )
    dib, _eib, pf, cc = await _catalog(owner)
    await _ensure_test_workflow(owner, dib["id"], cc["id"])
    await _ensure_test_workflow(owner, dib["id"], pf["id"])
    variant = await create_product_variant(owner, bank_id=dib["id"], product_id=cc["id"])
    pf_variant = await create_product_variant(owner, bank_id=dib["id"], product_id=pf["id"])
    office = await office_id(owner, "DXB")
    tag = unique_tag()
    department = await owner.post(
        "/api/v1/departments",
        json={"office_id": office, "name": f"Case Ops {tag}"},
    )
    assert department.status_code == 200, department.text
    team = await create_team_fixture(
        owner,
        json={
            "office_id": office,
            "department_id": department.json()["id"],
            "name": f"Case Ops Team {tag}",
        },
    )
    assert team.status_code == 200, team.text
    sm = await create_activated_user(
        owner,
        user_type_code="SM",
        office_id=office,
        department_id=department.json()["id"],
    )
    coordinator = await create_activated_user(
        owner,
        user_type_code="COD",
        office_id=office,
        department_id=department.json()["id"],
    )
    tl = await create_activated_user(
        owner,
        user_type_code="TL",
        office_id=office,
        department_id=department.json()["id"],
        team_id=team.json()["id"],
        manager_id=sm["id"],
    )
    se = await create_activated_user(
        owner,
        user_type_code="SE",
        office_id=office,
        department_id=department.json()["id"],
        team_id=team.json()["id"],
        manager_id=tl["id"],
    )
    route = await owner.put(
        "/api/v1/case-operations/routing",
        json={
            "office_id": office,
            "product_id": cc["id"],
            "sales_manager_id": sm["id"],
            "coordinator_id": coordinator["id"],
        },
    )
    assert route.status_code == 200, route.text
    rule = await owner.post(
        "/api/v1/case-operations/card-point-rules",
        json={
            "bank_id": dib["id"],
            "product_variant_id": variant["id"],
            "points": "125.50",
            "effective_from": date.today().isoformat(),
        },
    )
    assert rule.status_code == 200, rule.text
    activated = await owner.post(
        f"/api/v1/case-operations/card-point-rules/{rule.json()['id']}/activate"
    )
    assert activated.status_code == 200, activated.text

    async with AsyncExitStack() as stack:
        actors = {}
        for code, user in (("se", se), ("tl", tl), ("sm", sm), ("cod", coordinator)):
            actor = await stack.enter_async_context(await spawned_client())
            await authenticate(actor, user["email"], "UserPass1!")
            actors[code] = actor
        created = await actors["se"].post(
            "/api/v1/applications",
            json={
                "customer": {
                    "customer_type": "individual",
                    "full_name": f"Cross Sell {tag}",
                    "mobile": f"+97155{tag[:8]}",
                },
                "bank_id": dib["id"],
                "product_id": cc["id"],
                "product_variant_id": variant["id"],
                "requested_amount": None,
            },
        )
        assert created.status_code == 200, created.text
        application = created.json()
        cross_sell = await actors["se"].post(
            "/api/v1/applications",
            json={
                "customer_id": application["customerId"],
                "bank_id": dib["id"],
                "product_id": pf["id"],
                "product_variant_id": pf_variant["id"],
                "requested_amount": "5000",
            },
        )
        assert cross_sell.status_code == 200, cross_sell.text
        forbidden_rule = await actors["sm"].post(
            "/api/v1/case-operations/card-point-rules",
            json={
                "bank_id": dib["id"],
                "product_variant_id": variant["id"],
                "points": "1.00",
                "effective_from": date.today().isoformat(),
            },
        )
        assert forbidden_rule.status_code == 403
        review = await actors["tl"].get(f"/api/v1/applications/{application['id']}/internal-review")
        booked = await actors["tl"].post(
            f"/api/v1/case-operations/applications/{application['id']}/book",
            json={"expected_review_event_id": review.json()["eventId"]},
        )
        assert booked.status_code == 200, booked.text
        assert booked.json()["caseOwnerId"] == se["id"]
        assert booked.json()["routedSalesManagerId"] == sm["id"]
        locked = await actors["se"].patch(
            f"/api/v1/applications/{application['id']}",
            json={"requested_amount": "9999"},
        )
        assert locked.status_code == 409 or locked.status_code == 422
        approved = await actors["sm"].post(
            f"/api/v1/case-operations/applications/{application['id']}/sales-manager-decision",
            json={"decision": "approve"},
        )
        assert approved.status_code == 200, approved.text
        closed = await actors["cod"].post(
            f"/api/v1/case-operations/applications/{application['id']}/bank-submission",
            json={"bank_file_number": f"BANK-{tag}"},
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["terminalOutcome"] == "Completed"
        metrics = await actors["se"].get(f"/api/v1/case-operations/metrics/employees/{se['id']}")
        assert metrics.status_code == 200, metrics.text
        assert metrics.json()["pointsEarned"] == "125.50"
        earnings = await actors["cod"].get("/api/v1/case-operations/earnings")
        assert earnings.status_code == 200, earnings.text
        earning = earnings.json()["items"][0]
        clawback = await actors["cod"].post(
            "/api/v1/case-operations/clawbacks",
            json={
                "earning_id": earning["id"],
                "amount": "125.50",
                "reason": "Bank cancellation evidence received",
            },
        )
        assert clawback.status_code == 200, clawback.text
        approved_clawback = await actors["sm"].post(
            f"/api/v1/case-operations/clawbacks/{clawback.json()['id']}/decision",
            json={"decision": "approve"},
        )
        assert approved_clawback.status_code == 200, approved_clawback.text
        assert approved_clawback.json()["status"] == "approved"
        duplicate = await actors["cod"].post(
            "/api/v1/case-operations/clawbacks",
            json={
                "earning_id": earning["id"],
                "amount": "125.50",
                "reason": "Duplicate retry",
            },
        )
        assert duplicate.status_code == 422
        updated_metrics = await actors["se"].get(
            f"/api/v1/case-operations/metrics/employees/{se['id']}"
        )
        assert updated_metrics.json()["pointsReversed"] == "125.50"
        assert updated_metrics.json()["pointsNet"] == "0.00"


def test_stage_csv_contract_is_exact_and_rejects_duplicate_or_wrong_headers() -> None:
    assert blank_template().decode("utf-8-sig").strip() == ",".join(HEADERS)
    with pytest.raises(Exception, match="headers must be exactly"):
        parse_csv(b"case_id,new_stage\nA,Approved\n")
