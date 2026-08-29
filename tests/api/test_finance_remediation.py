from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from helpers import owner_client
from httpx import AsyncClient
from nexa_bos_api.applications.models import Application, ApplicationOwnerHistory
from nexa_bos_api.finance.models import (
    CommissionRuleRecipient,
    CommissionRuleSlab,
    FinanceComponent,
    FinancePayout,
    FinancePayoutPeriod,
    FinancePeriodTransition,
    IncentivePlan,
    IncentiveSlab,
)
from nexa_bos_api.identity.enums import AssignmentField
from nexa_bos_api.identity.models import AuditEvent, User, UserAssignmentHistory, new_uuid
from nexa_bos_api.main import app
from openpyxl import load_workbook
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
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


async def _create_rule(client: AsyncClient, body: dict[str, object]) -> dict:
    created = await client.post("/api/v1/finance/commission-rules", json=body)
    assert created.status_code == 200, created.text
    return created.json()


async def _activate_created_rule(client: AsyncClient, body: dict[str, object]) -> dict:
    created = await _create_rule(client, body)
    activated = await client.post(f"/api/v1/finance/commission-rules/{created['id']}/activate")
    assert activated.status_code == 200, activated.text
    return activated.json()


@pytest.mark.asyncio
async def test_precision_is_rejected_and_persisted_drafts_are_revalidated(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    base = _rule_request(dib["id"], pf["id"], period)

    over_scale_split = {
        **base,
        "recipients": [{**base["recipients"][0], "split_percent": "99.99999"}],
    }
    rejected = await authed.post("/api/v1/finance/commission-rules", json=over_scale_split)
    assert rejected.status_code == 422

    over_scale_slab = {
        **base,
        "calculation_method": "slab",
        "fixed_amount": None,
        "slabs": [
            {
                "minimum_eligible": "0.00",
                "maximum_eligible": "100.004",
                "payout_amount": "5.00",
                "sort_order": 0,
            }
        ],
    }
    rejected = await authed.post("/api/v1/finance/commission-rules", json=over_scale_slab)
    assert rejected.status_code == 422

    incentive = await authed.post(
        "/api/v1/finance/incentive-plans",
        json={
            "name": f"Precision {uuid4().hex}",
            "effective_from": period.isoformat(),
            "effective_to": _month_end(period).isoformat(),
            "slabs": [
                {
                    "minimum_production": "0.00",
                    "maximum_production": "100.004",
                    "payout_amount": "5.00",
                    "sort_order": 0,
                }
            ],
        },
    )
    assert incentive.status_code == 422

    split_body = {
        **base,
        "recipients": [
            {**base["recipients"][0], "split_percent": "50.0000"},
            {
                **base["recipients"][0],
                "role_code": "manager_1",
                "role_name": "Manager 1",
                "recipient_source": "reporting_manager",
                "hierarchy_level": 1,
                "sort_order": 1,
                "split_percent": "50.0000",
            },
        ],
    }
    split_rule = await _create_rule(authed, split_body)
    async with app.state.session_factory() as session:
        recipient = (
            (
                await session.execute(
                    select(CommissionRuleRecipient)
                    .where(CommissionRuleRecipient.rule_id == UUID(split_rule["id"]))
                    .order_by(CommissionRuleRecipient.sort_order.desc())
                )
            )
            .scalars()
            .first()
        )
        assert recipient is not None
        recipient.split_percent = Decimal("49.9999")
        await session.commit()
    activation = await authed.post(f"/api/v1/finance/commission-rules/{split_rule['id']}/activate")
    assert activation.status_code == 422
    assert activation.json()["error"]["code"] == "FINANCE_SPLIT_TOTAL_INVALID"

    slab_body = {
        **base,
        "payout_mode": "independent_role_rate",
        "calculation_method": None,
        "fixed_amount": None,
        "recipients": [
            {
                **base["recipients"][0],
                "split_percent": None,
                "calculation_method": "slab",
                "fixed_amount": None,
                "slabs": [
                    {
                        "minimum_eligible": "0.00",
                        "maximum_eligible": "99.99",
                        "payout_amount": "5.00",
                        "sort_order": 0,
                    },
                    {
                        "minimum_eligible": "100.00",
                        "maximum_eligible": "200.00",
                        "payout_amount": "10.00",
                        "sort_order": 1,
                    },
                ],
            }
        ],
    }
    slab_rule = await _create_rule(authed, slab_body)
    async with app.state.session_factory() as session:
        first = (
            (
                await session.execute(
                    select(CommissionRuleSlab)
                    .where(CommissionRuleSlab.rule_id == UUID(slab_rule["id"]))
                    .order_by(CommissionRuleSlab.sort_order)
                )
            )
            .scalars()
            .first()
        )
        assert first is not None
        first.maximum_eligible = Decimal("100.00")
        await session.commit()
    activation = await authed.post(f"/api/v1/finance/commission-rules/{slab_rule['id']}/activate")
    assert activation.status_code == 422
    assert activation.json()["error"]["code"] == "FINANCE_SLAB_OVERLAP"

    valid_plan = await authed.post(
        "/api/v1/finance/incentive-plans",
        json={
            "name": f"Persisted {uuid4().hex}",
            "effective_from": period.isoformat(),
            "effective_to": _month_end(period).isoformat(),
            "slabs": [
                {
                    "minimum_production": "0.00",
                    "maximum_production": "99.99",
                    "payout_amount": "5.00",
                    "sort_order": 0,
                },
                {
                    "minimum_production": "100.00",
                    "maximum_production": "200.00",
                    "payout_amount": "10.00",
                    "sort_order": 1,
                },
            ],
        },
    )
    assert valid_plan.status_code == 200, valid_plan.text
    async with app.state.session_factory() as session:
        first = (
            (
                await session.execute(
                    select(IncentiveSlab)
                    .where(IncentiveSlab.plan_id == UUID(valid_plan.json()["id"]))
                    .order_by(IncentiveSlab.sort_order)
                )
            )
            .scalars()
            .first()
        )
        assert first is not None
        first.maximum_production = Decimal("100.00")
        await session.commit()
    activation = await authed.post(
        f"/api/v1/finance/incentive-plans/{valid_plan.json()['id']}/activate"
    )
    assert activation.status_code == 422
    assert activation.json()["error"]["code"] == "FINANCE_SLAB_OVERLAP"


@pytest.mark.asyncio
async def test_all_commission_modes_generate_from_persisted_effective_versions(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    cases = (
        (2, "fixed", {"fixed_amount": "10.00"}, "10.00"),
        (9, "percentage", {"percentage_rate": "1.500000"}, "15.00"),
        (
            17,
            "slab",
            {
                "slabs": [
                    {
                        "minimum_eligible": "0.00",
                        "maximum_eligible": "2000.00",
                        "payout_amount": "20.00",
                        "sort_order": 0,
                    }
                ]
            },
            "20.00",
        ),
        (
            25,
            "flat_percentage",
            {"flat_amount": "5.00", "percentage_rate": "1.000000"},
            "15.00",
        ),
    )
    applications: dict[str, tuple[str, str]] = {}
    for index, (day, method, fields, expected) in enumerate(cases):
        event_at = datetime(period.year, period.month, day, 12, tzinfo=UTC)
        application = await _booked_application(
            authed,
            bank_id=dib["id"],
            product_id=pf["id"],
            owner_id=owner["id"],
            event_at=event_at,
            booked_amount="1000.00",
        )
        applications[application["id"]] = (method, expected)
        body = _rule_request(dib["id"], pf["id"], period)
        start_day = 1 if index == 0 else day
        end_day = cases[index + 1][0] - 1 if index + 1 < len(cases) else _month_end(period).day
        body.update(
            {
                "effective_from": date(period.year, period.month, start_day).isoformat(),
                "effective_to": date(period.year, period.month, end_day).isoformat(),
                "calculation_method": method,
                "fixed_amount": fields.get("fixed_amount"),
                "percentage_rate": fields.get("percentage_rate"),
                "flat_amount": fields.get("flat_amount"),
                "slabs": fields.get("slabs", []),
            }
        )
        await _activate_created_rule(authed, body)

    generated = await authed.post(f"/api/v1/finance/periods/{period.isoformat()}/generate")
    assert generated.status_code == 200, generated.text
    payout = generated.json()["payouts"][0]
    drill = await authed.get(f"/api/v1/finance/payouts/{payout['id']}/components")
    commissions = {
        row["applicationId"]: row
        for row in drill.json()["items"]
        if row["componentType"] == "commission"
    }
    assert set(commissions) == set(applications)
    for application_id, (method, expected) in applications.items():
        assert commissions[application_id]["calculationMethod"] == method
        assert commissions[application_id]["eligibleAmount"] == "1000.00"
        assert commissions[application_id]["amount"] == expected


@pytest.mark.asyncio
async def test_historical_owner_level_two_and_largest_remainder_tie(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    event_at = datetime(period.year, period.month, 10, 12, tzinfo=UTC)
    changed_at = event_at + timedelta(days=2)
    manager_two = await _reporting_user(
        authed, scope="company", permissions=["Finance.View"], can_be_reporting_manager=True
    )
    manager_one = await _reporting_user(
        authed,
        scope="company",
        permissions=["Finance.View"],
        can_be_reporting_manager=True,
        manager_id=manager_two["id"],
    )
    owner_at_event = await _reporting_user(
        authed, scope="own", permissions=["Finance.View"], manager_id=manager_one["id"]
    )
    later_owner = await _reporting_user(authed, scope="own", permissions=["Finance.View"])
    application = await _booked_application(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
        owner_id=owner_at_event["id"],
        event_at=event_at,
    )
    async with app.state.session_factory() as session:
        history = (
            await session.execute(
                select(ApplicationOwnerHistory).where(
                    ApplicationOwnerHistory.application_id == UUID(application["id"]),
                    ApplicationOwnerHistory.effective_to.is_(None),
                )
            )
        ).scalar_one()
        history.effective_to = changed_at
        session.add(
            ApplicationOwnerHistory(
                id=new_uuid(),
                application_id=UUID(application["id"]),
                owner_id=UUID(later_owner["id"]),
                office_id=None,
                department_id=None,
                team_id=None,
                office_name=None,
                department_name=None,
                team_name=None,
                effective_from=changed_at,
                effective_to=None,
            )
        )
        row = await session.get(Application, UUID(application["id"]))
        assert row is not None
        row.case_owner_id = UUID(later_owner["id"])
        await session.commit()

    body = _rule_request(dib["id"], pf["id"], period, fixed_amount="0.01")
    body["recipients"] = [
        {
            **body["recipients"][0],
            "role_code": "manager_2",
            "role_name": "Manager 2",
            "recipient_source": "reporting_manager",
            "hierarchy_level": 2,
            "sort_order": 0,
            "split_percent": "50.0000",
        },
        {
            **body["recipients"][0],
            "sort_order": 1,
            "split_percent": "50.0000",
        },
    ]
    await _activate_created_rule(authed, body)
    generated = await authed.post(f"/api/v1/finance/periods/{period.isoformat()}/generate")
    assert generated.status_code == 200, generated.text
    payouts = {row["recipientId"]: row for row in generated.json()["payouts"]}
    assert payouts[manager_two["id"]]["commission"] == "0.01"
    assert payouts[owner_at_event["id"]]["commission"] == "0.00"
    assert later_owner["id"] not in payouts
    async with app.state.session_factory() as session:
        component = (
            await session.execute(
                select(FinanceComponent).where(
                    FinanceComponent.application_id == UUID(application["id"]),
                    FinanceComponent.recipient_id == UUID(manager_two["id"]),
                )
            )
        ).scalar_one()
        snapshot = component.attribution_snapshot
    assert snapshot is not None
    assert snapshot["hierarchyLevel"] == 2
    assert [row["userId"] for row in snapshot["chain"]] == [
        owner_at_event["id"],
        manager_one["id"],
        manager_two["id"],
    ]


@pytest.mark.asyncio
async def test_period_chronology_and_downstream_reopen_blocking(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    first = _unique_month()
    second = _next_month(first)

    later_first = await authed.post(f"/api/v1/finance/periods/{second.isoformat()}/generate")
    assert later_first.status_code == 200, later_first.text
    backdated = await authed.post(f"/api/v1/finance/periods/{first.isoformat()}/generate")
    assert backdated.status_code == 409
    assert backdated.json()["error"]["code"] == "FINANCE_PERIOD_BACKDATED"

    await authed.post(f"/api/v1/finance/periods/{second.isoformat()}/review")
    await authed.post(f"/api/v1/finance/periods/{second.isoformat()}/finalize")
    third = _next_month(second)
    generated_third = await authed.post(f"/api/v1/finance/periods/{third.isoformat()}/generate")
    assert generated_third.status_code == 200, generated_third.text
    blocked_review = await authed.post(f"/api/v1/finance/periods/{third.isoformat()}/review")
    assert blocked_review.status_code == 200
    blocked_finalize = await authed.post(f"/api/v1/finance/periods/{third.isoformat()}/finalize")
    assert blocked_finalize.status_code == 200
    third_before_blocked_reopen = await authed.get(
        f"/api/v1/finance/periods/{generated_third.json()['id']}"
    )
    assert third_before_blocked_reopen.status_code == 200

    for downstream_status in ("finalized",):
        response = await authed.post(
            f"/api/v1/finance/periods/{second.isoformat()}/reopen",
            json={"reason": f"Blocked by {downstream_status} downstream"},
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "FINANCE_PERIOD_HAS_DOWNSTREAM"

    third_after_blocked_reopen = await authed.get(
        f"/api/v1/finance/periods/{generated_third.json()['id']}"
    )
    assert third_after_blocked_reopen.status_code == 200
    assert third_after_blocked_reopen.json() == third_before_blocked_reopen.json()

    fourth = _next_month(third)
    generated_fourth = await authed.post(f"/api/v1/finance/periods/{fourth.isoformat()}/generate")
    assert generated_fourth.status_code == 200
    response = await authed.post(
        f"/api/v1/finance/periods/{third.isoformat()}/reopen",
        json={"reason": "Blocked by Draft downstream"},
    )
    assert response.status_code == 409
    await authed.post(f"/api/v1/finance/periods/{fourth.isoformat()}/review")
    response = await authed.post(
        f"/api/v1/finance/periods/{third.isoformat()}/reopen",
        json={"reason": "Blocked by Review downstream"},
    )
    assert response.status_code == 409

    await authed.post(f"/api/v1/finance/periods/{fourth.isoformat()}/finalize")
    reopened = await authed.post(
        f"/api/v1/finance/periods/{fourth.isoformat()}/reopen",
        json={"reason": "No downstream period exists"},
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "review"


@pytest.mark.asyncio
async def test_unfinished_prior_and_concurrent_period_generation_are_fail_closed(
    client: AsyncClient,
) -> None:
    authed, _owner = await owner_client(client)
    first = _unique_month()
    second = _next_month(first)
    generated = await authed.post(f"/api/v1/finance/periods/{first.isoformat()}/generate")
    assert generated.status_code == 200
    unfinished = await authed.post(f"/api/v1/finance/periods/{second.isoformat()}/generate")
    assert unfinished.status_code == 409
    assert unfinished.json()["error"]["code"] == "FINANCE_PREVIOUS_PERIOD_NOT_FINALIZED"
    await authed.post(f"/api/v1/finance/periods/{first.isoformat()}/review")

    finalize, generate = await asyncio.gather(
        authed.post(f"/api/v1/finance/periods/{first.isoformat()}/finalize"),
        authed.post(f"/api/v1/finance/periods/{second.isoformat()}/generate"),
    )
    assert finalize.status_code == 200
    assert generate.status_code in {200, 409}
    if generate.status_code == 409:
        assert generate.json()["error"]["code"] == "FINANCE_PREVIOUS_PERIOD_NOT_FINALIZED"
        generate = await authed.post(f"/api/v1/finance/periods/{second.isoformat()}/generate")
        assert generate.status_code == 200

    third = _next_month(second)
    await authed.post(f"/api/v1/finance/periods/{second.isoformat()}/review")
    await authed.post(f"/api/v1/finance/periods/{second.isoformat()}/finalize")
    first_try, second_try = await asyncio.gather(
        authed.post(f"/api/v1/finance/periods/{third.isoformat()}/generate"),
        authed.post(f"/api/v1/finance/periods/{third.isoformat()}/generate"),
    )
    assert sorted((first_try.status_code, second_try.status_code)) == [200, 409]
    loser = first_try if first_try.status_code == 409 else second_try
    assert loser.json()["error"]["code"] == "FINANCE_PERIOD_ALREADY_GENERATED"


@pytest.mark.asyncio
async def test_concurrent_activation_and_finalization_mutation_are_serialized(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    application = await _booked_application(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
        owner_id=owner["id"],
        event_at=datetime(period.year, period.month, 8, 12, tzinfo=UTC),
    )
    body = _rule_request(dib["id"], pf["id"], period, fixed_amount="10.00")
    first = await _create_rule(authed, body)
    second = await _create_rule(authed, body)
    first_activation, second_activation = await asyncio.gather(
        authed.post(f"/api/v1/finance/commission-rules/{first['id']}/activate"),
        authed.post(f"/api/v1/finance/commission-rules/{second['id']}/activate"),
    )
    assert sorted((first_activation.status_code, second_activation.status_code)) == [200, 409]
    loser = first_activation if first_activation.status_code == 409 else second_activation
    assert loser.json()["error"]["code"] == "COMMISSION_RULE_OVERLAP"

    generated = await authed.post(f"/api/v1/finance/periods/{period.isoformat()}/generate")
    assert generated.status_code == 200, generated.text
    reviewed = await authed.post(f"/api/v1/finance/periods/{period.isoformat()}/review")
    assert reviewed.status_code == 200
    adjustment, finalized = await asyncio.gather(
        authed.post(
            f"/api/v1/finance/periods/{period.isoformat()}/adjustments",
            json={
                "application_id": application["id"],
                "recipient_id": owner["id"],
                "amount": "1.00",
                "reason": "Concurrent authorized correction",
            },
        ),
        authed.post(f"/api/v1/finance/periods/{period.isoformat()}/finalize"),
    )
    assert finalized.status_code == 200
    assert adjustment.status_code in {200, 409}
    if adjustment.status_code == 409:
        assert adjustment.json()["error"]["code"] == "FINANCE_PERIOD_LOCKED"
    listed = await authed.get("/api/v1/finance/periods")
    row = next(item for item in listed.json()["items"] if item["periodMonth"] == period.isoformat())
    assert row["status"] == "finalized"
    expected_adjustment = "1.00" if adjustment.status_code == 200 else "0.00"
    assert row["payouts"][0]["adjustment"] == expected_adjustment


@pytest.mark.asyncio
async def test_finance_exports_escape_spreadsheet_and_print_injection(client: AsyncClient) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    await _booked_application(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
        owner_id=owner["id"],
        event_at=datetime(period.year, period.month, 8, 12, tzinfo=UTC),
    )
    await _activate_rule(authed, dib["id"], pf["id"], period)
    generated = await authed.post(f"/api/v1/finance/periods/{period.isoformat()}/generate")
    assert generated.status_code == 200, generated.text
    payload = '=HYPERLINK("https://invalid.example","<script>alert(1)</script>")'
    async with app.state.session_factory() as session:
        user = await session.get(User, UUID(owner["id"]))
        assert user is not None
        user.full_name = payload
        await session.commit()

    excel = await authed.post(
        "/api/v1/finance/export",
        json={"format": "xlsx", "period_month": period.isoformat(), "recipient_id": owner["id"]},
    )
    assert excel.status_code == 200, excel.text
    workbook = load_workbook(BytesIO(excel.content), read_only=True, data_only=False)
    assert workbook["Finance Statement"]["B2"].value == f"'{payload}"

    printed = await authed.post(
        "/api/v1/finance/export",
        json={"format": "print", "period_month": period.isoformat(), "recipient_id": owner["id"]},
    )
    assert printed.status_code == 200
    assert "<script>alert(1)</script>" not in printed.text
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in printed.text


@pytest.mark.asyncio
@pytest.mark.parametrize("source_level", [0, 1, 2])
async def test_ambiguous_historical_attribution_is_controlled_and_atomic(
    client: AsyncClient, source_level: int
) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    event_at = datetime(period.year, period.month, 12, 12, tzinfo=UTC)
    manager_two = await _reporting_user(
        authed, scope="company", permissions=["Finance.View"], can_be_reporting_manager=True
    )
    manager_one = await _reporting_user(
        authed,
        scope="company",
        permissions=["Finance.View"],
        can_be_reporting_manager=True,
        manager_id=manager_two["id"] if source_level == 2 else None,
    )
    case_owner = await _reporting_user(
        authed,
        scope="own",
        permissions=["Finance.View"],
        manager_id=manager_one["id"] if source_level else None,
    )
    application = await _booked_application(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
        owner_id=case_owner["id"] if source_level else owner["id"],
        event_at=event_at,
    )
    async with app.state.session_factory() as session:
        if source_level == 0:
            original = (
                (
                    await session.execute(
                        select(ApplicationOwnerHistory).where(
                            ApplicationOwnerHistory.application_id == UUID(application["id"])
                        )
                    )
                )
                .scalars()
                .first()
            )
            assert original is not None
            session.add(
                ApplicationOwnerHistory(
                    id=new_uuid(),
                    application_id=UUID(application["id"]),
                    owner_id=original.owner_id,
                    office_id=original.office_id,
                    department_id=original.department_id,
                    team_id=original.team_id,
                    office_name=original.office_name,
                    department_name=original.department_name,
                    team_name=original.team_name,
                    effective_from=event_at - timedelta(days=1),
                    effective_to=event_at + timedelta(days=1),
                )
            )
        else:
            user_id = UUID(case_owner["id"] if source_level == 1 else manager_one["id"])
            existing = (
                (
                    await session.execute(
                        select(UserAssignmentHistory).where(
                            UserAssignmentHistory.user_id == user_id,
                            UserAssignmentHistory.field == AssignmentField.REPORTING_MANAGER,
                        )
                    )
                )
                .scalars()
                .first()
            )
            assert existing is not None
            session.add(
                UserAssignmentHistory(
                    id=new_uuid(),
                    user_id=user_id,
                    field=AssignmentField.REPORTING_MANAGER,
                    value_id=existing.value_id,
                    value_label=existing.value_label,
                    effective_from=event_at - timedelta(days=1),
                    effective_to=event_at + timedelta(days=1),
                )
            )
        await session.commit()

    async with app.state.session_factory() as session:
        audit_count_before = await session.scalar(
            select(func.count())
            .select_from(AuditEvent)
            .where(AuditEvent.action == "finance.period.generate")
        )
    await _activate_rule(
        authed,
        dib["id"],
        pf["id"],
        period,
        source="case_owner" if source_level == 0 else "reporting_manager",
        level=source_level or None,
    )
    response = await authed.post(f"/api/v1/finance/periods/{period.isoformat()}/generate")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "FINANCE_RECIPIENT_UNRESOLVED"
    assert error["details"][0]["applicationId"] == application["id"]
    assert error["details"][0]["matchCount"] == 2
    if source_level:
        assert error["details"][0]["hierarchyLevel"] == source_level
    async with app.state.session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(FinancePayoutPeriod)) == 0
        assert await session.scalar(select(func.count()).select_from(FinanceComponent)) == 0
        assert await session.scalar(select(func.count()).select_from(FinancePayout)) == 0
        assert await session.scalar(select(func.count()).select_from(FinancePeriodTransition)) == 0
        audit_count_after = await session.scalar(
            select(func.count())
            .select_from(AuditEvent)
            .where(AuditEvent.action == "finance.period.generate")
        )
        assert audit_count_after == audit_count_before


async def _assert_integrity_error(session, statement: str, params: dict[str, object]) -> None:
    savepoint = await session.begin_nested()
    with pytest.raises(IntegrityError):
        await session.execute(text(statement), params)
    await savepoint.rollback()


@pytest.mark.asyncio
async def test_0014_database_constraints_reject_invalid_finance_states(
    client: AsyncClient,
) -> None:
    authed, owner = await owner_client(client)
    dib, _eib, pf, _cc = await _catalog(authed)
    period = _unique_month()
    await _booked_application(
        authed,
        bank_id=dib["id"],
        product_id=pf["id"],
        owner_id=owner["id"],
        event_at=datetime(period.year, period.month, 8, 12, tzinfo=UTC),
    )
    rule = await _activate_rule(authed, dib["id"], pf["id"], period)
    generated = await authed.post(f"/api/v1/finance/periods/{period.isoformat()}/generate")
    assert generated.status_code == 200, generated.text
    payout = generated.json()["payouts"][0]
    drill = await authed.get(f"/api/v1/finance/payouts/{payout['id']}/components")
    component_id = drill.json()["items"][0]["id"]

    async with app.state.session_factory() as session:
        await _assert_integrity_error(
            session,
            "UPDATE commission_rules SET status = 'corrupt' WHERE id = :id",
            {"id": UUID(rule["id"])},
        )
        await _assert_integrity_error(
            session,
            "UPDATE commission_rules SET payout_mode = 'corrupt' WHERE id = :id",
            {"id": UUID(rule["id"])},
        )
        await _assert_integrity_error(
            session,
            "UPDATE finance_payout_periods SET period_month = period_month + 1 WHERE id = :id",
            {"id": UUID(generated.json()["id"])},
        )
        await _assert_integrity_error(
            session,
            "UPDATE finance_components SET component_type = 'corrupt' WHERE id = :id",
            {"id": UUID(component_id)},
        )
        await _assert_integrity_error(
            session,
            "UPDATE finance_components SET amount = -1.00 WHERE id = :id",
            {"id": UUID(component_id)},
        )
        plan = IncentivePlan(
            id=new_uuid(),
            name=f"Invalid {uuid4().hex}",
            version=1,
            effective_from=period,
            effective_to=period,
            status="corrupt",
            created_at=datetime.now(UTC),
            created_by_id=UUID(owner["id"]),
            activated_at=None,
            activated_by_id=None,
        )
        session.add(plan)
        with pytest.raises(IntegrityError):
            await session.flush()
        await session.rollback()
