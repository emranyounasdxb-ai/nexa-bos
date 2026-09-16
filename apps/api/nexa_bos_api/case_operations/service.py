from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.applications.models import Application, ApplicationEvent
from nexa_bos_api.case_operations.models import (
    CardPointRule,
    CaseEarning,
    CaseEarningReversal,
    ClawbackRequest,
    LaneRoutingAssignment,
)
from nexa_bos_api.case_operations.schemas import (
    BankSubmissionRequest,
    BookCaseRequest,
    CardPointRuleCreateRequest,
    ClawbackCreateRequest,
    ClawbackDecisionRequest,
    RoutingAssignmentRequest,
    SalesManagerDecisionRequest,
)
from nexa_bos_api.catalog.models import Bank, BankProduct, Product, ProductVariant
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.finance.calc import calculate_component, round_money
from nexa_bos_api.finance.models import CommissionRule
from nexa_bos_api.identity.access import has_user_type, load_user_with_type
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus, MasterStatus
from nexa_bos_api.identity.models import Office, User, new_uuid


def utcnow() -> datetime:
    return datetime.now(UTC)


def _money(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), "f")


async def _variant_context(
    session: AsyncSession,
    bank_id: UUID,
    variant_id: UUID,
    *,
    require_active: bool = True,
) -> tuple[Bank, Product, ProductVariant]:
    row = (
        await session.execute(
            select(Bank, Product, ProductVariant)
            .join(BankProduct, BankProduct.bank_id == Bank.id)
            .join(Product, Product.id == BankProduct.product_id)
            .join(ProductVariant, ProductVariant.bank_product_id == BankProduct.id)
            .where(Bank.id == bank_id, ProductVariant.id == variant_id)
        )
    ).one_or_none()
    if row is None:
        raise AppError(
            status_code=422,
            code="CARD_POINT_VARIANT_INVALID",
            message="Product Variant must belong to the selected Bank",
        )
    bank, product, variant = row
    if product.code != "CC":
        raise AppError(
            status_code=422,
            code="CARD_POINT_PRODUCT_INVALID",
            message="Card points can only be configured for Credit Card variants",
        )
    if require_active and any(
        item.status != MasterStatus.ACTIVE for item in (bank, product, variant)
    ):
        raise AppError(
            status_code=422,
            code="CARD_POINT_REFERENCE_INACTIVE",
            message="Card point rules require active Bank, Product, and Product Variant records",
        )
    return bank, product, variant


async def serialize_card_rule(session: AsyncSession, row: CardPointRule) -> dict[str, object]:
    bank, _product, variant = await _variant_context(
        session, row.bank_id, row.product_variant_id, require_active=False
    )
    return {
        "id": str(row.id),
        "bankId": str(row.bank_id),
        "bankName": bank.name,
        "productVariantId": str(row.product_variant_id),
        "productVariantName": variant.name,
        "version": row.version,
        "points": _money(row.points),
        "effectiveFrom": row.effective_from.isoformat(),
        "effectiveTo": row.effective_to.isoformat() if row.effective_to else None,
        "status": row.status,
        "createdAt": row.created_at.isoformat(),
        "activatedAt": row.activated_at.isoformat() if row.activated_at else None,
    }


async def create_card_rule(
    session: AsyncSession, actor: User, payload: CardPointRuleCreateRequest
) -> dict[str, object]:
    if payload.effective_to and payload.effective_to < payload.effective_from:
        raise AppError(
            status_code=422,
            code="EFFECTIVE_DATE_RANGE_INVALID",
            message="Effective To cannot be before Effective From",
        )
    await _variant_context(session, payload.bank_id, payload.product_variant_id)
    version = (
        await session.scalar(
            select(func.max(CardPointRule.version)).where(
                CardPointRule.bank_id == payload.bank_id,
                CardPointRule.product_variant_id == payload.product_variant_id,
            )
        )
        or 0
    ) + 1
    row = CardPointRule(
        id=new_uuid(),
        bank_id=payload.bank_id,
        product_variant_id=payload.product_variant_id,
        version=version,
        points=round_money(payload.points),
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        status="draft",
        created_at=utcnow(),
        created_by_id=actor.id,
    )
    session.add(row)
    await record_audit(
        session,
        action="case_operations.card_point_rule.create",
        entity_type="card_point_rule",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values={
            "bankId": str(row.bank_id),
            "productVariantId": str(row.product_variant_id),
            "points": _money(row.points),
            "version": row.version,
        },
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="CARD_POINT_RULE_VERSION_CONFLICT",
            message="A concurrent Card Point rule version already exists",
        ) from exc
    return await serialize_card_rule(session, row)


async def list_card_rules(session: AsyncSession) -> dict[str, object]:
    rows = list(
        (
            await session.execute(select(CardPointRule).order_by(CardPointRule.created_at.desc()))
        ).scalars()
    )
    return {"items": [await serialize_card_rule(session, row) for row in rows]}


async def set_card_rule_status(
    session: AsyncSession, actor: User, rule_id: UUID, *, active: bool
) -> dict[str, object]:
    row = await session.scalar(
        select(CardPointRule).where(CardPointRule.id == rule_id).with_for_update()
    )
    if row is None:
        raise AppError(status_code=404, code="CARD_POINT_RULE_NOT_FOUND", message="Rule not found")
    target = "active" if active else "inactive"
    if active:
        await _variant_context(session, row.bank_id, row.product_variant_id)
        end = row.effective_to or date.max
        conflict = await session.scalar(
            select(CardPointRule.id).where(
                CardPointRule.id != row.id,
                CardPointRule.bank_id == row.bank_id,
                CardPointRule.product_variant_id == row.product_variant_id,
                CardPointRule.status == "active",
                CardPointRule.effective_from <= end,
                or_(
                    CardPointRule.effective_to.is_(None),
                    CardPointRule.effective_to >= row.effective_from,
                ),
            )
        )
        if conflict:
            raise AppError(
                status_code=409,
                code="CARD_POINT_RULE_OVERLAP",
                message="An active Card Point rule overlaps this effective period",
            )
        row.activated_at = utcnow()
        row.activated_by_id = actor.id
    old = row.status
    row.status = target
    await record_audit(
        session,
        action=f"case_operations.card_point_rule.{'activate' if active else 'deactivate'}",
        entity_type="card_point_rule",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values={"status": old},
        new_values={"status": target},
    )
    await session.commit()
    return await serialize_card_rule(session, row)


async def _active_user_for_role(
    session: AsyncSession, user_id: UUID, role: str, office_id: UUID
) -> User:
    user = await load_user_with_type(session, user_id)
    if (
        user is None
        or not has_user_type(user, role)
        or user.account_status != AccountStatus.ACTIVE
        or user.office_id != office_id
    ):
        raise AppError(
            status_code=422,
            code="ROUTING_USER_INVALID",
            message=f"The selected {role} user must be active and assigned to the selected Office",
        )
    return user


async def upsert_routing(
    session: AsyncSession, actor: User, payload: RoutingAssignmentRequest
) -> dict[str, object]:
    office = await session.get(Office, payload.office_id)
    product = await session.get(Product, payload.product_id)
    if (
        office is None
        or product is None
        or office.status != MasterStatus.ACTIVE
        or product.status != MasterStatus.ACTIVE
    ):
        raise AppError(
            status_code=422,
            code="ROUTING_LANE_INVALID",
            message="Routing requires an active Office and Product Lane",
        )
    manager = await _active_user_for_role(
        session, payload.sales_manager_id, "SM", payload.office_id
    )
    coordinator = await _active_user_for_role(
        session, payload.coordinator_id, "COD", payload.office_id
    )
    row = await session.scalar(
        select(LaneRoutingAssignment)
        .where(
            LaneRoutingAssignment.office_id == payload.office_id,
            LaneRoutingAssignment.product_id == payload.product_id,
        )
        .with_for_update()
    )
    now = utcnow()
    old = None
    if row is None:
        row = LaneRoutingAssignment(
            id=new_uuid(),
            office_id=payload.office_id,
            product_id=payload.product_id,
            sales_manager_id=manager.id,
            coordinator_id=coordinator.id,
            status="active",
            created_at=now,
            updated_at=now,
            updated_by_id=actor.id,
        )
        session.add(row)
    else:
        old = {
            "salesManagerId": str(row.sales_manager_id),
            "coordinatorId": str(row.coordinator_id),
            "status": row.status,
        }
        row.sales_manager_id = manager.id
        row.coordinator_id = coordinator.id
        row.status = "active"
        row.updated_at = now
        row.updated_by_id = actor.id
    await record_audit(
        session,
        action="case_operations.routing.upsert",
        entity_type="lane_routing_assignment",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old,
        new_values={
            "officeId": str(row.office_id),
            "productId": str(row.product_id),
            "salesManagerId": str(row.sales_manager_id),
            "coordinatorId": str(row.coordinator_id),
            "status": row.status,
        },
    )
    await session.commit()
    return await serialize_routing(session, row)


async def serialize_routing(session: AsyncSession, row: LaneRoutingAssignment) -> dict[str, object]:
    office = await session.get(Office, row.office_id)
    product = await session.get(Product, row.product_id)
    manager = await session.get(User, row.sales_manager_id)
    coordinator = await session.get(User, row.coordinator_id)
    return {
        "id": str(row.id),
        "officeId": str(row.office_id),
        "officeName": office.name if office else None,
        "productId": str(row.product_id),
        "productName": product.name if product else None,
        "salesManagerId": str(row.sales_manager_id),
        "salesManagerName": manager.full_name if manager else None,
        "coordinatorId": str(row.coordinator_id),
        "coordinatorName": coordinator.full_name if coordinator else None,
        "status": row.status,
        "updatedAt": row.updated_at.isoformat(),
    }


async def list_routing(session: AsyncSession) -> dict[str, object]:
    rows = list(
        (
            await session.execute(
                select(LaneRoutingAssignment).order_by(
                    LaneRoutingAssignment.office_id, LaneRoutingAssignment.product_id
                )
            )
        ).scalars()
    )
    return {"items": [await serialize_routing(session, row) for row in rows]}


async def set_routing_status(
    session: AsyncSession, actor: User, assignment_id: UUID, *, active: bool
) -> dict[str, object]:
    row = await session.scalar(
        select(LaneRoutingAssignment)
        .where(LaneRoutingAssignment.id == assignment_id)
        .with_for_update()
    )
    if row is None:
        raise AppError(status_code=404, code="ROUTING_NOT_FOUND", message="Routing not found")
    if active:
        await _active_user_for_role(session, row.sales_manager_id, "SM", row.office_id)
        await _active_user_for_role(session, row.coordinator_id, "COD", row.office_id)
    old = row.status
    row.status = "active" if active else "inactive"
    row.updated_at = utcnow()
    row.updated_by_id = actor.id
    await record_audit(
        session,
        action="case_operations.routing.status",
        entity_type="lane_routing_assignment",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values={"status": old},
        new_values={"status": row.status},
    )
    await session.commit()
    return await serialize_routing(session, row)


async def case_operations_options(session: AsyncSession) -> dict[str, object]:
    offices = list(await session.scalars(select(Office).order_by(Office.name)))
    products = list(await session.scalars(select(Product).order_by(Product.name)))
    variants = list(
        (
            await session.execute(
                select(ProductVariant, BankProduct)
                .join(BankProduct, ProductVariant.bank_product_id == BankProduct.id)
                .order_by(ProductVariant.name)
            )
        ).all()
    )
    users = list(
        (
            await session.execute(select(User).where(User.account_status == AccountStatus.ACTIVE))
        ).scalars()
    )
    loaded = [await load_user_with_type(session, user.id) for user in users]
    return {
        "offices": [
            {"id": str(row.id), "name": row.name}
            for row in offices
            if row.status == MasterStatus.ACTIVE
        ],
        "products": [
            {"id": str(row.id), "name": row.name, "code": row.code}
            for row in products
            if row.status == MasterStatus.ACTIVE
        ],
        "cardVariants": [
            {
                "id": str(variant.id),
                "name": variant.name,
                "bankId": str(mapping.bank_id),
                "productId": str(mapping.product_id),
            }
            for variant, mapping in variants
            if variant.status == MasterStatus.ACTIVE
            and next((p for p in products if p.id == mapping.product_id), None)
            and next(p for p in products if p.id == mapping.product_id).code == "CC"
        ],
        "salesManagers": [
            {"id": str(user.id), "name": user.full_name, "officeId": str(user.office_id)}
            for user in loaded
            if user and user.office_id and has_user_type(user, "SM")
        ],
        "coordinators": [
            {"id": str(user.id), "name": user.full_name, "officeId": str(user.office_id)}
            for user in loaded
            if user and user.office_id and has_user_type(user, "COD")
        ],
    }


async def resolve_routing(session: AsyncSession, application: Application) -> LaneRoutingAssignment:
    owner = await session.get(User, application.case_owner_id)
    office_id = owner.office_id if owner else None
    if office_id is None:
        raise AppError(
            status_code=409,
            code="CASE_ROUTING_MISSING",
            message="Case Owner has no Home Office; routing cannot be resolved",
        )
    row = await session.scalar(
        select(LaneRoutingAssignment).where(
            LaneRoutingAssignment.office_id == office_id,
            LaneRoutingAssignment.product_id == application.product_id,
            LaneRoutingAssignment.status == "active",
        )
    )
    if row is None:
        raise AppError(
            status_code=409,
            code="CASE_ROUTING_MISSING",
            message="No active routing is configured for this Office and Product Lane",
            details=[{"officeId": str(office_id), "productId": str(application.product_id)}],
        )
    await _active_user_for_role(session, row.sales_manager_id, "SM", office_id)
    await _active_user_for_role(session, row.coordinator_id, "COD", office_id)
    return row


async def book_case(
    session: AsyncSession,
    actor: User,
    application: Application,
    payload: BookCaseRequest,
) -> Application:
    """Lock a reviewed case to its owner snapshot and resolve its processing lane."""
    from nexa_bos_api.applications.review import append_processing_review, get_review
    from nexa_bos_api.identity.access import tl_team_owner_ids

    await session.refresh(application, with_for_update=True)
    if application.terminal_outcome:
        raise AppError(
            status_code=422,
            code="APPLICATION_TERMINAL",
            message="Terminal applications cannot be booked",
        )
    state = await get_review(session, application)
    if application.booked_by_tl_id and not (
        application.routing_status == "returned" and state["status"] == "resubmitted"
    ):
        raise AppError(
            status_code=409,
            code="CASE_ALREADY_BOOKED",
            message="This case has already been booked",
        )
    if state["eventId"] != str(payload.expected_review_event_id):
        raise AppError(
            status_code=409,
            code="REVIEW_CHANGED",
            message="Review changed. Refresh before booking.",
        )
    if (
        not has_user_type(actor, "TL")
        or state["tlId"] != str(actor.id)
        or application.case_owner_id not in await tl_team_owner_ids(session, actor)
        or state["status"] not in {"pending_review", "resubmitted"}
    ):
        raise AppError(
            status_code=403,
            code="CASE_BOOK_FORBIDDEN",
            message="This case is not assigned to this Team Leader",
        )
    routing = await resolve_routing(session, application)
    application.processing_office_id = routing.office_id
    application.routed_sales_manager_id = routing.sales_manager_id
    application.routed_coordinator_id = routing.coordinator_id
    application.booked_by_tl_id = actor.id
    application.routing_status = "booked"
    application.booked_at = application.booked_at or utcnow()
    await append_processing_review(
        session,
        application,
        actor,
        event_type="internal_booked",
        status="booked",
    )
    await record_audit(
        session,
        action="case_operations.case.book",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        new_values={
            "caseOwnerId": str(application.case_owner_id),
            "processingOfficeId": str(routing.office_id),
            "salesManagerId": str(routing.sales_manager_id),
            "coordinatorId": str(routing.coordinator_id),
        },
    )
    await session.commit()
    return application


async def sales_manager_decision(
    session: AsyncSession,
    actor: User,
    application: Application,
    payload: SalesManagerDecisionRequest,
) -> Application:
    from nexa_bos_api.applications.review import append_processing_review, get_review

    await session.refresh(application, with_for_update=True)
    state = await get_review(session, application)
    if application.routed_sales_manager_id != actor.id or not has_user_type(actor, "SM"):
        raise AppError(
            status_code=404, code="APPLICATION_NOT_FOUND", message="Application not found"
        )
    if state["status"] != "booked" or application.routing_status != "booked":
        raise AppError(
            status_code=409,
            code="CASE_NOT_AWAITING_SM",
            message="This case is not awaiting Sales Manager review",
        )
    reason = payload.reason.strip() if payload.reason else None
    if payload.decision == "return" and not reason:
        raise AppError(
            status_code=422,
            code="REVIEW_REASON_REQUIRED",
            message="A return reason is required",
        )
    approved = payload.decision == "approve"
    application.routing_status = "sm_approved" if approved else "returned"
    if approved:
        application.sales_manager_approved_at = utcnow()
        application.sales_manager_approved_by_id = actor.id
    await append_processing_review(
        session,
        application,
        actor,
        event_type="internal_sm_approved" if approved else "internal_returned",
        status="sm_approved" if approved else "returned",
        reason=reason,
    )
    await record_audit(
        session,
        action=f"case_operations.case.sm_{payload.decision}",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        old_values={"routingStatus": "booked"},
        new_values={"routingStatus": application.routing_status},
        note=reason,
    )
    await session.commit()
    return application


async def submit_bank_file(
    session: AsyncSession,
    actor: User,
    application: Application,
    payload: BankSubmissionRequest,
) -> Application:
    from nexa_bos_api.applications.service import save_case_number
    from nexa_bos_api.applications.tat import on_terminal_outcome
    from nexa_bos_api.identity.enums import ApplicationEventType, TerminalOutcome

    await session.refresh(application, with_for_update=True)
    if application.routed_coordinator_id != actor.id or not has_user_type(actor, "COD"):
        raise AppError(
            status_code=404, code="APPLICATION_NOT_FOUND", message="Application not found"
        )
    product = await session.get(Product, application.product_id)
    if product is None:
        raise AppError(status_code=404, code="PRODUCT_NOT_FOUND", message="Product not found")
    required_state = "sm_approved"
    if application.routing_status != required_state:
        raise AppError(
            status_code=409,
            code="CASE_NOT_READY_FOR_SUBMISSION",
            message=(
                f"This case must be {required_state.replace('_', ' ')} before bank submission"
            ),
        )
    await save_case_number(
        session,
        actor,
        application,
        payload.bank_file_number,
        None,
        commit=False,
    )
    application.routing_status = "submitted"
    if product.code == "CC":
        now = utcnow()
        event = ApplicationEvent(
            id=new_uuid(),
            application_id=application.id,
            event_type=ApplicationEventType.COMPLETED,
            new_stage_id=application.current_stage_id,
            bos_updated_at=now,
            actor_id=actor.id,
            payload={"source": "BankSubmission"},
        )
        session.add(event)
        await session.flush()
        application.terminal_outcome = TerminalOutcome.COMPLETED
        application.completed_at = now
        application.tat_stopped_at = now
        application.routing_status = "closed"
        await on_terminal_outcome(
            session,
            application,
            actor_id=actor.id,
            at=now,
        )
        await post_case_earning(
            session,
            application,
            event,
            product_code="CC",
            at=now,
        )
    await record_audit(
        session,
        action="case_operations.case.bank_submit",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        new_values={
            "bankFileNumber": application.bank_case_number,
            "routingStatus": application.routing_status,
        },
    )
    await session.commit()
    return application


async def _resolved_card_rule(
    session: AsyncSession, application: Application, at: datetime
) -> CardPointRule | None:
    return await session.scalar(
        select(CardPointRule)
        .where(
            CardPointRule.bank_id == application.bank_id,
            CardPointRule.product_variant_id == application.product_variant_id,
            CardPointRule.status == "active",
            CardPointRule.effective_from <= at.date(),
            or_(CardPointRule.effective_to.is_(None), CardPointRule.effective_to >= at.date()),
        )
        .order_by(CardPointRule.version.desc())
        .limit(1)
    )


async def _resolved_pf_rule(
    session: AsyncSession, application: Application, at: datetime
) -> CommissionRule | None:
    return await session.scalar(
        select(CommissionRule)
        .where(
            CommissionRule.bank_id == application.bank_id,
            CommissionRule.product_id == application.product_id,
            CommissionRule.product_variant_id == application.product_variant_id,
            CommissionRule.status == "active",
            CommissionRule.effective_from <= at.date(),
            or_(CommissionRule.effective_to.is_(None), CommissionRule.effective_to >= at.date()),
        )
        .order_by(CommissionRule.version.desc())
        .limit(1)
    )


async def post_case_earning(
    session: AsyncSession,
    application: Application,
    source_event: ApplicationEvent,
    *,
    product_code: str,
    at: datetime,
) -> CaseEarning | None:
    existing = await session.scalar(
        select(CaseEarning).where(
            CaseEarning.application_id == application.id,
            CaseEarning.earning_type
            == ("card_points" if product_code == "CC" else "pf_commission"),
        )
    )
    if existing:
        return existing
    rule_snapshot: dict[str, object]
    if product_code == "CC":
        rule = await _resolved_card_rule(session, application, at)
        if rule is None:
            raise AppError(
                status_code=409,
                code="CARD_POINT_RULE_MISSING",
                message="No active Card Point rule applies to this case",
            )
        amount = rule.points
        card_rule_id = rule.id
        commission_rule_id = None
        rule_snapshot = {
            "ruleType": "card_points",
            "ruleId": str(rule.id),
            "version": rule.version,
            "points": _money(rule.points),
            "effectiveAt": at.isoformat(),
        }
    else:
        rule = await _resolved_pf_rule(session, application, at)
        if rule is None:
            raise AppError(
                status_code=409,
                code="PF_COMMISSION_RULE_MISSING",
                message="No active PF commission rule applies to this case",
            )
        eligible = application.booked_amount
        if eligible is None:
            raise AppError(
                status_code=422,
                code="BOOKED_AMOUNT_REQUIRED",
                message="Booked Amount is required before commission can be posted",
            )
        if rule.payout_mode != "percentage_split" or not rule.recipients:
            raise AppError(
                status_code=422,
                code="PF_RULE_CASE_OWNER_REQUIRED",
                message="PF case earnings require a percentage-split Case Owner rule",
            )
        owner_config = next(
            (item for item in rule.recipients if item.recipient_source == "case_owner"), None
        )
        if owner_config is None:
            raise AppError(
                status_code=422,
                code="PF_RULE_CASE_OWNER_REQUIRED",
                message="PF commission rule must include the Case Owner",
            )
        base = calculate_component(
            method=rule.calculation_method,
            eligible_amount=eligible,
            fixed_amount=rule.fixed_amount,
            percentage_rate=rule.percentage_rate,
            flat_amount=rule.flat_amount,
            slabs=[
                (item.minimum_eligible, item.maximum_eligible, item.payout_amount)
                for item in rule.slabs
                if item.recipient_id is None
            ],
        )
        amount = round_money(base * owner_config.split_percent / Decimal("100"))
        card_rule_id = None
        commission_rule_id = rule.id
        rule_snapshot = {
            "ruleType": "pf_commission",
            "ruleId": str(rule.id),
            "version": rule.version,
            "eligibleAmount": _money(eligible),
            "calculationMethod": rule.calculation_method,
            "caseOwnerSplitPercent": str(owner_config.split_percent),
            "effectiveAt": at.isoformat(),
        }
    earning = CaseEarning(
        id=new_uuid(),
        application_id=application.id,
        case_owner_id=application.case_owner_id,
        earning_type="card_points" if product_code == "CC" else "pf_commission",
        amount=round_money(amount),
        card_point_rule_id=card_rule_id,
        commission_rule_id=commission_rule_id,
        source_event_id=source_event.id,
        rule_snapshot=rule_snapshot,
        earned_at=at,
    )
    session.add(earning)
    await record_audit(
        session,
        action="case_operations.earning.post",
        entity_type="case_earning",
        entity_id=str(earning.id),
        actor_id=source_event.actor_id,
        target_user_id=application.case_owner_id,
        new_values={
            "applicationId": str(application.id),
            "earningType": earning.earning_type,
            "amount": _money(earning.amount),
            "ruleSnapshot": rule_snapshot,
        },
    )
    # Callers hold the Application row lock, so the read above and this unique
    # insert serialize concurrent closure/stage requests without rolling back
    # unrelated work in the surrounding transaction.
    await session.flush()
    return earning


async def _reversed_total(session: AsyncSession, earning_id: UUID) -> Decimal:
    return (
        await session.scalar(
            select(func.coalesce(func.sum(CaseEarningReversal.amount), 0)).where(
                CaseEarningReversal.earning_id == earning_id
            )
        )
    ) or Decimal("0")


async def list_earnings_for_clawback(session: AsyncSession, actor: User) -> dict[str, object]:
    """Return only the routed Coordinator's earnings with their reversible balance."""
    if not has_user_type(actor, "COD"):
        return {"items": []}
    rows = list(
        await session.scalars(
            select(CaseEarning)
            .join(Application, Application.id == CaseEarning.application_id)
            .where(Application.routed_coordinator_id == actor.id)
            .order_by(CaseEarning.earned_at.desc())
        )
    )
    items: list[dict[str, object]] = []
    for row in rows:
        application = await session.get(Application, row.application_id)
        reversed_amount = await _reversed_total(session, row.id)
        items.append(
            {
                "id": str(row.id),
                "applicationId": str(row.application_id),
                "applicationCode": application.application_code if application else None,
                "earningType": row.earning_type,
                "amount": _money(row.amount),
                "reversedAmount": _money(reversed_amount),
                "availableAmount": _money(row.amount - reversed_amount),
                "earnedAt": row.earned_at.isoformat(),
            }
        )
    return {"items": items}


async def create_clawback(
    session: AsyncSession, actor: User, payload: ClawbackCreateRequest
) -> dict[str, object]:
    earning = await session.scalar(
        select(CaseEarning).where(CaseEarning.id == payload.earning_id).with_for_update()
    )
    if earning is None:
        raise AppError(status_code=404, code="EARNING_NOT_FOUND", message="Earning not found")
    application = await session.get(Application, earning.application_id)
    if application is None or application.routed_coordinator_id != actor.id:
        raise AppError(status_code=404, code="EARNING_NOT_FOUND", message="Earning not found")
    amount = round_money(payload.amount)
    if earning.earning_type == "card_points" and amount != earning.amount:
        raise AppError(
            status_code=422,
            code="CARD_POINTS_FULL_REVERSAL_REQUIRED",
            message="Card Point clawbacks must reverse the exact original points",
        )
    remaining = earning.amount - await _reversed_total(session, earning.id)
    if amount > remaining:
        raise AppError(
            status_code=422,
            code="CLAWBACK_EXCEEDS_EARNING",
            message="Clawback exceeds the unreversed earning amount",
        )
    row = ClawbackRequest(
        id=new_uuid(),
        earning_id=earning.id,
        amount=amount,
        reason=payload.reason.strip(),
        status="pending",
        submitted_by_id=actor.id,
        submitted_at=utcnow(),
    )
    session.add(row)
    await record_audit(
        session,
        action="case_operations.clawback.submit",
        entity_type="case_clawback_request",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values={"earningId": str(earning.id), "amount": _money(amount)},
        note=row.reason,
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="CLAWBACK_ALREADY_PENDING",
            message="A clawback decision is already pending for this earning",
        ) from exc
    return await clawback_payload(session, row)


async def decide_clawback(
    session: AsyncSession,
    actor: User,
    request_id: UUID,
    payload: ClawbackDecisionRequest,
) -> dict[str, object]:
    row = await session.scalar(
        select(ClawbackRequest).where(ClawbackRequest.id == request_id).with_for_update()
    )
    if row is None:
        raise AppError(status_code=404, code="CLAWBACK_NOT_FOUND", message="Clawback not found")
    if row.status != "pending":
        raise AppError(
            status_code=409,
            code="CLAWBACK_ALREADY_DECIDED",
            message="This clawback has already been decided",
        )
    earning = await session.get(CaseEarning, row.earning_id)
    application = await session.get(Application, earning.application_id) if earning else None
    if earning is None or application is None:
        raise AppError(status_code=404, code="CLAWBACK_NOT_FOUND", message="Clawback not found")
    if has_user_type(actor, "SM") and application.routed_sales_manager_id != actor.id:
        raise AppError(status_code=404, code="CLAWBACK_NOT_FOUND", message="Clawback not found")
    if not has_user_type(actor, "SM", "GM", "OWNER"):
        raise AppError(status_code=403, code="FORBIDDEN", message="Approval is not available")
    if payload.decision == "reject" and not (payload.reason and payload.reason.strip()):
        raise AppError(
            status_code=422,
            code="CLAWBACK_REASON_REQUIRED",
            message="A rejection reason is required",
        )
    if payload.decision == "approve":
        remaining = earning.amount - await _reversed_total(session, earning.id)
        if row.amount > remaining:
            raise AppError(
                status_code=409,
                code="CLAWBACK_EARNING_CHANGED",
                message="The available earning balance changed; refresh and review again",
            )
        session.add(
            CaseEarningReversal(
                id=new_uuid(),
                earning_id=earning.id,
                clawback_request_id=row.id,
                amount=row.amount,
                approved_by_id=actor.id,
                reversed_at=utcnow(),
            )
        )
    row.status = "approved" if payload.decision == "approve" else "rejected"
    row.decided_by_id = actor.id
    row.decided_at = utcnow()
    row.decision_reason = payload.reason.strip() if payload.reason else None
    await record_audit(
        session,
        action=f"case_operations.clawback.{row.status}",
        entity_type="case_clawback_request",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values={"status": "pending"},
        new_values={"status": row.status, "amount": _money(row.amount)},
        note=row.decision_reason,
    )
    await session.commit()
    return await clawback_payload(session, row)


async def clawback_payload(session: AsyncSession, row: ClawbackRequest) -> dict[str, object]:
    earning = await session.get(CaseEarning, row.earning_id)
    application = await session.get(Application, earning.application_id) if earning else None
    return {
        "id": str(row.id),
        "earningId": str(row.earning_id),
        "applicationId": str(application.id) if application else None,
        "applicationCode": application.application_code if application else None,
        "earningType": earning.earning_type if earning else None,
        "amount": _money(row.amount),
        "reason": row.reason,
        "status": row.status,
        "submittedAt": row.submitted_at.isoformat(),
        "decisionReason": row.decision_reason,
    }


async def list_clawbacks(session: AsyncSession, actor: User) -> dict[str, object]:
    stmt = select(ClawbackRequest).order_by(ClawbackRequest.submitted_at.desc())
    if has_user_type(actor, "COD"):
        earning_ids = (
            select(CaseEarning.id)
            .join(Application, Application.id == CaseEarning.application_id)
            .where(Application.routed_coordinator_id == actor.id)
        )
        stmt = stmt.where(ClawbackRequest.earning_id.in_(earning_ids))
    elif has_user_type(actor, "SM"):
        earning_ids = (
            select(CaseEarning.id)
            .join(Application, Application.id == CaseEarning.application_id)
            .where(Application.routed_sales_manager_id == actor.id)
        )
        stmt = stmt.where(ClawbackRequest.earning_id.in_(earning_ids))
    elif not has_user_type(actor, "GM", "OWNER"):
        stmt = stmt.where(False)
    rows = list(await session.scalars(stmt))
    return {"items": [await clawback_payload(session, row) for row in rows]}
