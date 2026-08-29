from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from helpers import owner_client
from httpx import AsyncClient
from nexa_bos_api.applications.models import Application
from nexa_bos_api.finance.calc import (
    calculate_component,
    largest_remainder_allocate,
    round_money,
)
from nexa_bos_api.finance.models import FinanceComponent, FinancePayout
from nexa_bos_api.identity.enums import AssignmentField
from nexa_bos_api.identity.models import User, UserAssignmentHistory, new_uuid
from nexa_bos_api.main import app
from sqlalchemy import select
from test_applications import _catalog
from test_finance_security import (
    _activate_rule,
    _booked_application,
    _month_end,
    _rule_request,
    _unique_month,
)
from test_reports import _reporting_user


def _next_month(value: date) -> date:
    return date(value.year + 1, 1, 1) if value.month == 12 else date(value.year, value.month + 1, 1)


def test_decimal_rounding_methods_and_largest_remainder() -> None:
    assert round_money(Decimal("1.005")) == Decimal("1.01")
    assert round_money(Decimal("-1.005")) == Decimal("-1.01")
    with pytest.raises(TypeError, match="float"):
        round_money(1.25)  # type: ignore[arg-type]

    assert calculate_component(
        method="fixed",
        eligible_amount=Decimal("999"),
        fixed_amount=Decimal("12.345"),
        percentage_rate=None,
        flat_amount=None,
        slabs=[],
    ) == Decimal("12.35")
    assert calculate_component(
        method="percentage",
        eligible_amount=Decimal("123.45"),
        fixed_amount=None,
        percentage_rate=Decimal("2.5"),
        flat_amount=None,
        slabs=[],
    ) == Decimal("3.09")
    assert calculate_component(
        method="flat_percentage",
        eligible_amount=Decimal("100"),
        fixed_amount=None,
        percentage_rate=Decimal("2.5"),
        flat_amount=Decimal("10"),
        slabs=[],
    ) == Decimal("12.50")
    assert calculate_component(
        method="slab",
        eligible_amount=Decimal("150"),
        fixed_amount=None,
        percentage_rate=None,
        flat_amount=None,
        slabs=[
            (Decimal("0"), Decimal("99.99"), Decimal("5")),
            (Decimal("100"), Decimal("199.99"), Decimal("20")),
        ],
    ) == Decimal("20.00")

    allocations = largest_remainder_allocate(
        Decimal("0.01"),
        [("first", Decimal("50"), 1), ("second", Decimal("50"), 2)],
    )
    assert allocations == {"first": Decimal("0.01"), "second": Decimal("0.00")}
    assert sum(allocations.values(), start=Decimal("0.00")) == Decimal("0.01")


@pytest.mark.asyncio
async def test_rule_validation_versioning_modes_and_overlap(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    base = _rule_request(dib["id"], pf["id"], period)

    invalid_split = {**base, "recipients": [{**base["recipients"][0], "split_percent": "99"}]}
    response = await authed.post("/api/v1/finance/commission-rules", json=invalid_split)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "FINANCE_SPLIT_TOTAL_INVALID"

    mixed_recipient = {
        **base["recipients"][0],
        "calculation_method": "fixed",
        "fixed_amount": "1.00",
    }
    mixed = {**base, "recipients": [mixed_recipient]}
    response = await authed.post("/api/v1/finance/commission-rules", json=mixed)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "FINANCE_PAYOUT_MODE_MIXED"

    overlapping_slabs = {
        **base,
        "calculation_method": "slab",
        "fixed_amount": None,
        "slabs": [
            {
                "minimum_eligible": "0",
                "maximum_eligible": "100",
                "payout_amount": "5",
                "sort_order": 0,
            },
            {
                "minimum_eligible": "100",
                "maximum_eligible": "200",
                "payout_amount": "10",
                "sort_order": 1,
            },
        ],
    }
    response = await authed.post("/api/v1/finance/commission-rules", json=overlapping_slabs)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "FINANCE_SLAB_OVERLAP"

    independent = {
        **base,
        "payout_mode": "independent_role_rate",
        "calculation_method": None,
        "fixed_amount": None,
        "recipients": [
            {
                **base["recipients"][0],
                "split_percent": None,
                "calculation_method": "fixed",
                "fixed_amount": "10.00",
            }
        ],
    }
    created = await authed.post("/api/v1/finance/commission-rules", json=independent)
    assert created.status_code == 200, created.text
    assert created.json()["payoutMode"] == "independent_role_rate"
    activated = await authed.post(
        f"/api/v1/finance/commission-rules/{created.json()['id']}/activate"
    )
    assert activated.status_code == 200, activated.text

    overlap = await authed.post("/api/v1/finance/commission-rules", json=independent)
    assert overlap.status_code == 200, overlap.text
    assert overlap.json()["version"] == created.json()["version"] + 1
    rejected = await authed.post(
        f"/api/v1/finance/commission-rules/{overlap.json()['id']}/activate"
    )
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "COMMISSION_RULE_OVERLAP"

    later = _next_month(period)
    non_overlapping = {
        **independent,
        "effective_from": later.isoformat(),
        "effective_to": _month_end(later).isoformat(),
    }
    next_version = await authed.post("/api/v1/finance/commission-rules", json=non_overlapping)
    assert next_version.status_code == 200, next_version.text
    activated_next = await authed.post(
        f"/api/v1/finance/commission-rules/{next_version.json()['id']}/activate"
    )
    assert activated_next.status_code == 200, activated_next.text


@pytest.mark.asyncio
async def test_booked_and_funded_use_only_the_locked_eligible_amounts(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    booked_at = datetime(period.year, period.month, 8, 10, tzinfo=UTC)
    funded_at = datetime(period.year, period.month, 18, 10, tzinfo=UTC)
    application = await _booked_application(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
        owner_id=owner["id"],
        event_at=booked_at,
        booked_amount="1000.00",
    )
    async with app.state.session_factory() as session:
        row = await session.get(Application, UUID(application["id"]))
        assert row is not None
        row.funded_amount = Decimal("2000.00")
        row.fund_released_at = funded_at
        await session.commit()

    booked_rule = _rule_request(dib["id"], pf["id"], period)
    booked_rule.update(
        {
            "calculation_method": "percentage",
            "fixed_amount": None,
            "percentage_rate": "1",
        }
    )
    created_booked = await authed.post("/api/v1/finance/commission-rules", json=booked_rule)
    assert created_booked.status_code == 200, created_booked.text
    await authed.post(f"/api/v1/finance/commission-rules/{created_booked.json()['id']}/activate")
    funded_rule = {
        **booked_rule,
        "eligibility_milestone": "funded",
        "percentage_rate": "2",
    }
    created_funded = await authed.post("/api/v1/finance/commission-rules", json=funded_rule)
    assert created_funded.status_code == 200, created_funded.text
    await authed.post(f"/api/v1/finance/commission-rules/{created_funded.json()['id']}/activate")

    generated = await authed.post(f"/api/v1/finance/periods/{period.isoformat()}/generate")
    assert generated.status_code == 200, generated.text
    payout = generated.json()["payouts"][0]
    drill = await authed.get(f"/api/v1/finance/payouts/{payout['id']}/components")
    commission = {
        row["eligibilityMilestone"]: row
        for row in drill.json()["items"]
        if row["componentType"] == "commission"
    }
    assert commission["booked"]["eligibleAmount"] == "1000.00"
    assert commission["booked"]["amount"] == "10.00"
    assert commission["funded"]["eligibleAmount"] == "2000.00"
    assert commission["funded"]["amount"] == "40.00"
    assert "999999.99" not in drill.text
    assert "888888.88" not in drill.text


@pytest.mark.asyncio
async def test_event_time_manager_attribution_is_frozen(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    event_at = datetime(period.year, period.month, 10, 12, tzinfo=UTC)
    changed_at = event_at + timedelta(days=2)
    manager_at_event = await _reporting_user(
        authed,
        scope="company",
        permissions=["Finance.View"],
        can_be_reporting_manager=True,
    )
    later_manager = await _reporting_user(
        authed,
        scope="company",
        permissions=["Finance.View"],
        can_be_reporting_manager=True,
    )
    case_owner = await _reporting_user(
        authed,
        scope="own",
        permissions=["Finance.View"],
        manager_id=manager_at_event["id"],
    )
    application = await _booked_application(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
        owner_id=case_owner["id"],
        event_at=event_at,
    )
    async with app.state.session_factory() as session:
        open_history = (
            await session.execute(
                select(UserAssignmentHistory).where(
                    UserAssignmentHistory.user_id == UUID(case_owner["id"]),
                    UserAssignmentHistory.field == AssignmentField.REPORTING_MANAGER,
                    UserAssignmentHistory.effective_to.is_(None),
                )
            )
        ).scalar_one()
        open_history.effective_to = changed_at
        session.add(
            UserAssignmentHistory(
                id=new_uuid(),
                user_id=UUID(case_owner["id"]),
                field=AssignmentField.REPORTING_MANAGER,
                value_id=later_manager["id"],
                value_label=later_manager["fullName"],
                effective_from=changed_at,
                effective_to=None,
            )
        )
        owner_row = await session.get(User, UUID(case_owner["id"]))
        assert owner_row is not None
        owner_row.reporting_manager_id = UUID(later_manager["id"])
        await session.commit()

    await _activate_rule(
        authed,
        dib["id"],
        pf["id"],
        period,
        source="reporting_manager",
        level=1,
    )
    generated = await authed.post(f"/api/v1/finance/periods/{period.isoformat()}/generate")
    assert generated.status_code == 200, generated.text
    assert {row["recipientId"] for row in generated.json()["payouts"]} == {manager_at_event["id"]}
    async with app.state.session_factory() as session:
        component = (
            await session.execute(
                select(FinanceComponent).where(
                    FinanceComponent.application_id == UUID(application["id"]),
                    FinanceComponent.component_type == "commission",
                )
            )
        ).scalar_one()
        assert str(component.recipient_id) == manager_at_event["id"]
        assert component.attribution_snapshot is not None
        assert component.attribution_snapshot["source"] == "reporting_manager"
        assert component.attribution_snapshot["hierarchyLevel"] == 1
        assert component.attribution_snapshot["chain"][0]["userId"] == case_owner["id"]
        assert component.attribution_snapshot["chain"][1]["userId"] == manager_at_event["id"]
        assert component.attribution_snapshot["resolvedRecipientUserId"] == manager_at_event["id"]


@pytest.mark.asyncio
async def test_incentive_uses_highest_single_matching_monthly_slab(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    await _booked_application(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
        owner_id=owner["id"],
        event_at=datetime(period.year, period.month, 9, 12, tzinfo=UTC),
        booked_amount="250.00",
    )
    await _activate_rule(authed, dib["id"], pf["id"], period, fixed_amount="1.00")
    plan_body = {
        "name": f"Monthly {period.isoformat()}",
        "effective_from": period.isoformat(),
        "effective_to": _month_end(period).isoformat(),
        "slabs": [
            {
                "minimum_production": "0",
                "maximum_production": "99.99",
                "payout_amount": "5",
                "sort_order": 0,
            },
            {
                "minimum_production": "100",
                "maximum_production": "299.99",
                "payout_amount": "20",
                "sort_order": 1,
            },
            {
                "minimum_production": "300",
                "maximum_production": None,
                "payout_amount": "50",
                "sort_order": 2,
            },
        ],
    }
    created = await authed.post("/api/v1/finance/incentive-plans", json=plan_body)
    assert created.status_code == 200, created.text
    activated = await authed.post(
        f"/api/v1/finance/incentive-plans/{created.json()['id']}/activate"
    )
    assert activated.status_code == 200, activated.text
    overlap = await authed.post("/api/v1/finance/incentive-plans", json=plan_body)
    assert overlap.status_code == 200, overlap.text
    overlap_activation = await authed.post(
        f"/api/v1/finance/incentive-plans/{overlap.json()['id']}/activate"
    )
    assert overlap_activation.status_code == 409
    assert overlap_activation.json()["error"]["code"] == "INCENTIVE_PLAN_OVERLAP"

    generated = await authed.post(f"/api/v1/finance/periods/{period.isoformat()}/generate")
    assert generated.status_code == 200, generated.text
    payout = generated.json()["payouts"][0]
    assert payout["commission"] == "1.00"
    assert payout["incentive"] == "20.00"
    assert payout["grossAmount"] == "21.00"
    drill = await authed.get(f"/api/v1/finance/payouts/{payout['id']}/components")
    incentive = next(row for row in drill.json()["items"] if row["componentType"] == "incentive")
    assert incentive["eligibleAmount"] == "250.00"
    assert incentive["amount"] == "20.00"


@pytest.mark.asyncio
async def test_adjustment_clawback_and_carry_forward_lineage(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    first_month = _unique_month()
    second_month = _next_month(first_month)
    third_month = _next_month(second_month)
    first_app = await _booked_application(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
        owner_id=owner["id"],
        event_at=datetime(first_month.year, first_month.month, 8, 12, tzinfo=UTC),
    )
    second_app = await _booked_application(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
        owner_id=owner["id"],
        event_at=datetime(second_month.year, second_month.month, 8, 12, tzinfo=UTC),
    )
    rule_body = _rule_request(dib["id"], pf["id"], first_month, fixed_amount="10.00")
    rule_body["effective_to"] = _month_end(third_month).isoformat()
    rule = await authed.post("/api/v1/finance/commission-rules", json=rule_body)
    assert rule.status_code == 200, rule.text
    assert (
        await authed.post(f"/api/v1/finance/commission-rules/{rule.json()['id']}/activate")
    ).status_code == 200

    first = await authed.post(f"/api/v1/finance/periods/{first_month.isoformat()}/generate")
    assert first.status_code == 200, first.text
    first_payout = first.json()["payouts"][0]
    first_drill = await authed.get(f"/api/v1/finance/payouts/{first_payout['id']}/components")
    original = next(
        row for row in first_drill.json()["items"] if row["componentType"] == "commission"
    )
    negative = await authed.post(
        f"/api/v1/finance/periods/{first_month.isoformat()}/adjustments",
        json={
            "application_id": first_app["id"],
            "recipient_id": owner["id"],
            "amount": "-25.00",
            "reason": "Authorized penalty",
        },
    )
    assert negative.status_code == 200, negative.text
    first_statement = await authed.get(
        "/api/v1/finance/statements", params={"period_month": first_month.isoformat()}
    )
    first_item = first_statement.json()["items"][0]
    assert first_item["finalPayable"] == "0.00"
    assert first_item["carryForward"] == "-15.00"
    await authed.post(f"/api/v1/finance/periods/{first_month.isoformat()}/review")
    await authed.post(f"/api/v1/finance/periods/{first_month.isoformat()}/finalize")

    second = await authed.post(f"/api/v1/finance/periods/{second_month.isoformat()}/generate")
    assert second.status_code == 200, second.text
    second_payout = second.json()["payouts"][0]
    assert second_payout["previousCarryForward"] == "-15.00"
    assert second_payout["grossAmount"] == "-5.00"
    assert second_payout["finalPayable"] == "0.00"
    assert second_payout["carryForward"] == "-5.00"
    positive = await authed.post(
        f"/api/v1/finance/periods/{second_month.isoformat()}/adjustments",
        json={
            "application_id": second_app["id"],
            "recipient_id": owner["id"],
            "amount": "8.00",
            "reason": "Authorized correction",
        },
    )
    assert positive.status_code == 200, positive.text
    second_after = await authed.get(
        "/api/v1/finance/statements", params={"period_month": second_month.isoformat()}
    )
    assert second_after.json()["items"][0]["finalPayable"] == "3.00"
    assert second_after.json()["items"][0]["carryForward"] == "0.00"
    await authed.post(f"/api/v1/finance/periods/{second_month.isoformat()}/review")
    await authed.post(f"/api/v1/finance/periods/{second_month.isoformat()}/finalize")

    third = await authed.post(f"/api/v1/finance/periods/{third_month.isoformat()}/generate")
    assert third.status_code == 200, third.text
    assert third.json()["payouts"] == []
    clawback = await authed.post(
        f"/api/v1/finance/periods/{third_month.isoformat()}/clawbacks",
        json={
            "original_component_id": original["id"],
            "amount": "2.345",
            "reason": "Current-month recovery",
        },
    )
    assert clawback.status_code == 200, clawback.text
    assert clawback.json()["applicationId"] == first_app["id"]
    assert clawback.json()["originalComponentId"] == original["id"]
    assert clawback.json()["amount"] == "-2.35"
    third_statement = await authed.get(
        "/api/v1/finance/statements", params={"period_month": third_month.isoformat()}
    )
    assert third_statement.json()["items"][0]["clawback"] == "-2.35"
    assert third_statement.json()["items"][0]["finalPayable"] == "0.00"
    assert third_statement.json()["items"][0]["carryForward"] == "-2.35"
    async with app.state.session_factory() as session:
        original_row = await session.get(FinanceComponent, UUID(original["id"]))
        assert original_row is not None
        assert original_row.amount == Decimal("10.00")
        second_row = await session.get(FinancePayout, UUID(second_payout["id"]))
        assert second_row is not None
        assert str(second_row.previous_payout_id) == first_payout["id"]
        assert second_row.previous_carry == Decimal("-15.00")
