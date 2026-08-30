from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from nexa_bos_api.applications.models import (
    Application,
    ApplicationCaseNumberHistory,
    ApplicationCodeCounter,
    ApplicationEvent,
    ApplicationOwnerHistory,
    Workflow,
    WorkflowStage,
    WorkflowTransition,
    new_uuid,
)
from nexa_bos_api.applications.schemas import (
    ApplicationCreateRequest,
    ApplicationUpdateRequest,
    CorrectSubmittedRequest,
    StageCorrectionRequest,
    StageUpdateRequest,
)
from nexa_bos_api.applications.seed import entry_stage, stage_by_key, utcnow
from nexa_bos_api.applications.tat import (
    occupancy_by_stage,
    on_stage_corrected,
    on_successful_stage_movement,
    on_terminal_outcome,
    open_occupancy,
    serialize_occupancy,
    tat_fields,
)
from nexa_bos_api.applications.visibility import apply_owner_filter, visible_case_owner_ids
from nexa_bos_api.applications.workflow_service import latest_active_workflow, load_workflow
from nexa_bos_api.catalog.models import Bank, BankProduct, Product
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.customers.models import Customer
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import (
    ApplicationEventType,
    CustomerStatus,
    MasterStatus,
    StageSystemKey,
    TerminalOutcome,
)
from nexa_bos_api.identity.models import Department, Office, Team, User


def _money(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value.quantize(Decimal("0.01")), "f")


def _blank(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


async def serialize_application(
    session: AsyncSession, application: Application
) -> dict[str, object]:
    customer = await session.get(Customer, application.customer_id)
    bank = await session.get(Bank, application.bank_id)
    product = await session.get(Product, application.product_id)
    stage = await session.get(WorkflowStage, application.current_stage_id)
    workflow = await session.get(Workflow, application.workflow_id)
    owner = await session.get(User, application.case_owner_id)
    return {
        "id": str(application.id),
        "applicationCode": application.application_code,
        "customerId": str(application.customer_id),
        "customerCode": customer.customer_code if customer else None,
        "customerName": (customer.full_name or customer.company_name) if customer else None,
        "customerMobile": customer.mobile if customer else None,
        "bankId": str(application.bank_id),
        "bankCode": bank.code if bank else None,
        "bankName": bank.name if bank else None,
        "productId": str(application.product_id),
        "productCode": product.code if product else None,
        "productName": product.name if product else None,
        "workflowId": str(application.workflow_id),
        "workflowVersion": workflow.version if workflow else None,
        "currentStageId": str(application.current_stage_id),
        "currentStage": stage.name if stage else None,
        "currentStageKey": stage.system_key if stage else None,
        "terminalOutcome": application.terminal_outcome,
        "terminalReason": application.terminal_reason,
        "caseOwnerId": str(application.case_owner_id),
        "caseOwnerName": owner.full_name if owner else None,
        "caseOwnerOfficeId": str(owner.office_id) if owner and owner.office_id else None,
        "caseOwnerDepartmentId": str(owner.department_id)
        if owner and owner.department_id
        else None,
        "caseOwnerTeamId": str(owner.team_id) if owner and owner.team_id else None,
        "requestedAmount": _money(application.requested_amount),
        "approvedAmount": _money(application.approved_amount),
        "bookedAmount": _money(application.booked_amount),
        "fundedAmount": _money(application.funded_amount),
        "bankCaseNumber": application.bank_case_number,
        "submittedAt": application.submitted_at.isoformat() if application.submitted_at else None,
        "submittedById": str(application.submitted_by_id) if application.submitted_by_id else None,
        "approvedAt": application.approved_at.isoformat() if application.approved_at else None,
        "bookedAt": application.booked_at.isoformat() if application.booked_at else None,
        "fundReleasedAt": (
            application.fund_released_at.isoformat() if application.fund_released_at else None
        ),
        "completedAt": application.completed_at.isoformat() if application.completed_at else None,
        "createdAt": application.created_at.isoformat(),
        "updatedAt": application.updated_at.isoformat(),
        "submitted": application.submitted_at is not None,
        "terminal": application.terminal_outcome is not None,
        **(await tat_fields(session, application)),
    }


async def next_application_code(session: AsyncSession, product: Product, bank: Bank) -> str:
    year = datetime.now(UTC).year
    counter = await session.get(ApplicationCodeCounter, (product.code, bank.code, year))
    if counter is None:
        counter = ApplicationCodeCounter(
            product_code=product.code, bank_code=bank.code, year=year, last_value=0
        )
        session.add(counter)
        await session.flush()
    counter.last_value += 1
    return f"{product.code}-{bank.code}-{year}-{counter.last_value:06d}"


async def _require_mapping(session: AsyncSession, bank: Bank, product: Product) -> None:
    if bank.status != MasterStatus.ACTIVE or product.status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=422,
            code="BANK_PRODUCT_INACTIVE",
            message="Bank and Product must both be active",
        )
    mapping = (
        await session.execute(
            select(BankProduct).where(
                BankProduct.bank_id == bank.id,
                BankProduct.product_id == product.id,
                BankProduct.status == MasterStatus.ACTIVE,
            )
        )
    ).scalar_one_or_none()
    if mapping is None:
        raise AppError(
            status_code=422,
            code="BANK_PRODUCT_MAPPING_REQUIRED",
            message="An active Bank-Product mapping is required",
        )


async def _require_case_owner(session: AsyncSession, owner_id: UUID) -> User:
    owner = (
        await session.execute(
            select(User).options(selectinload(User.user_type)).where(User.id == owner_id)
        )
    ).scalar_one_or_none()
    if owner is None or owner.user_type is None or not owner.user_type.can_be_case_owner:
        raise AppError(
            status_code=422,
            code="CASE_OWNER_INELIGIBLE",
            message="Selected user cannot be Case Owner",
        )
    return owner


def _reject_terminal(application: Application) -> None:
    if application.terminal_outcome:
        raise AppError(
            status_code=422,
            code="APPLICATION_TERMINAL",
            message="Terminal applications cannot be changed or reopened",
        )


async def _assert_active_unique(
    session: AsyncSession, customer_id: UUID, bank_id: UUID, product_id: UUID
) -> None:
    existing = (
        await session.execute(
            select(Application.id).where(
                Application.customer_id == customer_id,
                Application.bank_id == bank_id,
                Application.product_id == product_id,
                Application.terminal_outcome.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(
            status_code=409,
            code="APPLICATION_ACTIVE_DUPLICATE",
            message="This customer already has an active application for this Bank and Product",
        )


async def _add_event(
    session: AsyncSession,
    *,
    application: Application,
    event_type: str,
    actor_id: UUID,
    previous_stage_id: UUID | None = None,
    new_stage_id: UUID | None = None,
    bank_stage_date: date | None = None,
    stage_note: str | None = None,
    payload: dict | None = None,
    reason: str | None = None,
    correction_of_event_id: UUID | None = None,
    at: datetime | None = None,
) -> ApplicationEvent:
    event = ApplicationEvent(
        id=new_uuid(),
        application_id=application.id,
        event_type=event_type,
        previous_stage_id=previous_stage_id,
        new_stage_id=new_stage_id,
        bank_stage_date=bank_stage_date,
        stage_note=stage_note,
        bos_updated_at=at or utcnow(),
        actor_id=actor_id,
        payload=payload,
        correction_of_event_id=correction_of_event_id,
        reason=reason,
    )
    session.add(event)
    return event


async def _open_owner_history(
    session: AsyncSession, application: Application, owner: User, at: datetime
) -> None:
    current = (
        await session.execute(
            select(ApplicationOwnerHistory).where(
                ApplicationOwnerHistory.application_id == application.id,
                ApplicationOwnerHistory.effective_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if current:
        current.effective_to = at
    office = await session.get(Office, owner.office_id) if owner.office_id else None
    department = await session.get(Department, owner.department_id) if owner.department_id else None
    team = await session.get(Team, owner.team_id) if owner.team_id else None
    session.add(
        ApplicationOwnerHistory(
            id=new_uuid(),
            application_id=application.id,
            owner_id=owner.id,
            office_id=owner.office_id,
            department_id=owner.department_id,
            team_id=owner.team_id,
            office_name=office.name if office else None,
            department_name=department.name if department else None,
            team_name=team.name if team else None,
            effective_from=at,
            effective_to=None,
        )
    )


async def _transition_allowed(
    session: AsyncSession, workflow_id: UUID, source: UUID, target: UUID
) -> bool:
    row = (
        await session.execute(
            select(WorkflowTransition.id).where(
                WorkflowTransition.workflow_id == workflow_id,
                WorkflowTransition.from_stage_id == source,
                WorkflowTransition.to_stage_id == target,
            )
        )
    ).scalar_one_or_none()
    return row is not None


async def _validate_bank_date(
    session: AsyncSession, application_id: UUID, bank_stage_date: date, *, correction: bool
) -> None:
    today = datetime.now(UTC).date()
    if bank_stage_date > today:
        raise AppError(
            status_code=422,
            code="BANK_STAGE_DATE_FUTURE",
            message="Bank Stage Date cannot be in the future",
        )
    if correction:
        return
    latest = (
        await session.execute(
            select(ApplicationEvent.bank_stage_date)
            .where(
                ApplicationEvent.application_id == application_id,
                ApplicationEvent.bank_stage_date.is_not(None),
            )
            .order_by(ApplicationEvent.bos_updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if latest is not None and bank_stage_date < latest:
        raise AppError(
            status_code=422,
            code="BANK_STAGE_DATE_ORDER",
            message="Normal Bank Stage Dates must be chronological",
        )


async def get_visible_application(
    session: AsyncSession, actor: User, application_id: UUID
) -> Application:
    application = await session.get(Application, application_id)
    if application is None:
        raise AppError(
            status_code=404, code="APPLICATION_NOT_FOUND", message="Application not found"
        )
    allowed = await visible_case_owner_ids(session, actor)
    if allowed is not None and application.case_owner_id not in allowed:
        raise AppError(
            status_code=404,
            code="APPLICATION_NOT_FOUND",
            message="Application not found",
        )
    return application


async def create_application(
    session: AsyncSession, actor: User, payload: ApplicationCreateRequest
) -> Application:
    customer = await session.get(Customer, payload.customer_id)
    if customer is None or customer.status == CustomerStatus.MERGED:
        raise AppError(status_code=404, code="CUSTOMER_NOT_FOUND", message="Customer not found")
    if customer.status != CustomerStatus.ACTIVE:
        raise AppError(
            status_code=422,
            code="CUSTOMER_INACTIVE",
            message="Applications can only be created for an active customer",
        )
    bank = await session.get(Bank, payload.bank_id)
    product = await session.get(Product, payload.product_id)
    if bank is None or product is None:
        raise AppError(
            status_code=404, code="BANK_PRODUCT_NOT_FOUND", message="Bank or Product not found"
        )
    await _require_mapping(session, bank, product)
    owner = await _require_case_owner(session, payload.case_owner_id)
    await _assert_active_unique(session, customer.id, bank.id, product.id)
    if product.requested_amount_required and payload.requested_amount is None:
        raise AppError(
            status_code=422,
            code="REQUESTED_AMOUNT_REQUIRED",
            message="Requested Amount is required for this product",
        )
    workflow = await latest_active_workflow(session, bank.id, product.id)
    start = entry_stage(workflow)
    now = utcnow()
    application = Application(
        id=new_uuid(),
        application_code=await next_application_code(session, product, bank),
        customer_id=customer.id,
        bank_id=bank.id,
        product_id=product.id,
        workflow_id=workflow.id,
        current_stage_id=start.id,
        terminal_outcome=None,
        case_owner_id=owner.id,
        created_by_id=actor.id,
        requested_amount=payload.requested_amount,
        created_at=now,
        updated_at=now,
    )
    session.add(application)
    await session.flush()
    await _open_owner_history(session, application, owner, now)
    await _add_event(
        session,
        application=application,
        event_type=ApplicationEventType.CREATED,
        actor_id=actor.id,
        new_stage_id=start.id,
        payload={"applicationCode": application.application_code},
        at=now,
    )
    await open_occupancy(
        session,
        application,
        stage_id=start.id,
        actor_id=actor.id,
        at=now,
    )
    case_number = _blank(payload.bank_case_number)
    if case_number:
        await _first_or_correct_case_number(session, actor, application, case_number, reason=None)
    await record_audit(
        session,
        action="application.create",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        new_values={"applicationCode": application.application_code},
    )
    await session.commit()
    return (await session.get(Application, application.id)) or application


async def _first_or_correct_case_number(
    session: AsyncSession,
    actor: User,
    application: Application,
    value: str,
    *,
    reason: str | None,
) -> None:
    normalized = value.strip()
    duplicate = (
        await session.execute(
            select(Application.id).where(
                Application.bank_id == application.bank_id,
                Application.bank_case_number == normalized,
                Application.id != application.id,
            )
        )
    ).scalar_one_or_none()
    if duplicate is not None:
        raise AppError(
            status_code=409,
            code="BANK_CASE_NUMBER_DUPLICATE",
            message="Bank File / Case Number must be unique within the same Bank",
        )
    now = utcnow()
    current = (
        await session.execute(
            select(ApplicationCaseNumberHistory).where(
                ApplicationCaseNumberHistory.application_id == application.id,
                ApplicationCaseNumberHistory.effective_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    first = application.submitted_at is None
    if current:
        current.effective_to = now
    session.add(
        ApplicationCaseNumberHistory(
            id=new_uuid(),
            application_id=application.id,
            value=normalized,
            effective_from=now,
            effective_to=None,
            changed_by_id=actor.id,
            reason=reason,
        )
    )
    application.bank_case_number = normalized
    application.updated_at = now
    if first:
        workflow = await load_workflow(session, application.workflow_id)
        submitted = stage_by_key(workflow, StageSystemKey.SUBMITTED)
        if submitted is None:
            raise AppError(
                status_code=422,
                code="SUBMITTED_STAGE_MISSING",
                message="This workflow has no Submitted stage",
            )
        previous = application.current_stage_id
        if previous != submitted.id and not await _transition_allowed(
            session, workflow.id, previous, submitted.id
        ):
            raise AppError(
                status_code=422,
                code="TRANSITION_NOT_ALLOWED",
                message="Submission is not an allowed transition on this workflow",
            )
        application.submitted_at = now
        application.submitted_by_id = actor.id
        application.current_stage_id = submitted.id
        application.submitted_snapshot = {
            "customerId": str(application.customer_id),
            "bankId": str(application.bank_id),
            "productId": str(application.product_id),
            "caseOwnerId": str(application.case_owner_id),
            "requestedAmount": _money(application.requested_amount),
        }
        await _add_event(
            session,
            application=application,
            event_type=ApplicationEventType.SUBMISSION,
            actor_id=actor.id,
            previous_stage_id=previous,
            new_stage_id=submitted.id,
            payload={"bankCaseNumber": normalized},
            at=now,
        )
        await on_successful_stage_movement(
            session,
            application,
            actor_id=actor.id,
            at=now,
            previous_stage_id=previous,
            new_stage_id=submitted.id,
        )
    else:
        await _add_event(
            session,
            application=application,
            event_type=ApplicationEventType.CASE_NUMBER_CORRECTED,
            actor_id=actor.id,
            payload={"bankCaseNumber": normalized},
            reason=reason,
        )


def _list_stmt() -> Select:
    owner = aliased(User)
    return (
        select(Application)
        .join(Customer, Application.customer_id == Customer.id)
        .join(Bank, Application.bank_id == Bank.id)
        .join(Product, Application.product_id == Product.id)
        .join(owner, Application.case_owner_id == owner.id)
        .join(WorkflowStage, Application.current_stage_id == WorkflowStage.id)
        .outerjoin(Office, owner.office_id == Office.id)
        .outerjoin(Department, owner.department_id == Department.id)
        .outerjoin(Team, owner.team_id == Team.id)
    )


async def list_applications(
    session: AsyncSession,
    actor: User,
    filters: dict[str, str | None],
) -> list[Application]:
    stmt = _list_stmt()
    allowed = await visible_case_owner_ids(session, actor)
    stmt = apply_owner_filter(stmt, allowed)
    mapping = {
        "application_id": Application.application_code,
        "bank_case_number": Application.bank_case_number,
        "customer_code": Customer.customer_code,
        "customer_name": func.coalesce(Customer.full_name, Customer.company_name),
        "customer_mobile": Customer.mobile,
        "bank_id": Application.bank_id,
        "product_id": Application.product_id,
        "office_id": Office.id,
        "department_id": Department.id,
        "team_id": Team.id,
        "current_stage_id": Application.current_stage_id,
        "terminal_outcome": Application.terminal_outcome,
    }
    uuid_keys = {
        "bank_id",
        "product_id",
        "office_id",
        "department_id",
        "team_id",
        "current_stage_id",
    }
    for key, column in mapping.items():
        value = filters.get(key)
        if not value:
            continue
        if key in uuid_keys:
            stmt = stmt.where(column == UUID(value))
        elif key == "terminal_outcome":
            stmt = stmt.where(column == value)
        else:
            stmt = stmt.where(func.lower(func.coalesce(column, "")).like(f"%{value.lower()}%"))
    owner_filter = filters.get("case_owner_id")
    if owner_filter:
        owner_uuid = UUID(owner_filter)
        historical = select(ApplicationOwnerHistory.application_id).where(
            ApplicationOwnerHistory.owner_id == owner_uuid
        )
        stmt = stmt.where(
            or_(Application.case_owner_id == owner_uuid, Application.id.in_(historical))
        )
    if filters.get("q"):
        like = f"%{filters['q'].lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Application.application_code).like(like),
                func.lower(func.coalesce(Application.bank_case_number, "")).like(like),
                func.lower(Customer.customer_code).like(like),
                func.lower(func.coalesce(Customer.full_name, "")).like(like),
                func.lower(func.coalesce(Customer.company_name, "")).like(like),
                func.lower(Customer.mobile).like(like),
            )
        )
    for field, column in (
        ("submission_from", Application.submitted_at),
        ("created_from", Application.created_at),
    ):
        value = filters.get(field)
        if value:
            stmt = stmt.where(column >= datetime.fromisoformat(value))
    for field, column in (
        ("submission_to", Application.submitted_at),
        ("created_to", Application.created_at),
    ):
        value = filters.get(field)
        if value:
            stmt = stmt.where(column <= datetime.fromisoformat(value))
    if filters.get("bank_stage_date"):
        stmt = stmt.where(
            Application.id.in_(
                select(ApplicationEvent.application_id).where(
                    ApplicationEvent.bank_stage_date
                    == date.fromisoformat(filters["bank_stage_date"])
                )
            )
        )
    stage_from = filters.get("bank_stage_from")
    stage_to = filters.get("bank_stage_to")
    if stage_from or stage_to:
        date_stmt = select(ApplicationEvent.application_id).where(
            ApplicationEvent.bank_stage_date.is_not(None)
        )
        if stage_from:
            date_stmt = date_stmt.where(
                ApplicationEvent.bank_stage_date >= date.fromisoformat(stage_from)
            )
        if stage_to:
            date_stmt = date_stmt.where(
                ApplicationEvent.bank_stage_date <= date.fromisoformat(stage_to)
            )
        stmt = stmt.where(Application.id.in_(date_stmt))
    for prefix, column in (
        ("requested", Application.requested_amount),
        ("approved", Application.approved_amount),
        ("booked", Application.booked_amount),
        ("funded", Application.funded_amount),
    ):
        low = filters.get(f"{prefix}_min")
        high = filters.get(f"{prefix}_max")
        if low:
            stmt = stmt.where(column >= Decimal(low))
        if high:
            stmt = stmt.where(column <= Decimal(high))
    stmt = stmt.order_by(Application.created_at.desc())
    return list((await session.execute(stmt)).scalars().unique().all())


async def list_referenced_case_owners(session: AsyncSession, actor: User) -> list[User]:
    allowed = await visible_case_owner_ids(session, actor)
    visible_apps = apply_owner_filter(select(Application.id), allowed)
    current_ids = select(Application.case_owner_id).where(Application.id.in_(visible_apps))
    historical_ids = select(ApplicationOwnerHistory.owner_id).where(
        ApplicationOwnerHistory.application_id.in_(visible_apps)
    )
    owner_ids = {
        *(await session.execute(current_ids)).scalars().all(),
        *(await session.execute(historical_ids)).scalars().all(),
    }
    if not owner_ids:
        return []
    stmt = select(User).where(User.id.in_(owner_ids)).order_by(User.user_code)
    return list((await session.execute(stmt)).scalars().all())


async def list_customer_applications(
    session: AsyncSession, actor: User, customer_id: UUID
) -> list[Application]:
    allowed = await visible_case_owner_ids(session, actor)
    stmt = select(Application).where(Application.customer_id == customer_id)
    stmt = apply_owner_filter(stmt, allowed)
    return list(
        (await session.execute(stmt.order_by(Application.created_at.desc()))).scalars().all()
    )


async def update_application(
    session: AsyncSession, actor: User, application: Application, payload: ApplicationUpdateRequest
) -> Application:
    _reject_terminal(application)
    submitted = application.submitted_at is not None
    data = payload.model_dump(exclude_unset=True)
    if "bank_case_number" in data:
        value = _blank(payload.bank_case_number)
        if value and value != application.bank_case_number:
            if submitted:
                raise AppError(
                    status_code=422,
                    code="CASE_NUMBER_LOCKED",
                    message="Use the Bank Case Number correction flow after submission",
                )
            await _first_or_correct_case_number(session, actor, application, value, reason=None)
        data.pop("bank_case_number", None)
    if submitted:
        locked = {"requested_amount", "approved_amount", "booked_amount", "funded_amount"}
        if locked.intersection(data):
            raise AppError(
                status_code=422,
                code="SUBMITTED_DATA_LOCKED",
                message="Submitted core data requires Applications.CorrectSubmittedData",
            )
    for field in ("requested_amount", "approved_amount", "booked_amount", "funded_amount"):
        if field in data:
            setattr(application, field, data[field])
    application.updated_at = utcnow()
    await record_audit(
        session,
        action="application.update",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        new_values=data,
    )
    await session.commit()
    return application


async def save_case_number(
    session: AsyncSession, actor: User, application: Application, value: str, reason: str | None
) -> Application:
    _reject_terminal(application)
    if application.submitted_at is not None and not reason:
        raise AppError(
            status_code=422,
            code="CORRECTION_REASON_REQUIRED",
            message="A reason is required to correct a Bank File / Case Number",
        )
    await _first_or_correct_case_number(session, actor, application, value, reason=reason)
    await session.commit()
    return application


async def correct_submitted(
    session: AsyncSession, actor: User, application: Application, payload: CorrectSubmittedRequest
) -> Application:
    _reject_terminal(application)
    if application.submitted_at is None:
        raise AppError(
            status_code=422,
            code="NOT_SUBMITTED",
            message="Submitted-data correction applies after submission",
        )
    old = {
        "requestedAmount": _money(application.requested_amount),
        "approvedAmount": _money(application.approved_amount),
        "bookedAmount": _money(application.booked_amount),
        "fundedAmount": _money(application.funded_amount),
    }
    if payload.requested_amount is not None:
        application.requested_amount = payload.requested_amount
    if payload.approved_amount is not None:
        application.approved_amount = payload.approved_amount
    if payload.booked_amount is not None:
        application.booked_amount = payload.booked_amount
    if payload.funded_amount is not None:
        application.funded_amount = payload.funded_amount
    application.updated_at = utcnow()
    await _add_event(
        session,
        application=application,
        event_type=ApplicationEventType.SUBMITTED_DATA_CORRECTED,
        actor_id=actor.id,
        reason=payload.reason,
        payload={
            "old": old,
            "new": {
                "requestedAmount": _money(application.requested_amount),
                "approvedAmount": _money(application.approved_amount),
                "bookedAmount": _money(application.booked_amount),
                "fundedAmount": _money(application.funded_amount),
            },
        },
    )
    await record_audit(
        session,
        action="application.correct_submitted",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        note=payload.reason,
        old_values=old,
    )
    await session.commit()
    return application


async def reassign_case_owner(
    session: AsyncSession, actor: User, application: Application, owner_id: UUID, reason: str | None
) -> Application:
    _reject_terminal(application)
    owner = await _require_case_owner(session, owner_id)
    previous = application.case_owner_id
    now = utcnow()
    application.case_owner_id = owner.id
    application.updated_at = now
    await _open_owner_history(session, application, owner, now)
    await _add_event(
        session,
        application=application,
        event_type=ApplicationEventType.CASE_OWNER_REASSIGNED,
        actor_id=actor.id,
        reason=reason,
        payload={"fromOwnerId": str(previous), "toOwnerId": str(owner.id)},
    )
    await record_audit(
        session,
        action="application.reassign_owner",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        old_values={"caseOwnerId": str(previous)},
        new_values={"caseOwnerId": str(owner.id)},
        note=reason,
    )
    await session.commit()
    return application


async def _apply_system_stage_side_effects(
    session: AsyncSession,
    actor: User,
    application: Application,
    stage: WorkflowStage,
    payload: StageUpdateRequest,
) -> str:
    product = await session.get(Product, application.product_id)
    event_type = ApplicationEventType.STAGE_MOVED
    if stage.system_key == StageSystemKey.RETURNED:
        if not _blank(payload.requirement_text):
            raise AppError(
                status_code=422,
                code="REQUIREMENT_TEXT_REQUIRED",
                message="Returned / Requirement Pending requires a manual requirement reason",
            )
        event_type = ApplicationEventType.RETURNED
    elif stage.system_key == StageSystemKey.RESUBMITTED:
        event_type = ApplicationEventType.RESUBMISSION
    elif stage.system_key == StageSystemKey.APPROVED:
        amount = (
            payload.approved_amount
            if payload.approved_amount is not None
            else application.approved_amount
        )
        if product and product.approved_amount_required and amount is None:
            raise AppError(
                status_code=422,
                code="APPROVED_AMOUNT_REQUIRED",
                message="Approved Amount is required for this product",
            )
        application.approved_amount = amount
        application.approved_at = utcnow()
        event_type = ApplicationEventType.APPROVAL
    elif stage.system_key == StageSystemKey.BOOKED:
        amount = (
            payload.booked_amount
            if payload.booked_amount is not None
            else application.booked_amount
        )
        if product and product.booked_amount_required and amount is None:
            raise AppError(
                status_code=422,
                code="BOOKED_AMOUNT_REQUIRED",
                message="Booked Amount is required for this product",
            )
        application.booked_amount = amount
        application.booked_at = utcnow()
        event_type = ApplicationEventType.BOOKING
    elif stage.system_key == StageSystemKey.FUND_RELEASED:
        amount = (
            payload.funded_amount
            if payload.funded_amount is not None
            else application.funded_amount
        )
        if product and product.funded_amount_required and amount is None:
            raise AppError(
                status_code=422,
                code="FUNDED_AMOUNT_REQUIRED",
                message="Funded Amount is required for this product",
            )
        application.funded_amount = amount
        application.fund_released_at = utcnow()
        application.terminal_outcome = TerminalOutcome.COMPLETED
        application.completed_at = utcnow()
        event_type = ApplicationEventType.FUND_RELEASE
    return event_type


async def update_stage(
    session: AsyncSession,
    actor: User,
    application: Application,
    payload: StageUpdateRequest,
    *,
    correction: bool = False,
) -> Application:
    _reject_terminal(application)
    await _validate_bank_date(
        session, application.id, payload.bank_stage_date, correction=correction
    )
    target = await session.get(WorkflowStage, payload.stage_id)
    if target is None or target.workflow_id != application.workflow_id:
        raise AppError(
            status_code=422, code="STAGE_NOT_IN_WORKFLOW", message="Stage is not on this workflow"
        )
    if target.status != MasterStatus.ACTIVE:
        raise AppError(status_code=422, code="STAGE_INACTIVE", message="Target stage is inactive")
    previous = application.current_stage_id
    if previous != target.id and not await _transition_allowed(
        session, application.workflow_id, previous, target.id
    ):
        raise AppError(
            status_code=422,
            code="TRANSITION_NOT_ALLOWED",
            message="That stage transition is not configured",
        )
    event_type = await _apply_system_stage_side_effects(
        session, actor, application, target, payload
    )
    application.current_stage_id = target.id
    now = utcnow()
    application.updated_at = now
    stage_note = _blank(payload.stage_note) or _blank(payload.requirement_text)
    stage_event = await _add_event(
        session,
        application=application,
        event_type=event_type,
        actor_id=actor.id,
        previous_stage_id=previous,
        new_stage_id=target.id,
        bank_stage_date=payload.bank_stage_date,
        stage_note=stage_note,
        payload={"resubmittedAt": now.isoformat()}
        if event_type == ApplicationEventType.RESUBMISSION
        else None,
        at=now,
    )
    if event_type == ApplicationEventType.FUND_RELEASE:
        await _add_event(
            session,
            application=application,
            event_type=ApplicationEventType.COMPLETED,
            actor_id=actor.id,
            new_stage_id=target.id,
            at=now,
        )
    await on_successful_stage_movement(
        session,
        application,
        actor_id=actor.id,
        at=now,
        previous_stage_id=previous,
        new_stage_id=target.id,
        bank_stage_date=payload.bank_stage_date,
        stage_note=stage_note,
    )
    await record_audit(
        session,
        action="application.stage",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        new_values={"stageId": str(target.id), "eventType": event_type},
    )
    from nexa_bos_api.notifications.enums import NotificationEventType
    from nexa_bos_api.notifications.service import dispatch_source_event

    await dispatch_source_event(
        session,
        event_type=NotificationEventType.APPLICATION_STAGE_CHANGED,
        source_event_key=str(stage_event.id),
        affected_user_id=application.case_owner_id,
        linked_entity_type="application",
        linked_entity_id=str(application.id),
        contextual_link=f"/applications/{application.id}",
        actor_id=actor.id,
    )
    await session.commit()
    return application


async def correct_stage(
    session: AsyncSession, actor: User, application: Application, payload: StageCorrectionRequest
) -> Application:
    _reject_terminal(application)
    await _validate_bank_date(session, application.id, payload.bank_stage_date, correction=True)
    target = await session.get(WorkflowStage, payload.stage_id)
    if target is None or target.workflow_id != application.workflow_id:
        raise AppError(
            status_code=422, code="STAGE_NOT_IN_WORKFLOW", message="Stage is not on this workflow"
        )
    previous = application.current_stage_id
    application.current_stage_id = target.id
    now = utcnow()
    application.updated_at = now
    await _add_event(
        session,
        application=application,
        event_type=ApplicationEventType.STAGE_CORRECTED,
        actor_id=actor.id,
        previous_stage_id=previous,
        new_stage_id=target.id,
        bank_stage_date=payload.bank_stage_date,
        stage_note=_blank(payload.stage_note),
        reason=payload.reason,
        correction_of_event_id=payload.correction_of_event_id,
        at=now,
    )
    await on_stage_corrected(
        session,
        application,
        actor_id=actor.id,
        at=now,
        previous_stage_id=previous,
        new_stage_id=target.id,
        bank_stage_date=payload.bank_stage_date,
        stage_note=_blank(payload.stage_note),
    )
    await record_audit(
        session,
        action="application.correct_stage",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        note=payload.reason,
    )
    await session.commit()
    return application


async def set_outcome(
    session: AsyncSession,
    actor: User,
    application: Application,
    outcome: TerminalOutcome,
    reason: str,
) -> Application:
    _reject_terminal(application)
    if outcome is TerminalOutcome.COMPLETED:
        raise AppError(
            status_code=422,
            code="COMPLETED_AUTOMATIC",
            message="Completed is created automatically on Fund Released",
        )
    now = utcnow()
    application.terminal_outcome = outcome
    application.terminal_reason = reason.strip()
    application.updated_at = now
    event_map = {
        TerminalOutcome.FINAL_REJECTED: ApplicationEventType.FINAL_REJECTED,
        TerminalOutcome.CANCELLED: ApplicationEventType.CANCELLED,
        TerminalOutcome.WITHDRAWN: ApplicationEventType.WITHDRAWN,
    }
    await _add_event(
        session,
        application=application,
        event_type=event_map[outcome],
        actor_id=actor.id,
        reason=reason.strip(),
        at=now,
    )
    await on_terminal_outcome(session, application, actor_id=actor.id, at=now)
    await record_audit(
        session,
        action="application.outcome",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        new_values={"outcome": outcome},
        note=reason,
    )
    await session.commit()
    return application


async def migrate_application(
    session: AsyncSession,
    actor: User,
    application: Application,
    workflow_id: UUID,
    target_stage_id: UUID,
    reason: str,
) -> Application:
    _reject_terminal(application)
    target_workflow = await load_workflow(session, workflow_id)
    if (
        target_workflow.bank_id != application.bank_id
        or target_workflow.product_id != application.product_id
    ):
        raise AppError(
            status_code=422,
            code="WORKFLOW_BANK_PRODUCT_MISMATCH",
            message="Target workflow must be for the same Bank and Product",
        )
    target_stage = next((row for row in target_workflow.stages if row.id == target_stage_id), None)
    if target_stage is None or target_stage.status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=422,
            code="MIGRATE_STAGE_INVALID",
            message="Select an active stage from the target workflow",
        )
    old_workflow = application.workflow_id
    old_stage = application.current_stage_id
    application.workflow_id = target_workflow.id
    application.current_stage_id = target_stage.id
    now = utcnow()
    application.updated_at = now
    await _add_event(
        session,
        application=application,
        event_type=ApplicationEventType.WORKFLOW_MIGRATED,
        actor_id=actor.id,
        previous_stage_id=old_stage,
        new_stage_id=target_stage.id,
        reason=reason,
        payload={
            "fromWorkflowId": str(old_workflow),
            "toWorkflowId": str(target_workflow.id),
            "toVersion": target_workflow.version,
        },
        at=now,
    )
    await on_successful_stage_movement(
        session,
        application,
        actor_id=actor.id,
        at=now,
        previous_stage_id=old_stage,
        new_stage_id=target_stage.id,
        stage_note=reason,
    )
    await record_audit(
        session,
        action="application.migrate_workflow",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        note=reason,
    )
    await session.commit()
    return application


async def application_timeline(session: AsyncSession, application: Application) -> list[dict]:
    events = (
        (
            await session.execute(
                select(ApplicationEvent)
                .where(ApplicationEvent.application_id == application.id)
                .order_by(ApplicationEvent.bos_updated_at.asc())
            )
        )
        .scalars()
        .all()
    )
    items = []
    for event in events:
        actor = await session.get(User, event.actor_id)
        previous = (
            await session.get(WorkflowStage, event.previous_stage_id)
            if event.previous_stage_id
            else None
        )
        new = await session.get(WorkflowStage, event.new_stage_id) if event.new_stage_id else None
        items.append(
            {
                "id": str(event.id),
                "eventType": event.event_type,
                "previousStage": previous.name if previous else None,
                "newStage": new.name if new else None,
                "bankStageDate": event.bank_stage_date.isoformat()
                if event.bank_stage_date
                else None,
                "stageNote": event.stage_note,
                "bosUpdatedAt": event.bos_updated_at.isoformat(),
                "updatedBy": actor.full_name if actor else None,
                "updatedById": str(event.actor_id),
                "reason": event.reason,
                "payload": event.payload,
                "correctionOfEventId": (
                    str(event.correction_of_event_id) if event.correction_of_event_id else None
                ),
            }
        )
    return items


async def application_progress(
    session: AsyncSession, application: Application
) -> dict[str, object]:
    workflow = await load_workflow(session, application.workflow_id)
    latest = await occupancy_by_stage(session, application)
    now = utcnow()
    tat = await tat_fields(session, application)
    stages = []
    for row in sorted(workflow.stages, key=lambda item: item.sort_order):
        if row.status != MasterStatus.ACTIVE:
            continue
        item = serialize_progress_stage(row, application.current_stage_id)
        occupancy = latest.get(str(row.id))
        if occupancy is not None:
            item.update(await serialize_occupancy(session, occupancy, now=now))
            item["id"] = str(row.id)
            item["current"] = row.id == application.current_stage_id
        stages.append(item)
    return {
        "workflowId": str(workflow.id),
        "version": workflow.version,
        "currentStageId": str(application.current_stage_id),
        "activeDelay": tat["activeDelay"],
        "currentStageElapsedSeconds": tat["currentStageElapsedSeconds"],
        "stages": stages,
    }


def serialize_progress_stage(stage: WorkflowStage, current_id: UUID) -> dict[str, object]:
    return {
        "id": str(stage.id),
        "name": stage.name,
        "code": stage.code,
        "systemKey": stage.system_key,
        "current": stage.id == current_id,
        "sortOrder": stage.sort_order,
    }


async def has_active_applications(session: AsyncSession, customer_id: UUID) -> bool:
    count = (
        await session.execute(
            select(func.count())
            .select_from(Application)
            .where(
                Application.customer_id == customer_id,
                Application.terminal_outcome.is_(None),
            )
        )
    ).scalar_one()
    return int(count) > 0


async def relink_applications(
    session: AsyncSession, source_id: UUID, primary_id: UUID, actor_id: UUID
) -> None:
    rows = (
        (await session.execute(select(Application).where(Application.customer_id == source_id)))
        .scalars()
        .all()
    )
    for application in rows:
        application.customer_id = primary_id
        application.updated_at = utcnow()
        await _add_event(
            session,
            application=application,
            event_type=ApplicationEventType.CUSTOMER_RELINKED,
            actor_id=actor_id,
            payload={"fromCustomerId": str(source_id), "toCustomerId": str(primary_id)},
        )
