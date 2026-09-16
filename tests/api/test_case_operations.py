from __future__ import annotations

from contextlib import AsyncExitStack
from datetime import UTC, datetime

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
@pytest.mark.parametrize("submission_path", ["bank-submission", "case-number"])
async def test_case_rules_routing_cross_sell_and_credit_card_closure(
    client: AsyncClient,
    submission_path: str,
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
        "TL": [
            "Applications.View",
            "Applications.Create",
            "Applications.Edit",
            "Customers.Create",
            "CaseOperations.ViewRouting",
            "Dashboard.View",
            "Offices.Manage",
            "Departments.Manage",
            "Teams.Manage",
            "Designations.Manage",
            "UserTypes.View",
            "Users.View",
            "Contracts.View",
            "Transfers.View",
            "Exits.View",
            "Approvals.View",
            "Reports.View",
            "UserProfiles.HR.View",
            "UserProfiles.PRO.View",
        ],
        "SM": [
            "Applications.View",
            "CaseOperations.ViewRouting",
            "CaseOperations.ApproveClawback",
        ],
        "COD": [
            "Applications.View",
            "Dashboard.View",
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
    other_coordinator = await create_activated_user(
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
    pf_route = await owner.put(
        "/api/v1/case-operations/routing",
        json={
            "office_id": office,
            "product_id": pf["id"],
            "sales_manager_id": sm["id"],
            "coordinator_id": coordinator["id"],
        },
    )
    assert pf_route.status_code == 200, pf_route.text
    rule = await owner.post(
        "/api/v1/case-operations/card-point-rules",
        json={
            "bank_id": dib["id"],
            "product_variant_id": variant["id"],
            "points": "125.50",
            "effective_from": datetime.now(UTC).date().isoformat(),
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
        creation_owners = await actors["tl"].get("/api/v1/applications/creation-owners")
        assert creation_owners.status_code == 200, creation_owners.text
        assert {row["id"] for row in creation_owners.json()["items"]} == {tl["id"], se["id"]}
        for invalid_owner in (sm["id"], coordinator["id"]):
            tampered = await actors["tl"].post(
                "/api/v1/applications",
                json={
                    "customer_id": application["customerId"],
                    "bank_id": dib["id"],
                    "product_id": cc["id"],
                    "product_variant_id": variant["id"],
                    "case_owner_id": invalid_owner,
                },
            )
            assert tampered.status_code == 403, tampered.text
        own_case = await actors["tl"].post(
            "/api/v1/applications",
            json={
                "customer": {
                    "customer_type": "individual",
                    "full_name": f"TL Own {tag}",
                    "mobile": f"+97156{tag[:8]}",
                },
                "bank_id": dib["id"],
                "product_id": cc["id"],
                "product_variant_id": variant["id"],
                "case_owner_id": tl["id"],
            },
        )
        assert own_case.status_code == 200, own_case.text
        own_review = await actors["tl"].get(
            f"/api/v1/applications/{own_case.json()['id']}/internal-review"
        )
        assert own_review.json()["status"] == "pending_review"
        assert "forward" in own_review.json()["actions"]
        booked_own = await actors["tl"].post(
            f"/api/v1/case-operations/applications/{own_case.json()['id']}/book",
            json={"expected_review_event_id": own_review.json()["eventId"]},
        )
        assert booked_own.status_code == 200, booked_own.text
        assert booked_own.json()["caseOwnerId"] == tl["id"]
        own_dashboard = await actors["tl"].get("/api/v1/reports/tl-dashboard?view=own&queue=all")
        assert own_dashboard.status_code == 200, own_dashboard.text
        assert own_dashboard.json()["ownStatus"]["Created"] == 1
        assert own_dashboard.json()["teamStatus"]["Created"] == 1
        assert own_dashboard.json()["ownEarnings"]["cardsBooked"] == 1
        assert own_dashboard.json()["teamEarnings"]["cardsBooked"] == 0
        held_own = await actors["sm"].post(
            f"/api/v1/case-operations/applications/{own_case.json()['id']}/sales-manager-decision",
            json={"decision": "return", "reason": "Verify requested amount"},
        )
        assert held_own.status_code == 200, held_own.text
        corrected_own = await actors["tl"].patch(
            f"/api/v1/applications/{own_case.json()['id']}",
            json={"requested_amount": "1000"},
        )
        assert corrected_own.status_code == 200, corrected_own.text
        returned_review = await actors["tl"].get(
            f"/api/v1/applications/{own_case.json()['id']}/internal-review"
        )
        resubmitted_own = await actors["tl"].post(
            f"/api/v1/applications/{own_case.json()['id']}/internal-review",
            json={"action": "resubmit", "expected_event_id": returned_review.json()["eventId"]},
        )
        assert resubmitted_own.status_code == 200, resubmitted_own.text
        rebooked_own = await actors["tl"].post(
            f"/api/v1/case-operations/applications/{own_case.json()['id']}/book",
            json={"expected_review_event_id": resubmitted_own.json()["eventId"]},
        )
        assert rebooked_own.status_code == 200, rebooked_own.text
        assert (await actors["tl"].get("/api/v1/case-operations/routing")).status_code == 403
        assert (await actors["tl"].get("/api/v1/case-operations/reports/cases")).status_code == 403
        for path in (
            "organization/hierarchy",
            "contracts",
            "transfers",
            "exits",
            "approvals",
            "employee-profiles/dashboards/hr",
            "employee-profiles/dashboards/pro",
            "reports/dashboard",
            "reports/rankings",
            "user-types",
        ):
            denied = await actors["tl"].get(f"/api/v1/{path}")
            assert denied.status_code == 403, (path, denied.text)
        denied_office = await actors["tl"].post(
            "/api/v1/offices", json={"name": "Forbidden TL Office"}
        )
        assert denied_office.status_code == 403
        assert (
            await actors["tl"].get(f"/api/v1/reports/tl-dashboard?member_id={sm['id']}")
        ).status_code == 404
        assigned = await actors["tl"].post(
            "/api/v1/applications",
            json={
                "customer": {
                    "customer_type": "individual",
                    "full_name": f"TL Assigned {tag}",
                    "mobile": f"+97157{tag[:8]}",
                },
                "bank_id": dib["id"],
                "product_id": cc["id"],
                "product_variant_id": variant["id"],
                "case_owner_id": se["id"],
            },
        )
        assert assigned.status_code == 200, assigned.text
        assert assigned.json()["caseOwnerId"] == se["id"]
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
                "effective_from": datetime.now(UTC).date().isoformat(),
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
        before_approval = await actors["cod"].get("/api/v1/reports/dashboard?period=mtd")
        assert before_approval.status_code == 200, before_approval.text
        assert application["id"] not in {
            item["id"]
            for item in before_approval.json()["codWorkspace"]["queues"]["bankSubmission"]
        }
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
        ready = await actors["cod"].get("/api/v1/reports/dashboard?period=mtd")
        assert ready.status_code == 200, ready.text
        assert application["id"] in {
            item["id"] for item in ready.json()["codWorkspace"]["queues"]["bankSubmission"]
        }
        drill = await actors["cod"].get(
            "/api/v1/applications?dashboard_metric=awaiting_submission&dashboard_period=mtd&page_size=50"
        )
        assert drill.status_code == 200, drill.text
        assert application["id"] in {item["id"] for item in drill.json()["items"]}
        async with await spawned_client() as unrelated:
            await authenticate(unrelated, other_coordinator["email"], "UserPass1!")
            unrelated_dashboard = await unrelated.get("/api/v1/reports/dashboard?period=mtd")
            assert unrelated_dashboard.status_code == 200, unrelated_dashboard.text
            assert application["id"] not in {
                item["id"]
                for item in unrelated_dashboard.json()["codWorkspace"]["queues"]["bankSubmission"]
            }
            unrelated_drill = await unrelated.get(
                "/api/v1/applications?dashboard_metric=awaiting_submission&page_size=50"
            )
            assert unrelated_drill.status_code == 200, unrelated_drill.text
            assert application["id"] not in {item["id"] for item in unrelated_drill.json()["items"]}
        pf_application = cross_sell.json()
        pf_review = await actors["tl"].get(
            f"/api/v1/applications/{pf_application['id']}/internal-review"
        )
        pf_booked = await actors["tl"].post(
            f"/api/v1/case-operations/applications/{pf_application['id']}/book",
            json={"expected_review_event_id": pf_review.json()["eventId"]},
        )
        assert pf_booked.status_code == 200, pf_booked.text
        pf_before_approval = await actors["cod"].get("/api/v1/reports/dashboard?period=mtd")
        assert pf_application["id"] not in {
            item["id"]
            for item in pf_before_approval.json()["codWorkspace"]["queues"]["bankSubmission"]
        }
        pf_approved = await actors["sm"].post(
            f"/api/v1/case-operations/applications/{pf_application['id']}/sales-manager-decision",
            json={"decision": "approve"},
        )
        assert pf_approved.status_code == 200, pf_approved.text
        pf_ready = await actors["cod"].get("/api/v1/reports/dashboard?period=mtd")
        assert pf_ready.status_code == 200, pf_ready.text
        assert pf_application["id"] in {
            item["id"] for item in pf_ready.json()["codWorkspace"]["queues"]["bankSubmission"]
        }
        closed = await actors["cod"].post(
            (
                f"/api/v1/case-operations/applications/{application['id']}/bank-submission"
                if submission_path == "bank-submission"
                else f"/api/v1/applications/{application['id']}/case-number"
            ),
            json={
                "bank_file_number"
                if submission_path == "bank-submission"
                else "bank_case_number": f"BANK-{tag}"
            },
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["terminalOutcome"] == "Completed"
        completed_dashboard = await actors["cod"].get("/api/v1/reports/dashboard?period=mtd")
        assert completed_dashboard.status_code == 200, completed_dashboard.text
        assert completed_dashboard.json()["codWorkspace"]["kpis"]["completedFunded"] >= 1
        completed_drill = await actors["cod"].get(
            "/api/v1/applications?dashboard_metric=completed_funded&dashboard_period=mtd&page_size=50"
        )
        assert completed_drill.status_code == 200, completed_drill.text
        assert application["id"] in {item["id"] for item in completed_drill.json()["items"]}
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
        team_report = await actors["tl"].get("/api/v1/reports/tl-dashboard?view=team&queue=all")
        assert team_report.status_code == 200, team_report.text
        report = team_report.json()
        assert report["teamEarnings"]["pointsReversed"] == "125.50"
        assert report["ownEarnings"]["pointsReversed"] == "0.00"
        # PF is approved but not submitted; closed CC must not count as Coordinator work.
        assert report["teamStatus"]["With Coordinator"] == 1
        assert report["teamStatus"]["Bank Submitted"] == 1
        assert report["teamStatus"]["Completed/Closed"] == 1
        assert report["ownTotal"] == 1
        assert report["teamTotal"] == 3
        assert report["staff"][0]["pendingApproval"] == 1
        # Current workflow states partition cases; cumulative submitted milestones do not.
        assert report["currentWork"]["team"]["stages"]["completed"] == 1
        assert report["currentWork"]["team"]["stages"]["bank"] == 0
        assert sum(report["currentWork"]["team"]["stages"].values()) == report["teamTotal"]
        assert report["currentWork"]["team"]["booking"] == 1
        own_dashboard = await actors["tl"].get("/api/v1/reports/tl-dashboard?view=own")
        assert own_dashboard.status_code == 200, own_dashboard.text
        assert any(
            row["ownerId"] == se["id"] for row in own_dashboard.json()["pendingBookingItems"]
        )
        booking_queue = await actors["tl"].get(
            "/api/v1/reports/tl-dashboard?view=team&queue=booking"
        )
        assert booking_queue.status_code == 200, booking_queue.text
        assert booking_queue.json()["total"] == report["currentWork"]["team"]["booking"]
        assert all(row["canReview"] for row in booking_queue.json()["items"])
        for stage, count in report["currentWork"]["team"]["stages"].items():
            drill = await actors["tl"].get(
                f"/api/v1/reports/tl-dashboard?view=team&queue=stage_{stage}"
            )
            assert drill.status_code == 200, drill.text
            assert drill.json()["total"] == count
        assert report["pendingBookingItems"]
        assert all(row["canReview"] for row in report["pendingBookingItems"])
        assert {row["id"] for row in report["filterOptions"]["owners"]} == {tl["id"], se["id"]}
        searched = await actors["tl"].get(
            "/api/v1/reports/tl-dashboard?view=team&queue=all"
            f"&search={application['applicationCode']}&product_id={cc['id']}&outcome=Completed"
        )
        assert searched.status_code == 200, searched.text
        assert [row["id"] for row in searched.json()["items"]] == [application["id"]]
        assert searched.json()["items"][0]["pendingRole"] == "—"
        assert searched.json()["items"][0]["routingLabel"] == "Completed/Closed"
        assert (
            await actors["tl"].get(f"/api/v1/reports/tl-dashboard?owner_id={sm['id']}")
        ).status_code == 404
        completed_events = [event for event in report["activity"] if event["event"] == "completed"]
        assert completed_events[0]["newState"] == "Completed/Closed"
        reversal_events = [
            event for event in report["activity"] if event["event"] == "Clawback approved"
        ]
        assert len(reversal_events) == 1
        assert reversal_events[0]["details"]["net"] == "0.00"
        assert reversal_events[0]["actor"] == sm["fullName"]
        ranged = await actors["tl"].get(
            "/api/v1/reports/tl-dashboard?view=team&queue=all"
            f"&date_from={datetime.now(UTC).date().isoformat()}"
            f"&date_to={datetime.now(UTC).date().isoformat()}"
        )
        assert ranged.status_code == 200, ranged.text
        assert any(event["event"] == "Clawback approved" for event in ranged.json()["activity"])


def test_stage_csv_contract_is_exact_and_rejects_duplicate_or_wrong_headers() -> None:
    assert blank_template().decode("utf-8-sig").strip() == ",".join(HEADERS)
    with pytest.raises(Exception, match="headers must be exactly"):
        parse_csv(b"case_id,new_stage\nA,Approved\n")
