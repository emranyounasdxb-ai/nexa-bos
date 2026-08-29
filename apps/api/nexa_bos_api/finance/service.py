from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.applications.models import Application, ApplicationOwnerHistory
from nexa_bos_api.catalog.models import Bank, BankProduct, Product
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.finance.calc import (
    ZERO,
    calculate_component,
    largest_remainder_allocate,
    money,
    ranges_overlap,
    round_money,
    single_matching_slab,
)
from nexa_bos_api.finance.enums import (
    CalculationMethod,
    ConfigurationStatus,
    EligibilityMilestone,
    FinanceComponentType,
    PayoutPeriodStatus,
    RecipientPayoutMode,
    RecipientSource,
)
from nexa_bos_api.finance.models import (
    CommissionRule,
    CommissionRuleRecipient,
    CommissionRuleSlab,
    FinanceComponent,
    FinancePayout,
    FinancePayoutPeriod,
    FinancePeriodTransition,
    IncentivePlan,
    IncentiveSlab,
)
from nexa_bos_api.finance.schemas import (
    AdjustmentCreateRequest,
    ClawbackCreateRequest,
    CommissionRuleCreateRequest,
    CommissionSlabInput,
    IncentivePlanCreateRequest,
)
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AssignmentField, MasterStatus, VisibilityScope
from nexa_bos_api.identity.models import Permission, User, UserAssignmentHistory, new_uuid
from nexa_bos_api.identity.permissions import FINANCE_MANAGE_COMMISSION_RULES
from nexa_bos_api.reporting.scope import ReportingAccess, load_reporting_access


def utcnow() -> datetime:
    return datetime.now(UTC)


def month_start(value: date) -> date:
    return date(value.year, value.month, 1)


def month_end(value: date) -> date:
    return date(value.year, value.month, monthrange(value.year, value.month)[1])


def _next_month(value: date) -> date:
    return date(value.year + 1, 1, 1) if value.month == 12 else date(value.year, value.month + 1, 1)


def _date_range_valid(start: date, end: date | None) -> None:
    if end is not None and end < start:
        raise AppError(
            status_code=422,
            code="FINANCE_DATE_RANGE_INVALID",
            message="Effective To cannot be before Effective From",
        )


def _validate_slab_ranges(
    slabs: list[CommissionSlabInput] | list[object],
    *,
    minimum_attr: str = "minimum_eligible",
    maximum_attr: str = "maximum_eligible",
) -> None:
    if not slabs:
        raise AppError(
            status_code=422,
            code="FINANCE_SLABS_REQUIRED",
            message="At least one slab is required",
        )
    orders: set[int] = set()
    ranges: list[tuple[Decimal, Decimal | None]] = []
    for slab in slabs:
        minimum = Decimal(getattr(slab, minimum_attr))
        maximum_value = getattr(slab, maximum_attr)
        maximum = Decimal(maximum_value) if maximum_value is not None else None
        sort_order = int(slab.sort_order)
        if sort_order in orders:
            raise AppError(
                status_code=422,
                code="FINANCE_SLAB_SORT_DUPLICATE",
                message="Slab sort order must be unique",
            )
        orders.add(sort_order)
        if maximum is not None and maximum < minimum:
            raise AppError(
                status_code=422,
                code="FINANCE_SLAB_RANGE_INVALID",
                message="Slab maximum cannot be below its minimum",
            )
        if any(ranges_overlap(minimum, maximum, low, high) for low, high in ranges):
            raise AppError(
                status_code=422,
                code="FINANCE_SLAB_OVERLAP",
                message="Overlapping or ambiguous slabs are not allowed",
            )
        ranges.append((minimum, maximum))


def _validate_method(
    *,
    method: str | None,
    fixed_amount: Decimal | None,
    percentage_rate: Decimal | None,
    flat_amount: Decimal | None,
    slabs: list[CommissionSlabInput],
) -> None:
    if method is None:
        raise AppError(
            status_code=422,
            code="FINANCE_CALCULATION_METHOD_REQUIRED",
            message="A calculation method is required",
        )
    if method == CalculationMethod.FIXED:
        valid = (
            fixed_amount is not None
            and percentage_rate is None
            and flat_amount is None
            and not slabs
        )
    elif method == CalculationMethod.PERCENTAGE:
        valid = (
            fixed_amount is None
            and percentage_rate is not None
            and flat_amount is None
            and not slabs
        )
    elif method == CalculationMethod.FLAT_PERCENTAGE:
        valid = (
            fixed_amount is None
            and percentage_rate is not None
            and flat_amount is not None
            and not slabs
        )
    elif method == CalculationMethod.SLAB:
        valid = (
            fixed_amount is None and percentage_rate is None and flat_amount is None and bool(slabs)
        )
        if valid:
            _validate_slab_ranges(slabs)
    else:
        valid = False
    if not valid:
        raise AppError(
            status_code=422,
            code="FINANCE_CALCULATION_CONFIG_INVALID",
            message="Calculation fields do not match the selected calculation method",
        )


def _validate_rule_payload(payload: CommissionRuleCreateRequest) -> None:
    _date_range_valid(payload.effective_from, payload.effective_to)
    role_codes: set[str] = set()
    sort_orders: set[int] = set()
    if payload.payout_mode == RecipientPayoutMode.PERCENTAGE_SPLIT:
        _validate_method(
            method=payload.calculation_method,
            fixed_amount=payload.fixed_amount,
            percentage_rate=payload.percentage_rate,
            flat_amount=payload.flat_amount,
            slabs=payload.slabs,
        )
        total = Decimal(0)
        for recipient in payload.recipients:
            if (
                recipient.split_percent is None
                or recipient.calculation_method is not None
                or recipient.fixed_amount is not None
                or recipient.percentage_rate is not None
                or recipient.flat_amount is not None
                or recipient.slabs
            ):
                raise AppError(
                    status_code=422,
                    code="FINANCE_PAYOUT_MODE_MIXED",
                    message="Percentage Split cannot include independent role rates",
                )
            total += recipient.split_percent
        if total != Decimal("100"):
            raise AppError(
                status_code=422,
                code="FINANCE_SPLIT_TOTAL_INVALID",
                message="Percentage Split recipients must total exactly 100%",
            )
    else:
        if (
            any(
                value is not None
                for value in (
                    payload.calculation_method,
                    payload.fixed_amount,
                    payload.percentage_rate,
                    payload.flat_amount,
                )
            )
            or payload.slabs
        ):
            raise AppError(
                status_code=422,
                code="FINANCE_PAYOUT_MODE_MIXED",
                message="Independent Role Rate cannot include a shared calculation",
            )
        for recipient in payload.recipients:
            if recipient.split_percent is not None:
                raise AppError(
                    status_code=422,
                    code="FINANCE_PAYOUT_MODE_MIXED",
                    message="Independent Role Rate cannot include percentage splits",
                )
            _validate_method(
                method=recipient.calculation_method,
                fixed_amount=recipient.fixed_amount,
                percentage_rate=recipient.percentage_rate,
                flat_amount=recipient.flat_amount,
                slabs=recipient.slabs,
            )
    for recipient in payload.recipients:
        if (
            recipient.recipient_source == RecipientSource.CASE_OWNER
            and recipient.hierarchy_level is not None
        ) or (
            recipient.recipient_source == RecipientSource.REPORTING_MANAGER
            and recipient.hierarchy_level is None
        ):
            raise AppError(
                status_code=422,
                code="FINANCE_RECIPIENT_SOURCE_INVALID",
                message=(
                    "CASE_OWNER cannot have a hierarchy level and REPORTING_MANAGER requires one"
                ),
            )
        role_code = recipient.role_code.strip().lower()
        if not recipient.role_name.strip():
            raise AppError(
                status_code=422,
                code="FINANCE_RECIPIENT_LABEL_REQUIRED",
                message="Recipient display label is required",
            )
        if role_code in role_codes or recipient.sort_order in sort_orders:
            raise AppError(
                status_code=422,
                code="FINANCE_RECIPIENT_DUPLICATE",
                message="Recipient role codes and sort order values must be unique",
            )
        role_codes.add(role_code)
        sort_orders.add(recipient.sort_order)


async def _bank_product(
    session: AsyncSession, bank_id: UUID, product_id: UUID, *, lock: bool = False
) -> tuple[Bank, Product, BankProduct]:
    bank = await session.get(Bank, bank_id)
    product = await session.get(Product, product_id)
    stmt = select(BankProduct).where(
        BankProduct.bank_id == bank_id, BankProduct.product_id == product_id
    )
    if lock:
        stmt = stmt.with_for_update()
    mapping = (await session.execute(stmt)).scalar_one_or_none()
    if bank is None or product is None or mapping is None:
        raise AppError(
            status_code=404,
            code="BANK_PRODUCT_NOT_FOUND",
            message="The configured Bank and Product mapping was not found",
        )
    return bank, product, mapping


def _rule_options():
    return (
        selectinload(CommissionRule.recipients).selectinload(CommissionRuleRecipient.slabs),
        selectinload(CommissionRule.slabs),
    )


async def _get_rule(session: AsyncSession, rule_id: UUID, *, lock: bool = False) -> CommissionRule:
    stmt = select(CommissionRule).options(*_rule_options()).where(CommissionRule.id == rule_id)
    if lock:
        stmt = stmt.with_for_update()
    rule = (await session.execute(stmt)).scalar_one_or_none()
    if rule is None:
        raise AppError(status_code=404, code="COMMISSION_RULE_NOT_FOUND", message="Rule not found")
    return rule


def _slab_payload(row: CommissionRuleSlab) -> dict[str, object]:
    return {
        "id": str(row.id),
        "minimumEligible": money(row.minimum_eligible),
        "maximumEligible": money(row.maximum_eligible)
        if row.maximum_eligible is not None
        else None,
        "payoutAmount": money(row.payout_amount),
        "sortOrder": row.sort_order,
    }


async def serialize_rule(session: AsyncSession, rule: CommissionRule) -> dict[str, object]:
    bank = await session.get(Bank, rule.bank_id)
    product = await session.get(Product, rule.product_id)
    return {
        "id": str(rule.id),
        "bankId": str(rule.bank_id),
        "bankName": bank.name if bank else None,
        "productId": str(rule.product_id),
        "productName": product.name if product else None,
        "eligibilityMilestone": rule.eligibility_milestone,
        "version": rule.version,
        "effectiveFrom": rule.effective_from.isoformat(),
        "effectiveTo": rule.effective_to.isoformat() if rule.effective_to else None,
        "status": rule.status,
        "payoutMode": rule.payout_mode,
        "calculationMethod": rule.calculation_method,
        "fixedAmount": money(rule.fixed_amount) if rule.fixed_amount is not None else None,
        "percentageRate": str(rule.percentage_rate) if rule.percentage_rate is not None else None,
        "flatAmount": money(rule.flat_amount) if rule.flat_amount is not None else None,
        "slabs": [_slab_payload(row) for row in rule.slabs if row.recipient_id is None],
        "recipients": [
            {
                "id": str(row.id),
                "roleCode": row.role_code,
                "roleName": row.role_name,
                "recipientSource": row.recipient_source,
                "hierarchyLevel": row.hierarchy_level,
                "sortOrder": row.sort_order,
                "splitPercent": str(row.split_percent) if row.split_percent is not None else None,
                "calculationMethod": row.calculation_method,
                "fixedAmount": money(row.fixed_amount) if row.fixed_amount is not None else None,
                "percentageRate": (
                    str(row.percentage_rate) if row.percentage_rate is not None else None
                ),
                "flatAmount": money(row.flat_amount) if row.flat_amount is not None else None,
                "slabs": [_slab_payload(slab) for slab in row.slabs],
            }
            for row in rule.recipients
        ],
        "createdAt": rule.created_at.isoformat(),
        "activatedAt": rule.activated_at.isoformat() if rule.activated_at else None,
    }


async def create_rule(
    session: AsyncSession, actor: User, payload: CommissionRuleCreateRequest
) -> dict[str, object]:
    _validate_rule_payload(payload)
    await _bank_product(session, payload.bank_id, payload.product_id)
    version = (
        await session.scalar(
            select(func.max(CommissionRule.version)).where(
                CommissionRule.bank_id == payload.bank_id,
                CommissionRule.product_id == payload.product_id,
                CommissionRule.eligibility_milestone == payload.eligibility_milestone.value,
            )
        )
        or 0
    ) + 1
    now = utcnow()
    rule = CommissionRule(
        id=new_uuid(),
        bank_id=payload.bank_id,
        product_id=payload.product_id,
        eligibility_milestone=payload.eligibility_milestone.value,
        version=version,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        status=ConfigurationStatus.DRAFT,
        payout_mode=payload.payout_mode.value,
        calculation_method=payload.calculation_method and payload.calculation_method.value,
        fixed_amount=(
            round_money(payload.fixed_amount) if payload.fixed_amount is not None else None
        ),
        percentage_rate=payload.percentage_rate,
        flat_amount=(round_money(payload.flat_amount) if payload.flat_amount is not None else None),
        created_at=now,
        created_by_id=actor.id,
    )
    session.add(rule)
    for item in payload.recipients:
        recipient = CommissionRuleRecipient(
            id=new_uuid(),
            rule_id=rule.id,
            role_code=item.role_code.strip().lower(),
            role_name=item.role_name.strip(),
            recipient_source=item.recipient_source.value,
            hierarchy_level=item.hierarchy_level,
            sort_order=item.sort_order,
            split_percent=item.split_percent,
            calculation_method=item.calculation_method and item.calculation_method.value,
            fixed_amount=(
                round_money(item.fixed_amount) if item.fixed_amount is not None else None
            ),
            percentage_rate=item.percentage_rate,
            flat_amount=(round_money(item.flat_amount) if item.flat_amount is not None else None),
        )
        session.add(recipient)
        for slab in item.slabs:
            session.add(
                CommissionRuleSlab(
                    id=new_uuid(),
                    rule_id=rule.id,
                    recipient_id=recipient.id,
                    minimum_eligible=round_money(slab.minimum_eligible),
                    maximum_eligible=(
                        round_money(slab.maximum_eligible)
                        if slab.maximum_eligible is not None
                        else None
                    ),
                    payout_amount=round_money(slab.payout_amount),
                    sort_order=slab.sort_order,
                )
            )
    for slab in payload.slabs:
        session.add(
            CommissionRuleSlab(
                id=new_uuid(),
                rule_id=rule.id,
                recipient_id=None,
                minimum_eligible=round_money(slab.minimum_eligible),
                maximum_eligible=(
                    round_money(slab.maximum_eligible)
                    if slab.maximum_eligible is not None
                    else None
                ),
                payout_amount=round_money(slab.payout_amount),
                sort_order=slab.sort_order,
            )
        )
    await record_audit(
        session,
        action="finance.rule.create",
        entity_type="commission_rule",
        entity_id=str(rule.id),
        actor_id=actor.id,
        new_values={
            "bankId": str(rule.bank_id),
            "productId": str(rule.product_id),
            "eligibilityMilestone": rule.eligibility_milestone,
            "version": version,
            "payoutMode": rule.payout_mode,
        },
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="COMMISSION_RULE_VERSION_CONFLICT",
            message="A concurrent rule version already exists",
        ) from exc
    return await get_rule(session, rule.id)


async def list_rules(session: AsyncSession) -> dict[str, object]:
    rows = list(
        (
            await session.execute(
                select(CommissionRule)
                .options(*_rule_options())
                .order_by(CommissionRule.created_at.desc())
            )
        ).scalars()
    )
    return {"items": [await serialize_rule(session, row) for row in rows]}


async def get_rule(session: AsyncSession, rule_id: UUID) -> dict[str, object]:
    return await serialize_rule(session, await _get_rule(session, rule_id))


async def set_rule_status(
    session: AsyncSession, actor: User, rule_id: UUID, *, active: bool
) -> dict[str, object]:
    rule = await _get_rule(session, rule_id, lock=True)
    target = ConfigurationStatus.ACTIVE if active else ConfigurationStatus.INACTIVE
    if rule.status == target:
        return await serialize_rule(session, rule)
    if active:
        await _bank_product(session, rule.bank_id, rule.product_id, lock=True)
        end = rule.effective_to or date.max
        conflict = (
            await session.execute(
                select(CommissionRule).where(
                    CommissionRule.id != rule.id,
                    CommissionRule.bank_id == rule.bank_id,
                    CommissionRule.product_id == rule.product_id,
                    CommissionRule.eligibility_milestone == rule.eligibility_milestone,
                    CommissionRule.status == ConfigurationStatus.ACTIVE,
                    CommissionRule.effective_from <= end,
                    or_(
                        CommissionRule.effective_to.is_(None),
                        CommissionRule.effective_to >= rule.effective_from,
                    ),
                )
            )
        ).scalar_one_or_none()
        if conflict is not None:
            raise AppError(
                status_code=409,
                code="COMMISSION_RULE_OVERLAP",
                message="An active rule overlaps this Bank, Product, milestone, and date range",
            )
        rule.activated_at = utcnow()
        rule.activated_by_id = actor.id
    old = rule.status
    rule.status = target
    await record_audit(
        session,
        action="finance.rule.activate" if active else "finance.rule.deactivate",
        entity_type="commission_rule",
        entity_id=str(rule.id),
        actor_id=actor.id,
        old_values={"status": old},
        new_values={"status": rule.status},
    )
    await session.commit()
    return await get_rule(session, rule.id)


def _plan_options():
    return (selectinload(IncentivePlan.slabs),)


async def _get_plan(session: AsyncSession, plan_id: UUID, *, lock: bool = False) -> IncentivePlan:
    stmt = select(IncentivePlan).options(*_plan_options()).where(IncentivePlan.id == plan_id)
    if lock:
        stmt = stmt.with_for_update()
    plan = (await session.execute(stmt)).scalar_one_or_none()
    if plan is None:
        raise AppError(status_code=404, code="INCENTIVE_PLAN_NOT_FOUND", message="Plan not found")
    return plan


def serialize_plan(plan: IncentivePlan) -> dict[str, object]:
    return {
        "id": str(plan.id),
        "name": plan.name,
        "version": plan.version,
        "effectiveFrom": plan.effective_from.isoformat(),
        "effectiveTo": plan.effective_to.isoformat() if plan.effective_to else None,
        "status": plan.status,
        "slabs": [
            {
                "id": str(row.id),
                "minimumProduction": money(row.minimum_production),
                "maximumProduction": (
                    money(row.maximum_production) if row.maximum_production is not None else None
                ),
                "payoutAmount": money(row.payout_amount),
                "sortOrder": row.sort_order,
            }
            for row in plan.slabs
        ],
        "createdAt": plan.created_at.isoformat(),
        "activatedAt": plan.activated_at.isoformat() if plan.activated_at else None,
    }


async def create_incentive_plan(
    session: AsyncSession, actor: User, payload: IncentivePlanCreateRequest
) -> dict[str, object]:
    _date_range_valid(payload.effective_from, payload.effective_to)
    _validate_slab_ranges(
        list(payload.slabs),
        minimum_attr="minimum_production",
        maximum_attr="maximum_production",
    )
    name = payload.name.strip()
    if not name:
        raise AppError(
            status_code=422,
            code="INCENTIVE_PLAN_NAME_REQUIRED",
            message="Incentive plan name is required",
        )
    version = (
        await session.scalar(
            select(func.max(IncentivePlan.version)).where(IncentivePlan.name == name)
        )
        or 0
    ) + 1
    plan = IncentivePlan(
        id=new_uuid(),
        name=name,
        version=version,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        status=ConfigurationStatus.DRAFT,
        created_at=utcnow(),
        created_by_id=actor.id,
    )
    session.add(plan)
    for item in payload.slabs:
        session.add(
            IncentiveSlab(
                id=new_uuid(),
                plan_id=plan.id,
                minimum_production=round_money(item.minimum_production),
                maximum_production=(
                    round_money(item.maximum_production)
                    if item.maximum_production is not None
                    else None
                ),
                payout_amount=round_money(item.payout_amount),
                sort_order=item.sort_order,
            )
        )
    await record_audit(
        session,
        action="finance.incentive_plan.create",
        entity_type="incentive_plan",
        entity_id=str(plan.id),
        actor_id=actor.id,
        new_values={"name": name, "version": version},
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="INCENTIVE_PLAN_VERSION_CONFLICT",
            message="A concurrent incentive plan version already exists",
        ) from exc
    return serialize_plan(await _get_plan(session, plan.id))


async def list_incentive_plans(session: AsyncSession) -> dict[str, object]:
    rows = list(
        (
            await session.execute(
                select(IncentivePlan)
                .options(*_plan_options())
                .order_by(IncentivePlan.created_at.desc())
            )
        ).scalars()
    )
    return {"items": [serialize_plan(row) for row in rows]}


async def set_incentive_plan_status(
    session: AsyncSession, actor: User, plan_id: UUID, *, active: bool
) -> dict[str, object]:
    plan = await _get_plan(session, plan_id, lock=True)
    target = ConfigurationStatus.ACTIVE if active else ConfigurationStatus.INACTIVE
    if plan.status == target:
        return serialize_plan(plan)
    if active:
        await session.execute(
            select(Permission)
            .where(Permission.code == FINANCE_MANAGE_COMMISSION_RULES)
            .with_for_update()
        )
        end = plan.effective_to or date.max
        conflict = (
            await session.execute(
                select(IncentivePlan).where(
                    IncentivePlan.id != plan.id,
                    IncentivePlan.status == ConfigurationStatus.ACTIVE,
                    IncentivePlan.effective_from <= end,
                    or_(
                        IncentivePlan.effective_to.is_(None),
                        IncentivePlan.effective_to >= plan.effective_from,
                    ),
                )
            )
        ).scalar_one_or_none()
        if conflict is not None:
            raise AppError(
                status_code=409,
                code="INCENTIVE_PLAN_OVERLAP",
                message="An active incentive plan overlaps this effective date range",
            )
        plan.activated_at = utcnow()
        plan.activated_by_id = actor.id
    old = plan.status
    plan.status = target
    await record_audit(
        session,
        action="finance.incentive_plan.activate" if active else "finance.incentive_plan.deactivate",
        entity_type="incentive_plan",
        entity_id=str(plan.id),
        actor_id=actor.id,
        old_values={"status": old},
        new_values={"status": plan.status},
    )
    await session.commit()
    return serialize_plan(await _get_plan(session, plan.id))


async def finance_options(session: AsyncSession) -> dict[str, object]:
    banks = list((await session.execute(select(Bank).order_by(Bank.name))).scalars())
    products = list((await session.execute(select(Product).order_by(Product.name))).scalars())
    return {
        "currency": "AED",
        "banks": [
            {"id": str(row.id), "code": row.code, "name": row.name}
            for row in banks
            if row.status == MasterStatus.ACTIVE
        ],
        "products": [
            {"id": str(row.id), "code": row.code, "name": row.name}
            for row in products
            if row.status == MasterStatus.ACTIVE
        ],
        "eligibilityMilestones": [item.value for item in EligibilityMilestone],
        "calculationMethods": [item.value for item in CalculationMethod],
        "payoutModes": [item.value for item in RecipientPayoutMode],
        "rounding": {
            "precision": 2,
            "mode": "ROUND_HALF_UP",
            "splitAllocation": "largest_remainder_sort_order_tiebreak",
        },
    }


@dataclass(frozen=True)
class ResolvedRecipient:
    user_id: UUID
    source: str
    hierarchy_level: int | None
    snapshot: dict[str, object]


@dataclass(frozen=True)
class PreparedComponent:
    application_id: UUID | None
    recipient_id: UUID
    component_type: str
    amount: Decimal
    eligible_amount: Decimal | None
    eligibility_milestone: str | None
    eligibility_event_at: datetime | None
    commission_rule_id: UUID | None
    incentive_plan_id: UUID | None
    role_code: str | None
    role_name: str | None
    attribution_snapshot: dict[str, object] | None
    calculation_method: str | None
    calculation_evidence: dict[str, object] | None


async def _owner_history_at(
    session: AsyncSession, application: Application, at: datetime
) -> ApplicationOwnerHistory:
    row = (
        await session.execute(
            select(ApplicationOwnerHistory)
            .where(
                ApplicationOwnerHistory.application_id == application.id,
                ApplicationOwnerHistory.effective_from <= at,
                or_(
                    ApplicationOwnerHistory.effective_to.is_(None),
                    ApplicationOwnerHistory.effective_to > at,
                ),
            )
            .order_by(ApplicationOwnerHistory.effective_from.desc())
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError(
            status_code=422,
            code="FINANCE_RECIPIENT_UNRESOLVED",
            message=(
                f"Application {application.application_code} has no authoritative Case Owner "
                "history at the eligibility event"
            ),
            details=[
                {
                    "applicationId": str(application.id),
                    "applicationCode": application.application_code,
                    "source": RecipientSource.CASE_OWNER,
                    "eligibilityEventAt": at.isoformat(),
                }
            ],
        )
    return row


async def _assignment_at(
    session: AsyncSession, user_id: UUID, field: AssignmentField, at: datetime
) -> UserAssignmentHistory | None:
    return (
        await session.execute(
            select(UserAssignmentHistory)
            .where(
                UserAssignmentHistory.user_id == user_id,
                UserAssignmentHistory.field == field,
                UserAssignmentHistory.effective_from <= at,
                or_(
                    UserAssignmentHistory.effective_to.is_(None),
                    UserAssignmentHistory.effective_to > at,
                ),
            )
            .order_by(UserAssignmentHistory.effective_from.desc())
        )
    ).scalar_one_or_none()


async def _recipient_org_snapshot(
    session: AsyncSession, user_id: UUID, at: datetime
) -> dict[str, object]:
    fields = (
        AssignmentField.OFFICE,
        AssignmentField.DEPARTMENT,
        AssignmentField.TEAM,
        AssignmentField.DESIGNATION,
        AssignmentField.REPORTING_MANAGER,
    )
    snapshot: dict[str, object] = {}
    for field in fields:
        row = await _assignment_at(session, user_id, field, at)
        snapshot[field.value] = (
            {
                "historyId": str(row.id),
                "valueId": row.value_id,
                "valueLabel": row.value_label,
                "effectiveFrom": row.effective_from.isoformat(),
                "effectiveTo": row.effective_to.isoformat() if row.effective_to else None,
            }
            if row
            else None
        )
    return snapshot


def _unresolved_recipient_error(
    application: Application,
    *,
    level: int,
    at: datetime,
) -> AppError:
    return AppError(
        status_code=422,
        code="FINANCE_RECIPIENT_UNRESOLVED",
        message=(
            f"Application {application.application_code} cannot resolve REPORTING_MANAGER "
            f"level {level} from authoritative history"
        ),
        details=[
            {
                "applicationId": str(application.id),
                "applicationCode": application.application_code,
                "source": RecipientSource.REPORTING_MANAGER,
                "hierarchyLevel": level,
                "eligibilityEventAt": at.isoformat(),
            }
        ],
    )


async def _resolve_recipient(
    session: AsyncSession,
    application: Application,
    config: CommissionRuleRecipient,
    at: datetime,
) -> ResolvedRecipient:
    owner = await _owner_history_at(session, application, at)
    chain: list[dict[str, object]] = [
        {
            "source": RecipientSource.CASE_OWNER,
            "userId": str(owner.owner_id),
            "ownerHistoryId": str(owner.id),
            "effectiveFrom": owner.effective_from.isoformat(),
            "effectiveTo": owner.effective_to.isoformat() if owner.effective_to else None,
            "officeId": str(owner.office_id) if owner.office_id else None,
            "departmentId": str(owner.department_id) if owner.department_id else None,
            "teamId": str(owner.team_id) if owner.team_id else None,
            "officeName": owner.office_name,
            "departmentName": owner.department_name,
            "teamName": owner.team_name,
        }
    ]
    recipient_id = owner.owner_id
    if config.recipient_source == RecipientSource.REPORTING_MANAGER:
        required_level = config.hierarchy_level or 0
        for level in range(1, required_level + 1):
            assignment = await _assignment_at(
                session, recipient_id, AssignmentField.REPORTING_MANAGER, at
            )
            if assignment is None or assignment.value_id is None:
                raise _unresolved_recipient_error(application, level=level, at=at)
            try:
                manager_id = UUID(assignment.value_id)
            except ValueError as exc:
                raise _unresolved_recipient_error(application, level=level, at=at) from exc
            if await session.get(User, manager_id) is None:
                raise _unresolved_recipient_error(application, level=level, at=at)
            chain.append(
                {
                    "source": RecipientSource.REPORTING_MANAGER,
                    "hierarchyLevel": level,
                    "userId": str(manager_id),
                    "assignmentHistoryId": str(assignment.id),
                    "effectiveFrom": assignment.effective_from.isoformat(),
                    "effectiveTo": (
                        assignment.effective_to.isoformat() if assignment.effective_to else None
                    ),
                }
            )
            recipient_id = manager_id
    if await session.get(User, recipient_id) is None:
        if config.recipient_source == RecipientSource.CASE_OWNER:
            raise AppError(
                status_code=422,
                code="FINANCE_RECIPIENT_UNRESOLVED",
                message=f"Application {application.application_code} Case Owner no longer exists",
            )
        raise _unresolved_recipient_error(application, level=config.hierarchy_level or 0, at=at)
    snapshot = {
        "policy": "event_time_effective_dated",
        "source": config.recipient_source,
        "hierarchyLevel": config.hierarchy_level,
        "eligibilityEventAt": at.isoformat(),
        "applicationId": str(application.id),
        "resolvedRecipientUserId": str(recipient_id),
        "chain": chain,
        "recipientAssignments": await _recipient_org_snapshot(session, recipient_id, at),
    }
    return ResolvedRecipient(
        user_id=recipient_id,
        source=config.recipient_source,
        hierarchy_level=config.hierarchy_level,
        snapshot=snapshot,
    )


def _rule_slabs(
    slabs: list[CommissionRuleSlab], recipient_id: UUID | None
) -> list[tuple[Decimal, Decimal | None, Decimal]]:
    return [
        (row.minimum_eligible, row.maximum_eligible, row.payout_amount)
        for row in slabs
        if row.recipient_id == recipient_id
    ]


async def _resolve_rule(
    session: AsyncSession,
    application: Application,
    milestone: str,
    event_at: datetime,
) -> CommissionRule | None:
    rows = list(
        (
            await session.execute(
                select(CommissionRule)
                .options(*_rule_options())
                .where(
                    CommissionRule.bank_id == application.bank_id,
                    CommissionRule.product_id == application.product_id,
                    CommissionRule.eligibility_milestone == milestone,
                    CommissionRule.status == ConfigurationStatus.ACTIVE,
                    CommissionRule.effective_from <= event_at.date(),
                    or_(
                        CommissionRule.effective_to.is_(None),
                        CommissionRule.effective_to >= event_at.date(),
                    ),
                )
            )
        ).scalars()
    )
    if len(rows) > 1:
        raise AppError(
            status_code=409,
            code="COMMISSION_RULE_AMBIGUOUS",
            message=f"Application {application.application_code} resolves to multiple active rules",
            details=[{"applicationId": str(application.id), "milestone": milestone}],
        )
    return rows[0] if rows else None


async def _prepare_commission_components(
    session: AsyncSession, period_month: date
) -> list[PreparedComponent]:
    start_at = datetime(period_month.year, period_month.month, 1, tzinfo=UTC)
    next_month = _next_month(period_month)
    end_at = datetime(next_month.year, next_month.month, 1, tzinfo=UTC)
    applications = list(
        (
            await session.execute(
                select(Application).where(
                    or_(
                        and_(Application.booked_at >= start_at, Application.booked_at < end_at),
                        and_(
                            Application.fund_released_at >= start_at,
                            Application.fund_released_at < end_at,
                        ),
                    )
                )
            )
        ).scalars()
    )
    prepared: list[PreparedComponent] = []
    for application in applications:
        events = (
            (EligibilityMilestone.BOOKED.value, application.booked_at, application.booked_amount),
            (
                EligibilityMilestone.FUNDED.value,
                application.fund_released_at,
                application.funded_amount,
            ),
        )
        for milestone, event_at, eligible_amount in events:
            if event_at is None or not (start_at <= event_at < end_at):
                continue
            rule = await _resolve_rule(session, application, milestone, event_at)
            if rule is None:
                continue
            if eligible_amount is None:
                raise AppError(
                    status_code=422,
                    code="FINANCE_ELIGIBLE_AMOUNT_MISSING",
                    message=(
                        f"Application {application.application_code} has no {milestone} amount "
                        "for its active commission rule"
                    ),
                    details=[{"applicationId": str(application.id), "milestone": milestone}],
                )
            eligible = round_money(eligible_amount)
            resolved: list[tuple[CommissionRuleRecipient, ResolvedRecipient]] = []
            for recipient_config in rule.recipients:
                resolved.append(
                    (
                        recipient_config,
                        await _resolve_recipient(session, application, recipient_config, event_at),
                    )
                )
            if rule.payout_mode == RecipientPayoutMode.PERCENTAGE_SPLIT:
                source_amount = calculate_component(
                    method=rule.calculation_method or "",
                    eligible_amount=eligible,
                    fixed_amount=rule.fixed_amount,
                    percentage_rate=rule.percentage_rate,
                    flat_amount=rule.flat_amount,
                    slabs=_rule_slabs(rule.slabs, None),
                )
                allocations = largest_remainder_allocate(
                    source_amount,
                    [
                        (config.id, config.split_percent or ZERO, config.sort_order)
                        for config, _recipient in resolved
                    ],
                )
                for config, recipient in resolved:
                    prepared.append(
                        PreparedComponent(
                            application_id=application.id,
                            recipient_id=recipient.user_id,
                            component_type=FinanceComponentType.COMMISSION,
                            amount=allocations[config.id],
                            eligible_amount=eligible,
                            eligibility_milestone=milestone,
                            eligibility_event_at=event_at,
                            commission_rule_id=rule.id,
                            incentive_plan_id=None,
                            role_code=config.role_code,
                            role_name=config.role_name,
                            attribution_snapshot=recipient.snapshot,
                            calculation_method=rule.calculation_method,
                            calculation_evidence={
                                "roundingMode": "ROUND_HALF_UP",
                                "sourceComponentAmount": money(source_amount),
                                "splitPercent": str(config.split_percent),
                                "allocationMethod": "largest_remainder",
                                "sortOrder": config.sort_order,
                                "ruleVersion": rule.version,
                            },
                        )
                    )
            else:
                for config, recipient in resolved:
                    amount = calculate_component(
                        method=config.calculation_method or "",
                        eligible_amount=eligible,
                        fixed_amount=config.fixed_amount,
                        percentage_rate=config.percentage_rate,
                        flat_amount=config.flat_amount,
                        slabs=_rule_slabs(rule.slabs, config.id),
                    )
                    prepared.append(
                        PreparedComponent(
                            application_id=application.id,
                            recipient_id=recipient.user_id,
                            component_type=FinanceComponentType.COMMISSION,
                            amount=amount,
                            eligible_amount=eligible,
                            eligibility_milestone=milestone,
                            eligibility_event_at=event_at,
                            commission_rule_id=rule.id,
                            incentive_plan_id=None,
                            role_code=config.role_code,
                            role_name=config.role_name,
                            attribution_snapshot=recipient.snapshot,
                            calculation_method=config.calculation_method,
                            calculation_evidence={
                                "roundingMode": "ROUND_HALF_UP",
                                "ruleVersion": rule.version,
                                "roleSortOrder": config.sort_order,
                            },
                        )
                    )
    return prepared


async def _resolve_incentive_plan(
    session: AsyncSession, period_month: date
) -> IncentivePlan | None:
    rows = list(
        (
            await session.execute(
                select(IncentivePlan)
                .options(*_plan_options())
                .where(
                    IncentivePlan.status == ConfigurationStatus.ACTIVE,
                    IncentivePlan.effective_from <= period_month,
                    or_(
                        IncentivePlan.effective_to.is_(None),
                        IncentivePlan.effective_to >= period_month,
                    ),
                )
            )
        ).scalars()
    )
    if len(rows) > 1:
        raise AppError(
            status_code=409,
            code="INCENTIVE_PLAN_AMBIGUOUS",
            message="The payout month resolves to multiple active incentive plans",
        )
    return rows[0] if rows else None


async def _prepare_incentive_components(
    session: AsyncSession,
    period_month: date,
    commission_components: list[PreparedComponent],
) -> list[PreparedComponent]:
    plan = await _resolve_incentive_plan(session, period_month)
    if plan is None:
        return []
    production: dict[UUID, Decimal] = {}
    seen: set[tuple[UUID, UUID | None, str | None]] = set()
    snapshots: dict[UUID, dict[str, object] | None] = {}
    for component in commission_components:
        key = (
            component.recipient_id,
            component.application_id,
            component.eligibility_milestone,
        )
        if key in seen:
            continue
        seen.add(key)
        production[component.recipient_id] = production.get(component.recipient_id, ZERO) + (
            component.eligible_amount or ZERO
        )
        snapshots.setdefault(component.recipient_id, component.attribution_snapshot)
    slabs = [
        (row.minimum_production, row.maximum_production, row.payout_amount) for row in plan.slabs
    ]
    prepared: list[PreparedComponent] = []
    for recipient_id, achieved in production.items():
        match = single_matching_slab(achieved, slabs)
        if match is None:
            continue
        prepared.append(
            PreparedComponent(
                application_id=None,
                recipient_id=recipient_id,
                component_type=FinanceComponentType.INCENTIVE,
                amount=round_money(match[2]),
                eligible_amount=round_money(achieved),
                eligibility_milestone=None,
                eligibility_event_at=None,
                commission_rule_id=None,
                incentive_plan_id=plan.id,
                role_code="monthly_incentive",
                role_name="Monthly Incentive",
                attribution_snapshot=snapshots.get(recipient_id),
                calculation_method=CalculationMethod.SLAB,
                calculation_evidence={
                    "roundingMode": "ROUND_HALF_UP",
                    "achievedEligibleProduction": money(achieved),
                    "matchingMinimum": money(match[0]),
                    "matchingMaximum": money(match[1]) if match[1] is not None else None,
                    "planVersion": plan.version,
                    "selection": "highest_valid_matching_non_progressive_slab",
                },
            )
        )
    return prepared


async def _get_period(
    session: AsyncSession, period_month: date, *, lock: bool = False
) -> FinancePayoutPeriod:
    stmt = select(FinancePayoutPeriod).where(
        FinancePayoutPeriod.period_month == month_start(period_month)
    )
    if lock:
        stmt = stmt.with_for_update()
    period = (await session.execute(stmt)).scalar_one_or_none()
    if period is None:
        raise AppError(
            status_code=404,
            code="FINANCE_PERIOD_NOT_FOUND",
            message="Finance payout period was not found",
        )
    return period


def _require_editable(period: FinancePayoutPeriod) -> None:
    if period.status == PayoutPeriodStatus.FINALIZED:
        raise AppError(
            status_code=409,
            code="FINANCE_PERIOD_LOCKED",
            message="A finalized Finance payout period cannot be directly edited",
        )


def _required_reason(value: str) -> str:
    reason = value.strip()
    if not reason:
        raise AppError(
            status_code=422,
            code="REASON_REQUIRED",
            message="A reason is required",
        )
    return reason


async def _refresh_payout(
    session: AsyncSession, period: FinancePayoutPeriod, recipient_id: UUID
) -> FinancePayout:
    components = list(
        (
            await session.execute(
                select(FinanceComponent).where(
                    FinanceComponent.period_id == period.id,
                    FinanceComponent.recipient_id == recipient_id,
                )
            )
        ).scalars()
    )
    totals = {
        kind.value: round_money(
            sum(
                (row.amount for row in components if row.component_type == kind.value),
                start=ZERO,
            )
        )
        for kind in FinanceComponentType
    }
    payout = (
        await session.execute(
            select(FinancePayout).where(
                FinancePayout.period_id == period.id,
                FinancePayout.recipient_id == recipient_id,
            )
        )
    ).scalar_one_or_none()
    if payout is None:
        previous = (
            await session.execute(
                select(FinancePayout)
                .join(FinancePayoutPeriod, FinancePayout.period_id == FinancePayoutPeriod.id)
                .where(
                    FinancePayout.recipient_id == recipient_id,
                    FinancePayoutPeriod.status == PayoutPeriodStatus.FINALIZED,
                    FinancePayoutPeriod.period_month < period.period_month,
                )
                .order_by(FinancePayoutPeriod.period_month.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        payout = FinancePayout(
            id=new_uuid(),
            period_id=period.id,
            recipient_id=recipient_id,
            previous_payout_id=previous.id if previous else None,
            previous_carry=previous.carry_forward if previous else ZERO,
            commission_total=ZERO,
            incentive_total=ZERO,
            adjustment_total=ZERO,
            clawback_total=ZERO,
            gross_amount=ZERO,
            payable_amount=ZERO,
            carry_forward=ZERO,
            updated_at=utcnow(),
        )
        session.add(payout)
    gross = round_money(
        payout.previous_carry
        + totals[FinanceComponentType.COMMISSION.value]
        + totals[FinanceComponentType.INCENTIVE.value]
        + totals[FinanceComponentType.ADJUSTMENT.value]
        + totals[FinanceComponentType.CLAWBACK.value]
    )
    payout.commission_total = totals[FinanceComponentType.COMMISSION.value]
    payout.incentive_total = totals[FinanceComponentType.INCENTIVE.value]
    payout.adjustment_total = totals[FinanceComponentType.ADJUSTMENT.value]
    payout.clawback_total = totals[FinanceComponentType.CLAWBACK.value]
    payout.gross_amount = gross
    payout.payable_amount = max(ZERO, gross)
    payout.carry_forward = min(ZERO, gross)
    payout.updated_at = utcnow()
    return payout


async def generate_period(
    session: AsyncSession, actor: User, requested_month: date
) -> dict[str, object]:
    period_month = month_start(requested_month)
    existing = (
        await session.execute(
            select(FinancePayoutPeriod).where(FinancePayoutPeriod.period_month == period_month)
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(
            status_code=409,
            code="FINANCE_PERIOD_ALREADY_GENERATED",
            message="This Finance payout period has already been generated",
        )
    # Pre-validation is deliberately complete before the first persistent object is added.
    commission = await _prepare_commission_components(session, period_month)
    incentive = await _prepare_incentive_components(session, period_month, commission)
    prepared = [*commission, *incentive]
    now = utcnow()
    period = FinancePayoutPeriod(
        id=new_uuid(),
        period_month=period_month,
        status=PayoutPeriodStatus.DRAFT,
        generated_at=now,
        generated_by_id=actor.id,
    )
    session.add(period)
    try:
        # Establish the parent row before inserting immutable component and
        # transition snapshots. All validation has already completed, and the
        # row remains uncommitted until the complete payout is ready.
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="FINANCE_PERIOD_ALREADY_GENERATED",
            message="This Finance payout period was generated concurrently",
        ) from exc
    for item in prepared:
        session.add(
            FinanceComponent(
                id=new_uuid(),
                period_id=period.id,
                application_id=item.application_id,
                recipient_id=item.recipient_id,
                component_type=item.component_type,
                amount=round_money(item.amount),
                eligible_amount=(
                    round_money(item.eligible_amount) if item.eligible_amount is not None else None
                ),
                eligibility_milestone=item.eligibility_milestone,
                eligibility_event_at=item.eligibility_event_at,
                commission_rule_id=item.commission_rule_id,
                incentive_plan_id=item.incentive_plan_id,
                original_component_id=None,
                role_code=item.role_code,
                role_name=item.role_name,
                attribution_snapshot=item.attribution_snapshot,
                calculation_method=item.calculation_method,
                calculation_evidence=item.calculation_evidence,
                reason=None,
                actor_id=actor.id,
                created_at=now,
            )
        )
    session.add(
        FinancePeriodTransition(
            id=new_uuid(),
            period_id=period.id,
            from_status=None,
            to_status=PayoutPeriodStatus.DRAFT,
            reason=None,
            actor_id=actor.id,
            created_at=now,
        )
    )
    await record_audit(
        session,
        action="finance.period.generate",
        entity_type="finance_payout_period",
        entity_id=str(period.id),
        actor_id=actor.id,
        new_values={
            "periodMonth": period_month.isoformat(),
            "status": period.status,
            "componentCount": len(prepared),
        },
    )
    await session.flush()
    for recipient_id in {item.recipient_id for item in prepared}:
        await _refresh_payout(session, period, recipient_id)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="FINANCE_PERIOD_ALREADY_GENERATED",
            message="This Finance payout period was generated concurrently",
        ) from exc
    return await period_payload(session, actor, period.id)


async def _payout_visible(
    session: AsyncSession,
    access: ReportingAccess,
    period: FinancePayoutPeriod,
    payout: FinancePayout,
) -> bool:
    if access.scope is VisibilityScope.COMPANY:
        return True
    user = await session.get(User, payout.recipient_id)
    if user is None:
        return False
    moment = datetime(period.period_month.year, period.period_month.month, 1, tzinfo=UTC)
    return access.owner_visible(
        payout.recipient_id, moment, access.office_at(payout.recipient_id, moment)
    )


def _payout_totals(row: FinancePayout) -> dict[str, object]:
    return {
        "previousCarryForward": money(row.previous_carry),
        "commission": money(row.commission_total),
        "incentive": money(row.incentive_total),
        "adjustment": money(row.adjustment_total),
        "clawback": money(row.clawback_total),
        "grossAmount": money(row.gross_amount),
        "finalPayable": money(row.payable_amount),
        "carryForward": money(row.carry_forward),
    }


async def _period_by_id(session: AsyncSession, period_id: UUID) -> FinancePayoutPeriod:
    row = await session.get(FinancePayoutPeriod, period_id)
    if row is None:
        raise AppError(
            status_code=404,
            code="FINANCE_PERIOD_NOT_FOUND",
            message="Finance payout period was not found",
        )
    return row


async def period_payload(session: AsyncSession, actor: User, period_id: UUID) -> dict[str, object]:
    period = await _period_by_id(session, period_id)
    access = await load_reporting_access(session, actor)
    payouts = list(
        (
            await session.execute(
                select(FinancePayout)
                .where(FinancePayout.period_id == period.id)
                .order_by(FinancePayout.recipient_id)
            )
        ).scalars()
    )
    visible: list[dict[str, object]] = []
    for payout in payouts:
        if not await _payout_visible(session, access, period, payout):
            continue
        user = await session.get(User, payout.recipient_id)
        visible.append(
            {
                "id": str(payout.id),
                "recipientId": str(payout.recipient_id),
                "recipientName": user.full_name if user else None,
                "recipientCode": user.user_code if user else None,
                "previousPayoutId": str(payout.previous_payout_id)
                if payout.previous_payout_id
                else None,
                **_payout_totals(payout),
            }
        )
    transitions = list(
        (
            await session.execute(
                select(FinancePeriodTransition)
                .where(FinancePeriodTransition.period_id == period.id)
                .order_by(FinancePeriodTransition.created_at)
            )
        ).scalars()
    )
    return {
        "id": str(period.id),
        "periodMonth": period.period_month.isoformat(),
        "status": period.status,
        "currency": "AED",
        "reportingScope": access.label,
        "generatedAt": period.generated_at.isoformat(),
        "reviewedAt": period.reviewed_at.isoformat() if period.reviewed_at else None,
        "finalizedAt": period.finalized_at.isoformat() if period.finalized_at else None,
        "payouts": visible,
        "transitions": [
            {
                "id": str(row.id),
                "fromStatus": row.from_status,
                "toStatus": row.to_status,
                "reason": row.reason,
                "createdAt": row.created_at.isoformat(),
            }
            for row in transitions
        ],
    }


async def list_periods(session: AsyncSession, actor: User) -> dict[str, object]:
    rows = list(
        (
            await session.execute(
                select(FinancePayoutPeriod).order_by(FinancePayoutPeriod.period_month.desc())
            )
        ).scalars()
    )
    return {"items": [await period_payload(session, actor, row.id) for row in rows]}


async def _assert_application_visible(
    session: AsyncSession,
    actor: User,
    application: Application,
    at: datetime,
) -> None:
    access = await load_reporting_access(session, actor)
    owner = await _owner_history_at(session, application, at)
    if not access.owner_visible(owner.owner_id, at, owner.office_id):
        raise AppError(
            status_code=404,
            code="APPLICATION_NOT_FOUND",
            message="Application was not found",
        )


async def _assert_recipient_visible(
    session: AsyncSession,
    actor: User,
    period: FinancePayoutPeriod,
    recipient_id: UUID,
) -> None:
    access = await load_reporting_access(session, actor)
    moment = datetime(period.period_month.year, period.period_month.month, 1, tzinfo=UTC)
    if not access.owner_visible(recipient_id, moment, access.office_at(recipient_id, moment)):
        raise AppError(
            status_code=404,
            code="FINANCE_PAYOUT_NOT_FOUND",
            message="Recipient payout was not found",
        )


async def _payout_for_recipient(
    session: AsyncSession, period_id: UUID, recipient_id: UUID
) -> FinancePayout:
    payout = (
        await session.execute(
            select(FinancePayout).where(
                FinancePayout.period_id == period_id,
                FinancePayout.recipient_id == recipient_id,
            )
        )
    ).scalar_one_or_none()
    if payout is None:
        raise AppError(
            status_code=404,
            code="FINANCE_PAYOUT_NOT_FOUND",
            message="Recipient payout was not found",
        )
    return payout


async def add_adjustment(
    session: AsyncSession,
    actor: User,
    requested_month: date,
    payload: AdjustmentCreateRequest,
) -> dict[str, object]:
    period = await _get_period(session, requested_month, lock=True)
    _require_editable(period)
    application = await session.get(Application, payload.application_id)
    recipient = await session.get(User, payload.recipient_id)
    if application is None or recipient is None:
        raise AppError(
            status_code=404,
            code="FINANCE_ATTRIBUTION_NOT_FOUND",
            message="Application or recipient was not found",
        )
    related = (
        await session.execute(
            select(FinanceComponent)
            .where(
                FinanceComponent.period_id == period.id,
                FinanceComponent.application_id == application.id,
                FinanceComponent.recipient_id == recipient.id,
                FinanceComponent.component_type == FinanceComponentType.COMMISSION,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if related is None:
        raise AppError(
            status_code=422,
            code="FINANCE_ATTRIBUTION_MISMATCH",
            message=(
                "Adjustment recipient must match frozen Finance attribution for the Application"
            ),
        )
    event_at = related.eligibility_event_at or period.generated_at
    await _assert_application_visible(session, actor, application, event_at)
    await _assert_recipient_visible(session, actor, period, recipient.id)
    amount = round_money(payload.amount)
    if amount == ZERO:
        raise AppError(
            status_code=422,
            code="FINANCE_ADJUSTMENT_ZERO",
            message="Adjustment amount cannot be zero",
        )
    reason = _required_reason(payload.reason)
    component = FinanceComponent(
        id=new_uuid(),
        period_id=period.id,
        application_id=application.id,
        recipient_id=recipient.id,
        component_type=FinanceComponentType.ADJUSTMENT,
        amount=amount,
        eligible_amount=None,
        eligibility_milestone=None,
        eligibility_event_at=related.eligibility_event_at,
        commission_rule_id=None,
        incentive_plan_id=None,
        original_component_id=None,
        role_code=related.role_code,
        role_name=related.role_name,
        attribution_snapshot=related.attribution_snapshot,
        calculation_method=None,
        calculation_evidence={"roundingMode": "ROUND_HALF_UP"},
        reason=reason,
        actor_id=actor.id,
        created_at=utcnow(),
    )
    session.add(component)
    await record_audit(
        session,
        action="finance.adjustment.create",
        entity_type="finance_component",
        entity_id=str(component.id),
        actor_id=actor.id,
        target_user_id=recipient.id,
        new_values={
            "periodMonth": period.period_month.isoformat(),
            "applicationId": str(application.id),
            "recipientId": str(recipient.id),
            "amount": money(amount),
        },
        note=reason,
    )
    await session.flush()
    await _refresh_payout(session, period, recipient.id)
    await session.commit()
    return await component_payload(session, actor, component.id)


async def add_clawback(
    session: AsyncSession,
    actor: User,
    requested_month: date,
    payload: ClawbackCreateRequest,
) -> dict[str, object]:
    period = await _get_period(session, requested_month, lock=True)
    _require_editable(period)
    original = await session.get(FinanceComponent, payload.original_component_id)
    if (
        original is None
        or original.component_type != FinanceComponentType.COMMISSION
        or original.application_id is None
    ):
        raise AppError(
            status_code=404,
            code="FINANCE_ORIGINAL_COMPONENT_NOT_FOUND",
            message="The original Application commission component was not found",
        )
    application = await session.get(Application, original.application_id)
    if application is None:
        raise AppError(
            status_code=404,
            code="APPLICATION_NOT_FOUND",
            message="Application was not found",
        )
    await _assert_application_visible(
        session, actor, application, original.eligibility_event_at or original.created_at
    )
    await _assert_recipient_visible(session, actor, period, original.recipient_id)
    amount = -round_money(payload.amount)
    reason = _required_reason(payload.reason)
    component = FinanceComponent(
        id=new_uuid(),
        period_id=period.id,
        application_id=original.application_id,
        recipient_id=original.recipient_id,
        component_type=FinanceComponentType.CLAWBACK,
        amount=amount,
        eligible_amount=None,
        eligibility_milestone=original.eligibility_milestone,
        eligibility_event_at=original.eligibility_event_at,
        commission_rule_id=original.commission_rule_id,
        incentive_plan_id=None,
        original_component_id=original.id,
        role_code=original.role_code,
        role_name=original.role_name,
        attribution_snapshot=original.attribution_snapshot,
        calculation_method=None,
        calculation_evidence={
            "roundingMode": "ROUND_HALF_UP",
            "originalComponentId": str(original.id),
        },
        reason=reason,
        actor_id=actor.id,
        created_at=utcnow(),
    )
    session.add(component)
    await record_audit(
        session,
        action="finance.clawback.create",
        entity_type="finance_component",
        entity_id=str(component.id),
        actor_id=actor.id,
        target_user_id=original.recipient_id,
        new_values={
            "periodMonth": period.period_month.isoformat(),
            "applicationId": str(application.id),
            "recipientId": str(original.recipient_id),
            "amount": money(amount),
            "originalComponentId": str(original.id),
        },
        note=reason,
    )
    await session.flush()
    await _refresh_payout(session, period, original.recipient_id)
    await session.commit()
    return await component_payload(session, actor, component.id)


async def _transition_period(
    session: AsyncSession,
    actor: User,
    requested_month: date,
    *,
    expected: str,
    target: str,
    reason: str | None = None,
) -> dict[str, object]:
    period = await _get_period(session, requested_month, lock=True)
    if period.status != expected:
        raise AppError(
            status_code=409,
            code="FINANCE_PERIOD_TRANSITION_INVALID",
            message=f"Finance period must be {expected} before moving to {target}",
        )
    note = _required_reason(reason) if reason is not None else None
    if (
        target == PayoutPeriodStatus.REVIEW
        and expected == PayoutPeriodStatus.FINALIZED
        and not note
    ):
        raise AppError(
            status_code=422,
            code="REASON_REQUIRED",
            message="A reason is required to reopen a finalized Finance period",
        )
    now = utcnow()
    old = period.status
    period.status = target
    if target == PayoutPeriodStatus.REVIEW and expected == PayoutPeriodStatus.DRAFT:
        period.reviewed_at = now
        period.reviewed_by_id = actor.id
    elif target == PayoutPeriodStatus.FINALIZED:
        period.finalized_at = now
        period.finalized_by_id = actor.id
    session.add(
        FinancePeriodTransition(
            id=new_uuid(),
            period_id=period.id,
            from_status=old,
            to_status=target,
            reason=note,
            actor_id=actor.id,
            created_at=now,
        )
    )
    action = {
        (PayoutPeriodStatus.DRAFT, PayoutPeriodStatus.REVIEW): "finance.period.review",
        (PayoutPeriodStatus.REVIEW, PayoutPeriodStatus.FINALIZED): "finance.period.finalize",
        (PayoutPeriodStatus.FINALIZED, PayoutPeriodStatus.REVIEW): "finance.period.reopen",
    }[(expected, target)]
    await record_audit(
        session,
        action=action,
        entity_type="finance_payout_period",
        entity_id=str(period.id),
        actor_id=actor.id,
        old_values={"status": old},
        new_values={"status": target},
        note=note,
    )
    await session.commit()
    return await period_payload(session, actor, period.id)


async def review_period(
    session: AsyncSession, actor: User, period_month: date
) -> dict[str, object]:
    return await _transition_period(
        session,
        actor,
        period_month,
        expected=PayoutPeriodStatus.DRAFT,
        target=PayoutPeriodStatus.REVIEW,
    )


async def finalize_period(
    session: AsyncSession, actor: User, period_month: date
) -> dict[str, object]:
    return await _transition_period(
        session,
        actor,
        period_month,
        expected=PayoutPeriodStatus.REVIEW,
        target=PayoutPeriodStatus.FINALIZED,
    )


async def reopen_period(
    session: AsyncSession, actor: User, period_month: date, reason: str
) -> dict[str, object]:
    return await _transition_period(
        session,
        actor,
        period_month,
        expected=PayoutPeriodStatus.FINALIZED,
        target=PayoutPeriodStatus.REVIEW,
        reason=reason,
    )


async def _visible_payout(
    session: AsyncSession, actor: User, payout_id: UUID
) -> tuple[FinancePayoutPeriod, FinancePayout]:
    payout = await session.get(FinancePayout, payout_id)
    if payout is None:
        raise AppError(
            status_code=404, code="FINANCE_PAYOUT_NOT_FOUND", message="Payout was not found"
        )
    period = await _period_by_id(session, payout.period_id)
    access = await load_reporting_access(session, actor)
    if not await _payout_visible(session, access, period, payout):
        raise AppError(
            status_code=404, code="FINANCE_PAYOUT_NOT_FOUND", message="Payout was not found"
        )
    return period, payout


async def _component_visible(
    session: AsyncSession,
    access: ReportingAccess,
    component: FinanceComponent,
) -> bool:
    if component.application_id is None:
        return True
    application = await session.get(Application, component.application_id)
    if application is None:
        return False
    at = component.eligibility_event_at or component.created_at
    try:
        owner = await _owner_history_at(session, application, at)
    except AppError:
        return False
    return access.owner_visible(owner.owner_id, at, owner.office_id)


async def component_payload(
    session: AsyncSession, actor: User, component_id: UUID
) -> dict[str, object]:
    component = await session.get(FinanceComponent, component_id)
    if component is None:
        raise AppError(
            status_code=404,
            code="FINANCE_COMPONENT_NOT_FOUND",
            message="Finance component was not found",
        )
    payout = await _payout_for_recipient(session, component.period_id, component.recipient_id)
    await _visible_payout(session, actor, payout.id)
    access = await load_reporting_access(session, actor)
    if not await _component_visible(session, access, component):
        raise AppError(
            status_code=404,
            code="FINANCE_COMPONENT_NOT_FOUND",
            message="Finance component was not found",
        )
    application = (
        await session.get(Application, component.application_id)
        if component.application_id
        else None
    )
    recipient = await session.get(User, component.recipient_id)
    return {
        "id": str(component.id),
        "periodId": str(component.period_id),
        "applicationId": str(component.application_id) if component.application_id else None,
        "applicationCode": application.application_code if application else None,
        "recipientId": str(component.recipient_id),
        "recipientName": recipient.full_name if recipient else None,
        "componentType": component.component_type,
        "amount": money(component.amount),
        "eligibleAmount": (
            money(component.eligible_amount) if component.eligible_amount is not None else None
        ),
        "eligibilityMilestone": component.eligibility_milestone,
        "eligibilityEventAt": (
            component.eligibility_event_at.isoformat() if component.eligibility_event_at else None
        ),
        "commissionRuleId": (
            str(component.commission_rule_id) if component.commission_rule_id else None
        ),
        "incentivePlanId": (
            str(component.incentive_plan_id) if component.incentive_plan_id else None
        ),
        "originalComponentId": (
            str(component.original_component_id) if component.original_component_id else None
        ),
        "roleCode": component.role_code,
        "roleName": component.role_name,
        "attributionSource": (
            component.attribution_snapshot.get("source") if component.attribution_snapshot else None
        ),
        "attributionHierarchyLevel": (
            component.attribution_snapshot.get("hierarchyLevel")
            if component.attribution_snapshot
            else None
        ),
        "calculationMethod": component.calculation_method,
        "reason": component.reason,
        "createdAt": component.created_at.isoformat(),
    }


async def payout_components(
    session: AsyncSession, actor: User, payout_id: UUID
) -> dict[str, object]:
    period, payout = await _visible_payout(session, actor, payout_id)
    access = await load_reporting_access(session, actor)
    components = list(
        (
            await session.execute(
                select(FinanceComponent)
                .where(
                    FinanceComponent.period_id == period.id,
                    FinanceComponent.recipient_id == payout.recipient_id,
                )
                .order_by(FinanceComponent.created_at, FinanceComponent.id)
            )
        ).scalars()
    )
    visible = [row for row in components if await _component_visible(session, access, row)]
    return {
        "payoutId": str(payout.id),
        "periodMonth": period.period_month.isoformat(),
        "items": [await component_payload(session, actor, row.id) for row in visible],
        "total": len(visible),
    }


async def statement_payload(
    session: AsyncSession,
    actor: User,
    requested_month: date,
    recipient_id: UUID | None = None,
) -> dict[str, object]:
    period = await _get_period(session, requested_month)
    access = await load_reporting_access(session, actor)
    stmt = select(FinancePayout).where(FinancePayout.period_id == period.id)
    if recipient_id is not None:
        stmt = stmt.where(FinancePayout.recipient_id == recipient_id)
    payouts = list((await session.execute(stmt.order_by(FinancePayout.recipient_id))).scalars())
    items: list[dict[str, object]] = []
    for payout in payouts:
        if not await _payout_visible(session, access, period, payout):
            continue
        components = list(
            (
                await session.execute(
                    select(FinanceComponent).where(
                        FinanceComponent.period_id == period.id,
                        FinanceComponent.recipient_id == payout.recipient_id,
                    )
                )
            ).scalars()
        )
        eligible: dict[tuple[UUID, str], Decimal] = {}
        for component in components:
            if (
                await _component_visible(session, access, component)
                and component.component_type == FinanceComponentType.COMMISSION
                and component.application_id
                and component.eligibility_milestone
                and component.eligible_amount is not None
            ):
                eligible[(component.application_id, component.eligibility_milestone)] = (
                    component.eligible_amount
                )
        user = await session.get(User, payout.recipient_id)
        items.append(
            {
                "payoutId": str(payout.id),
                "recipientId": str(payout.recipient_id),
                "recipientCode": user.user_code if user else None,
                "recipientName": user.full_name if user else None,
                "eligibleCases": len(eligible),
                "eligibleValue": money(sum(eligible.values(), start=ZERO)),
                **_payout_totals(payout),
            }
        )
    if recipient_id is not None and not items:
        raise AppError(
            status_code=404,
            code="FINANCE_STATEMENT_NOT_FOUND",
            message="Finance statement was not found",
        )
    return {
        "period": {
            "month": period.period_month.isoformat(),
            "label": period.period_month.strftime("%B %Y"),
            "from": period.period_month.isoformat(),
            "to": month_end(period.period_month).isoformat(),
            "status": period.status,
        },
        "currency": "AED",
        "reportingScope": access.label,
        "items": items,
        "total": len(items),
    }
