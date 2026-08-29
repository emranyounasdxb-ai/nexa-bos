from __future__ import annotations

from datetime import UTC, datetime
from difflib import SequenceMatcher
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.customers.models import (
    Customer,
    CustomerCodeCounter,
    CustomerFieldHistory,
    CustomerIdentifierHistory,
    CustomerMerge,
    new_uuid,
)
from nexa_bos_api.customers.schemas import CustomerCreateRequest, CustomerUpdateRequest
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import (
    CustomerField,
    CustomerIdentifierKind,
    CustomerStatus,
    CustomerType,
)
from nexa_bos_api.identity.models import User


def utcnow() -> datetime:
    return datetime.now(UTC)


def normalize_identifier(value: str | None) -> str | None:
    if value is None:
        return None
    compact = " ".join(value.split()).upper()
    return compact or None


NAME_SIMILARITY_THRESHOLD = 85.0


def normalize_name(value: str | None) -> str | None:
    if value is None:
        return None
    compact = " ".join(value.split()).casefold()
    return compact or None


def normalize_contact(value: str | None) -> str | None:
    if value is None:
        return None
    compact = "".join(value.split()).casefold()
    return compact or None


def name_similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, left, right).ratio() * 100


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def serialize_customer(customer: Customer) -> dict[str, object]:
    return {
        "id": str(customer.id),
        "customerCode": customer.customer_code,
        "customerType": customer.customer_type,
        "customerTypeLabel": (
            "Company / Business" if customer.customer_type == CustomerType.COMPANY else "Individual"
        ),
        "status": customer.status,
        "fullName": customer.full_name,
        "companyName": customer.company_name,
        "contactPerson": customer.contact_person,
        "mobile": customer.mobile,
        "email": customer.email,
        "emiratesId": customer.emirates_id,
        "passport": customer.passport,
        "employer": customer.employer,
        "tradeLicense": customer.trade_license,
        "mergedIntoId": str(customer.merged_into_id) if customer.merged_into_id else None,
        "createdAt": customer.created_at.isoformat(),
        "updatedAt": customer.updated_at.isoformat(),
    }


def serialize_duplicate(customer: Customer) -> dict[str, object]:
    return {
        "id": str(customer.id),
        "customerCode": customer.customer_code,
        "customerType": customer.customer_type,
        "status": customer.status,
        "fullName": customer.full_name,
        "companyName": customer.company_name,
        "mobile": customer.mobile,
        "email": customer.email,
    }


async def next_customer_code(session: AsyncSession) -> str:
    counter = await session.get(CustomerCodeCounter, 1)
    if counter is None:
        counter = CustomerCodeCounter(id=1, last_value=0)
        session.add(counter)
        await session.flush()
    counter.last_value += 1
    return f"CUS-{counter.last_value:06d}"


async def _allowed_customer_ids(session: AsyncSession, actor: User) -> set[UUID] | None:
    """None means all customers. Empty set means none."""
    from nexa_bos_api.applications.visibility import visible_customer_ids

    return await visible_customer_ids(session, actor)


async def can_view_customer(session: AsyncSession, actor: User, customer: Customer) -> bool:
    allowed = await _allowed_customer_ids(session, actor)
    if allowed is None:
        return True
    return customer.id in allowed


async def get_visible_customer(session: AsyncSession, actor: User, customer_id: UUID) -> Customer:
    customer = await session.get(Customer, customer_id)
    if customer is None:
        raise AppError(status_code=404, code="CUSTOMER_NOT_FOUND", message="Customer not found")
    if not await can_view_customer(session, actor, customer):
        raise AppError(
            status_code=403,
            code="FORBIDDEN",
            message="You do not have permission to view this customer",
        )
    return customer


async def _record_field(
    session: AsyncSession,
    *,
    customer_id: UUID,
    field: CustomerField,
    value: str | None,
    at: datetime,
) -> None:
    current = (
        await session.execute(
            select(CustomerFieldHistory).where(
                CustomerFieldHistory.customer_id == customer_id,
                CustomerFieldHistory.field == field,
                CustomerFieldHistory.effective_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if current is not None and (current.value or None) == (value or None):
        return
    if current is not None:
        current.effective_to = at
    session.add(
        CustomerFieldHistory(
            id=new_uuid(),
            customer_id=customer_id,
            field=field,
            value=value,
            effective_from=at,
            effective_to=None,
        )
    )


async def _assert_identifier_free(
    session: AsyncSession,
    kind: CustomerIdentifierKind,
    normalized: str,
) -> None:
    existing = (
        await session.execute(
            select(CustomerIdentifierHistory).where(
                CustomerIdentifierHistory.kind == kind,
                CustomerIdentifierHistory.value_normalized == normalized,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(
            status_code=409,
            code="CUSTOMER_IDENTIFIER_DUPLICATE",
            message=(
                "Emirates ID, passport, and trade license must be unique "
                "across current and historical values"
            ),
            details=[{"kind": kind, "customerId": str(existing.customer_id)}],
        )


async def _set_identifier(
    session: AsyncSession,
    *,
    customer_id: UUID,
    kind: CustomerIdentifierKind,
    value: str | None,
    at: datetime,
) -> str | None:
    normalized = normalize_identifier(value)
    display = _blank_to_none(value)
    current = (
        await session.execute(
            select(CustomerIdentifierHistory).where(
                CustomerIdentifierHistory.customer_id == customer_id,
                CustomerIdentifierHistory.kind == kind,
                CustomerIdentifierHistory.effective_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if current is not None and current.value_normalized == (normalized or ""):
        return current.value if normalized else None
    if normalized is not None:
        await _assert_identifier_free(session, kind, normalized)
    if current is not None:
        current.effective_to = at
    if normalized is None:
        return None
    session.add(
        CustomerIdentifierHistory(
            id=new_uuid(),
            customer_id=customer_id,
            kind=kind,
            value=display or normalized,
            value_normalized=normalized,
            effective_from=at,
            effective_to=None,
        )
    )
    return display or normalized


def _validate_type_fields(
    customer_type: CustomerType,
    *,
    full_name: str | None,
    company_name: str | None,
    contact_person: str | None,
    emirates_id: str | None,
    passport: str | None,
    employer: str | None,
    trade_license: str | None,
) -> None:
    if customer_type is CustomerType.INDIVIDUAL:
        if not full_name:
            raise AppError(
                status_code=422,
                code="CUSTOMER_FULL_NAME_REQUIRED",
                message="Full name is required for an Individual customer",
            )
        extras = {
            "company_name": company_name,
            "contact_person": contact_person,
            "trade_license": trade_license,
        }
        used = [name for name, value in extras.items() if value]
        if used:
            raise AppError(
                status_code=422,
                code="CUSTOMER_FIELD_NOT_ALLOWED",
                message="Company fields cannot be set on an Individual customer",
                details=used,
            )
        return
    if not company_name:
        raise AppError(
            status_code=422,
            code="CUSTOMER_COMPANY_NAME_REQUIRED",
            message="Company name is required for a Company / Business customer",
        )
    if not contact_person:
        raise AppError(
            status_code=422,
            code="CUSTOMER_CONTACT_PERSON_REQUIRED",
            message="Contact person is required for a Company / Business customer",
        )
    extras = {
        "full_name": full_name,
        "emirates_id": emirates_id,
        "passport": passport,
        "employer": employer,
    }
    used = [name for name, value in extras.items() if value]
    if used:
        raise AppError(
            status_code=422,
            code="CUSTOMER_FIELD_NOT_ALLOWED",
            message="Individual fields cannot be set on a Company / Business customer",
            details=used,
        )


async def find_possible_duplicates(
    session: AsyncSession,
    *,
    full_name: str | None,
    company_name: str | None,
    mobile: str,
    email: str | None,
    ignore_customer_id: UUID | None = None,
) -> list[Customer]:
    incoming_names = [
        value for value in (normalize_name(full_name), normalize_name(company_name)) if value
    ]
    mobile_n = normalize_contact(mobile)
    email_n = normalize_contact(email)
    if not incoming_names or (mobile_n is None and email_n is None):
        return []
    contact_clauses = []
    if mobile_n is not None:
        contact_clauses.append(func.replace(func.lower(Customer.mobile), " ", "") == mobile_n)
    if email_n is not None:
        contact_clauses.append(func.lower(Customer.email) == email_n)
    stmt = select(Customer).where(
        Customer.status != CustomerStatus.MERGED,
        or_(*contact_clauses),
    )
    if ignore_customer_id is not None:
        stmt = stmt.where(Customer.id != ignore_customer_id)
    candidates = list((await session.execute(stmt)).scalars().unique().all())
    matches: list[Customer] = []
    for customer in candidates:
        existing_names = [
            value
            for value in (normalize_name(customer.full_name), normalize_name(customer.company_name))
            if value
        ]
        similar = any(
            name_similarity(incoming, existing) >= NAME_SIMILARITY_THRESHOLD
            for incoming in incoming_names
            for existing in existing_names
        )
        if similar:
            matches.append(customer)
    return matches


async def create_customer(
    session: AsyncSession, actor: User, payload: CustomerCreateRequest
) -> Customer:
    full_name = _blank_to_none(payload.full_name)
    company_name = _blank_to_none(payload.company_name)
    contact_person = _blank_to_none(payload.contact_person)
    employer = _blank_to_none(payload.employer)
    email = str(payload.email).lower() if payload.email else None
    mobile = payload.mobile.strip()
    _validate_type_fields(
        payload.customer_type,
        full_name=full_name,
        company_name=company_name,
        contact_person=contact_person,
        emirates_id=_blank_to_none(payload.emirates_id),
        passport=_blank_to_none(payload.passport),
        employer=employer,
        trade_license=_blank_to_none(payload.trade_license),
    )
    duplicates = await find_possible_duplicates(
        session,
        full_name=full_name,
        company_name=company_name,
        mobile=mobile,
        email=email,
    )
    if duplicates and not payload.create_anyway:
        raise AppError(
            status_code=409,
            code="CUSTOMER_DUPLICATE_WARNING",
            message="A possible duplicate customer was found. Confirm Create Anyway to proceed.",
            details=[serialize_duplicate(row) for row in duplicates],
        )
    now = utcnow()
    customer = Customer(
        id=new_uuid(),
        customer_code=await next_customer_code(session),
        customer_type=payload.customer_type,
        status=CustomerStatus.ACTIVE,
        full_name=full_name,
        company_name=company_name,
        contact_person=contact_person,
        mobile=mobile,
        email=email,
        employer=employer,
        merged_into_id=None,
        created_at=now,
        updated_at=now,
    )
    session.add(customer)
    await session.flush()
    customer.emirates_id = await _set_identifier(
        session,
        customer_id=customer.id,
        kind=CustomerIdentifierKind.EMIRATES_ID,
        value=payload.emirates_id,
        at=now,
    )
    customer.passport = await _set_identifier(
        session,
        customer_id=customer.id,
        kind=CustomerIdentifierKind.PASSPORT,
        value=payload.passport,
        at=now,
    )
    customer.trade_license = await _set_identifier(
        session,
        customer_id=customer.id,
        kind=CustomerIdentifierKind.TRADE_LICENSE,
        value=payload.trade_license,
        at=now,
    )
    for field, value in (
        (CustomerField.FULL_NAME, full_name),
        (CustomerField.COMPANY_NAME, company_name),
        (CustomerField.CONTACT_PERSON, contact_person),
        (CustomerField.EMPLOYER, employer),
        (CustomerField.MOBILE, mobile),
        (CustomerField.EMAIL, email),
    ):
        await _record_field(session, customer_id=customer.id, field=field, value=value, at=now)
    await record_audit(
        session,
        action="customer.create_anyway" if payload.create_anyway else "customer.create",
        entity_type="customer",
        entity_id=str(customer.id),
        actor_id=actor.id,
        new_values=serialize_customer(customer),
        note="Created despite possible duplicate matches" if payload.create_anyway else None,
    )
    await session.commit()
    return (await session.get(Customer, customer.id)) or customer


async def list_customers(
    session: AsyncSession,
    actor: User,
    *,
    q: str | None,
    status: str | None,
) -> list[Customer]:
    stmt = select(Customer)
    allowed = await _allowed_customer_ids(session, actor)
    if allowed is not None:
        if not allowed:
            return []
        stmt = stmt.where(Customer.id.in_(allowed))
    if status:
        stmt = stmt.where(Customer.status == status)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.outerjoin(CustomerIdentifierHistory).where(
            or_(
                func.lower(Customer.customer_code).like(like),
                func.lower(func.coalesce(Customer.full_name, "")).like(like),
                func.lower(func.coalesce(Customer.company_name, "")).like(like),
                func.lower(Customer.mobile).like(like),
                func.lower(func.coalesce(Customer.email, "")).like(like),
                func.lower(func.coalesce(CustomerIdentifierHistory.value, "")).like(like),
                func.lower(func.coalesce(CustomerIdentifierHistory.value_normalized, "")).like(
                    like
                ),
            )
        )
    stmt = stmt.order_by(Customer.customer_code)
    return list((await session.execute(stmt)).scalars().unique().all())


def _reject_merged(customer: Customer) -> None:
    if customer.status == CustomerStatus.MERGED:
        raise AppError(
            status_code=422,
            code="CUSTOMER_MERGED",
            message="A merged customer cannot be changed. Use the primary customer.",
        )


async def update_customer(
    session: AsyncSession, actor: User, customer: Customer, payload: CustomerUpdateRequest
) -> Customer:
    _reject_merged(customer)
    now = utcnow()
    fields_set = payload.model_fields_set

    def incoming(name: str, current: str | None) -> str | None:
        if name not in fields_set:
            return current
        raw = getattr(payload, name)
        if name == "email":
            return str(raw).lower() if raw else None
        return _blank_to_none(raw) if isinstance(raw, str) or raw is None else current

    full_name = incoming("full_name", customer.full_name)
    company_name = incoming("company_name", customer.company_name)
    contact_person = incoming("contact_person", customer.contact_person)
    employer = incoming("employer", customer.employer)
    mobile = incoming("mobile", customer.mobile) or customer.mobile
    email = incoming("email", customer.email)
    emirates_id = incoming("emirates_id", customer.emirates_id)
    passport = incoming("passport", customer.passport)
    trade_license = incoming("trade_license", customer.trade_license)
    _validate_type_fields(
        CustomerType(customer.customer_type),
        full_name=full_name,
        company_name=company_name,
        contact_person=contact_person,
        emirates_id=emirates_id,
        passport=passport,
        employer=employer,
        trade_license=trade_license,
    )
    old = serialize_customer(customer)
    customer.full_name = full_name
    customer.company_name = company_name
    customer.contact_person = contact_person
    customer.employer = employer
    customer.mobile = mobile
    customer.email = email
    customer.emirates_id = await _set_identifier(
        session,
        customer_id=customer.id,
        kind=CustomerIdentifierKind.EMIRATES_ID,
        value=emirates_id,
        at=now,
    )
    customer.passport = await _set_identifier(
        session,
        customer_id=customer.id,
        kind=CustomerIdentifierKind.PASSPORT,
        value=passport,
        at=now,
    )
    customer.trade_license = await _set_identifier(
        session,
        customer_id=customer.id,
        kind=CustomerIdentifierKind.TRADE_LICENSE,
        value=trade_license,
        at=now,
    )
    customer.updated_at = now
    for field, value in (
        (CustomerField.FULL_NAME, full_name),
        (CustomerField.COMPANY_NAME, company_name),
        (CustomerField.CONTACT_PERSON, contact_person),
        (CustomerField.EMPLOYER, employer),
        (CustomerField.MOBILE, mobile),
        (CustomerField.EMAIL, email),
    ):
        await _record_field(session, customer_id=customer.id, field=field, value=value, at=now)
    await record_audit(
        session,
        action="customer.update",
        entity_type="customer",
        entity_id=str(customer.id),
        actor_id=actor.id,
        old_values=old,
        new_values=serialize_customer(customer),
    )
    await session.commit()
    return (await session.get(Customer, customer.id)) or customer


async def set_customer_status(
    session: AsyncSession, actor: User, customer: Customer, status: CustomerStatus
) -> Customer:
    _reject_merged(customer)
    if status is CustomerStatus.INACTIVE:
        from nexa_bos_api.applications.service import has_active_applications

        if await has_active_applications(session, customer.id):
            raise AppError(
                status_code=422,
                code="CUSTOMER_HAS_ACTIVE_APPLICATIONS",
                message="A customer with active applications cannot be deactivated",
            )
    customer.status = status
    customer.updated_at = utcnow()
    await record_audit(
        session,
        action="customer.status",
        entity_type="customer",
        entity_id=str(customer.id),
        actor_id=actor.id,
        new_values={"status": status},
    )
    await session.commit()
    return customer


async def merge_customers(
    session: AsyncSession, actor: User, source: Customer, primary_id: UUID
) -> Customer:
    _reject_merged(source)
    if source.id == primary_id:
        raise AppError(
            status_code=422,
            code="CUSTOMER_MERGE_SAME",
            message="A customer cannot be merged into itself",
        )
    primary = await get_visible_customer(session, actor, primary_id)
    _reject_merged(primary)
    from nexa_bos_api.applications.models import Application

    source_active = list(
        (
            await session.execute(
                select(Application).where(
                    Application.customer_id == source.id,
                    Application.terminal_outcome.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    primary_active = list(
        (
            await session.execute(
                select(Application).where(
                    Application.customer_id == primary.id,
                    Application.terminal_outcome.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    source_keys = {(row.bank_id, row.product_id): row for row in source_active}
    conflicts = []
    for row in primary_active:
        other = source_keys.get((row.bank_id, row.product_id))
        if other is None:
            continue
        conflicts.append(
            {
                "bankId": str(row.bank_id),
                "productId": str(row.product_id),
                "primaryApplicationId": str(row.id),
                "primaryApplicationCode": row.application_code,
                "sourceApplicationId": str(other.id),
                "sourceApplicationCode": other.application_code,
            }
        )
    if conflicts:
        raise AppError(
            status_code=409,
            code="APPLICATION_MERGE_CONFLICT",
            message=(
                "Merge is blocked because both customers have an active application "
                "for the same Bank and Product"
            ),
            details=conflicts,
        )
    now = utcnow()
    source.status = CustomerStatus.MERGED
    source.merged_into_id = primary.id
    source.updated_at = now
    session.add(
        CustomerMerge(
            id=new_uuid(),
            source_customer_id=source.id,
            primary_customer_id=primary.id,
            merged_by_id=actor.id,
            merged_at=now,
            source_customer_code=source.customer_code,
        )
    )
    await record_audit(
        session,
        action="customer.merge",
        entity_type="customer",
        entity_id=str(source.id),
        actor_id=actor.id,
        old_values={"status": CustomerStatus.ACTIVE, "customerCode": source.customer_code},
        new_values={
            "status": CustomerStatus.MERGED,
            "mergedIntoId": str(primary.id),
            "primaryCustomerCode": primary.customer_code,
            "retiredCustomerCode": source.customer_code,
        },
        note=(
            "Merge is irreversible. Retired customer code will never be reused. "
            "Source identifiers, names, and contact-person history are preserved."
        ),
    )
    await record_audit(
        session,
        action="customer.merge_primary",
        entity_type="customer",
        entity_id=str(primary.id),
        actor_id=actor.id,
        new_values={"mergedSourceId": str(source.id), "retiredCustomerCode": source.customer_code},
    )
    from nexa_bos_api.applications.service import relink_applications

    await relink_applications(session, source.id, primary.id, actor.id)
    await session.commit()
    return (await session.get(Customer, source.id)) or source


async def customer_history(session: AsyncSession, customer: Customer) -> dict[str, object]:
    identifiers = (
        (
            await session.execute(
                select(CustomerIdentifierHistory)
                .where(CustomerIdentifierHistory.customer_id == customer.id)
                .order_by(CustomerIdentifierHistory.effective_from)
            )
        )
        .scalars()
        .all()
    )
    fields = (
        (
            await session.execute(
                select(CustomerFieldHistory)
                .where(CustomerFieldHistory.customer_id == customer.id)
                .order_by(CustomerFieldHistory.effective_from)
            )
        )
        .scalars()
        .all()
    )
    merges = (
        (
            await session.execute(
                select(CustomerMerge).where(
                    or_(
                        CustomerMerge.source_customer_id == customer.id,
                        CustomerMerge.primary_customer_id == customer.id,
                    )
                )
            )
        )
        .scalars()
        .all()
    )
    return {
        "customer": serialize_customer(customer),
        "identifiers": [
            {
                "kind": row.kind,
                "value": row.value,
                "effectiveFrom": row.effective_from.isoformat(),
                "effectiveTo": row.effective_to.isoformat() if row.effective_to else None,
            }
            for row in identifiers
        ],
        "fields": [
            {
                "field": row.field,
                "value": row.value,
                "effectiveFrom": row.effective_from.isoformat(),
                "effectiveTo": row.effective_to.isoformat() if row.effective_to else None,
            }
            for row in fields
        ],
        "merges": [
            {
                "sourceCustomerId": str(row.source_customer_id),
                "primaryCustomerId": str(row.primary_customer_id),
                "sourceCustomerCode": row.source_customer_code,
                "mergedAt": row.merged_at.isoformat(),
            }
            for row in merges
        ],
    }
