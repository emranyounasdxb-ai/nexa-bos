from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.catalog.models import (
    Bank,
    BankNameHistory,
    BankProduct,
    Product,
    ProductNameHistory,
    ProductVariant,
)
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import (
    INITIAL_BANK_PRODUCTS,
    INITIAL_BANKS,
    INITIAL_PRODUCT_TARGET_MEASUREMENT,
    INITIAL_PRODUCTS,
    MasterStatus,
)
from nexa_bos_api.identity.models import User, new_uuid


def utcnow() -> datetime:
    return datetime.now(UTC)


def serialize_bank(bank: Bank) -> dict[str, object]:
    return {
        "id": str(bank.id),
        "code": bank.code,
        "name": bank.name,
        "status": bank.status,
        "createdAt": bank.created_at.isoformat(),
        "updatedAt": bank.updated_at.isoformat(),
    }


def serialize_product(product: Product) -> dict[str, object]:
    return {
        "id": str(product.id),
        "code": product.code,
        "name": product.name,
        "status": product.status,
        "requestedAmountRequired": product.requested_amount_required,
        "approvedAmountRequired": product.approved_amount_required,
        "bookedAmountRequired": product.booked_amount_required,
        "fundedAmountRequired": product.funded_amount_required,
        "targetMeasurement": product.target_measurement,
        "createdAt": product.created_at.isoformat(),
        "updatedAt": product.updated_at.isoformat(),
    }


def serialize_bank_product(row: BankProduct) -> dict[str, object]:
    return {
        "id": str(row.id),
        "bankId": str(row.bank_id),
        "productId": str(row.product_id),
        "status": row.status,
        "bank": serialize_bank(row.bank) if row.bank else None,
        "product": serialize_product(row.product) if row.product else None,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


def serialize_product_variant(row: ProductVariant) -> dict[str, object]:
    mapping = row.bank_product
    return {
        "id": str(row.id),
        "bankProductId": str(row.bank_product_id),
        "bankId": str(mapping.bank_id),
        "productId": str(mapping.product_id),
        "code": row.code,
        "name": row.name,
        "description": row.description,
        "status": row.status,
        "bank": serialize_bank(mapping.bank) if mapping.bank else None,
        "product": serialize_product(mapping.product) if mapping.product else None,
        "mappingStatus": mapping.status,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


async def _unique_code(session: AsyncSession, model, code: str, entity: str) -> str:
    normalized = code.strip().upper()
    existing = (
        await session.execute(select(model).where(model.code == normalized))
    ).scalar_one_or_none()
    if existing:
        raise AppError(
            status_code=409,
            code=f"{entity.upper()}_CODE_DUPLICATE",
            message=f"{entity} code must be unique and is immutable",
        )
    return normalized


def delete_catalog_forbidden() -> None:
    raise AppError(
        status_code=405,
        code="MASTER_DELETE_FORBIDDEN",
        message="Bank and product masters cannot be deleted",
    )


async def seed_catalog(session: AsyncSession) -> None:
    now = utcnow()
    banks_by_code: dict[str, Bank] = {
        row.code: row for row in (await session.execute(select(Bank))).scalars().all()
    }
    for code, name in INITIAL_BANKS:
        if code in banks_by_code:
            continue
        bank = Bank(
            id=new_uuid(),
            code=code,
            name=name,
            status=MasterStatus.ACTIVE,
            created_at=now,
            updated_at=now,
        )
        session.add(bank)
        await session.flush()
        session.add(
            BankNameHistory(
                id=new_uuid(),
                bank_id=bank.id,
                name=name,
                effective_from=now,
                effective_to=None,
            )
        )
        banks_by_code[code] = bank
    products_by_code: dict[str, Product] = {
        row.code: row for row in (await session.execute(select(Product))).scalars().all()
    }
    for code, name in INITIAL_PRODUCTS:
        if code in products_by_code:
            continue
        product = Product(
            id=new_uuid(),
            code=code,
            name=name,
            status=MasterStatus.ACTIVE,
            requested_amount_required=code == "PF",
            approved_amount_required=code == "PF",
            booked_amount_required=False,
            funded_amount_required=False,
            target_measurement=INITIAL_PRODUCT_TARGET_MEASUREMENT.get(code, "count"),
            created_at=now,
            updated_at=now,
        )
        session.add(product)
        await session.flush()
        session.add(
            ProductNameHistory(
                id=new_uuid(),
                product_id=product.id,
                name=name,
                effective_from=now,
                effective_to=None,
            )
        )
        products_by_code[code] = product
    existing_maps = {
        (row.bank_id, row.product_id)
        for row in (await session.execute(select(BankProduct))).scalars().all()
    }
    for bank_code, product_code in INITIAL_BANK_PRODUCTS:
        bank = banks_by_code[bank_code]
        product = products_by_code[product_code]
        if (bank.id, product.id) in existing_maps:
            continue
        session.add(
            BankProduct(
                id=new_uuid(),
                bank_id=bank.id,
                product_id=product.id,
                status=MasterStatus.ACTIVE,
                created_at=now,
                updated_at=now,
            )
        )


async def list_banks(session: AsyncSession, *, include_inactive: bool) -> list[Bank]:
    stmt = select(Bank).order_by(Bank.code)
    if not include_inactive:
        stmt = stmt.where(Bank.status == MasterStatus.ACTIVE)
    return list((await session.execute(stmt)).scalars().all())


async def create_bank(session: AsyncSession, actor: User, name: str, code: str) -> Bank:
    now = utcnow()
    bank = Bank(
        id=new_uuid(),
        code=await _unique_code(session, Bank, code, "bank"),
        name=name.strip(),
        status=MasterStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    session.add(bank)
    await session.flush()
    session.add(
        BankNameHistory(bank_id=bank.id, name=bank.name, effective_from=now, effective_to=None)
    )
    await record_audit(
        session,
        action="bank.create",
        entity_type="bank",
        entity_id=str(bank.id),
        actor_id=actor.id,
        new_values={"code": bank.code, "name": bank.name},
    )
    await session.commit()
    return (await session.get(Bank, bank.id)) or bank


async def rename_bank(session: AsyncSession, actor: User, bank: Bank, name: str) -> Bank:
    now = utcnow()
    old = bank.name
    new_name = name.strip()
    if new_name != old:
        current = (
            await session.execute(
                select(BankNameHistory).where(
                    BankNameHistory.bank_id == bank.id,
                    BankNameHistory.effective_to.is_(None),
                )
            )
        ).scalar_one_or_none()
        if current:
            current.effective_to = now
        session.add(
            BankNameHistory(bank_id=bank.id, name=new_name, effective_from=now, effective_to=None)
        )
        bank.name = new_name
        bank.updated_at = now
        await record_audit(
            session,
            action="bank.rename",
            entity_type="bank",
            entity_id=str(bank.id),
            actor_id=actor.id,
            old_values={"name": old},
            new_values={"name": new_name},
        )
        await session.commit()
    return bank


async def set_bank_status(
    session: AsyncSession, actor: User, bank: Bank, status: MasterStatus
) -> Bank:
    bank.status = status
    bank.updated_at = utcnow()
    await record_audit(
        session,
        action="bank.status",
        entity_type="bank",
        entity_id=str(bank.id),
        actor_id=actor.id,
        new_values={"status": status},
    )
    await session.commit()
    return bank


async def list_products(session: AsyncSession, *, include_inactive: bool) -> list[Product]:
    stmt = select(Product).order_by(Product.code)
    if not include_inactive:
        stmt = stmt.where(Product.status == MasterStatus.ACTIVE)
    return list((await session.execute(stmt)).scalars().all())


async def create_product(session: AsyncSession, actor: User, name: str, code: str) -> Product:
    now = utcnow()
    product = Product(
        id=new_uuid(),
        code=await _unique_code(session, Product, code, "product"),
        name=name.strip(),
        status=MasterStatus.ACTIVE,
        requested_amount_required=code.strip().upper() == "PF",
        approved_amount_required=code.strip().upper() == "PF",
        booked_amount_required=False,
        funded_amount_required=False,
        target_measurement="count",
        created_at=now,
        updated_at=now,
    )
    session.add(product)
    await session.flush()
    session.add(
        ProductNameHistory(
            product_id=product.id, name=product.name, effective_from=now, effective_to=None
        )
    )
    await record_audit(
        session,
        action="product.create",
        entity_type="product",
        entity_id=str(product.id),
        actor_id=actor.id,
        new_values={"code": product.code, "name": product.name},
    )
    await session.commit()
    return (await session.get(Product, product.id)) or product


async def rename_product(
    session: AsyncSession, actor: User, product: Product, name: str
) -> Product:
    now = utcnow()
    old = product.name
    new_name = name.strip()
    if new_name != old:
        current = (
            await session.execute(
                select(ProductNameHistory).where(
                    ProductNameHistory.product_id == product.id,
                    ProductNameHistory.effective_to.is_(None),
                )
            )
        ).scalar_one_or_none()
        if current:
            current.effective_to = now
        session.add(
            ProductNameHistory(
                product_id=product.id, name=new_name, effective_from=now, effective_to=None
            )
        )
        product.name = new_name
        product.updated_at = now
        await record_audit(
            session,
            action="product.rename",
            entity_type="product",
            entity_id=str(product.id),
            actor_id=actor.id,
            old_values={"name": old},
            new_values={"name": new_name},
        )
        await session.commit()
    return product


async def set_product_status(
    session: AsyncSession, actor: User, product: Product, status: MasterStatus
) -> Product:
    product.status = status
    product.updated_at = utcnow()
    await record_audit(
        session,
        action="product.status",
        entity_type="product",
        entity_id=str(product.id),
        actor_id=actor.id,
        new_values={"status": status},
    )
    await session.commit()
    return product


async def update_product_field_rules(
    session: AsyncSession,
    actor: User,
    product: Product,
    *,
    requested_amount_required: bool | None,
    approved_amount_required: bool | None,
    booked_amount_required: bool | None,
    funded_amount_required: bool | None,
    target_measurement: str | None = None,
) -> Product:
    old = {
        "requestedAmountRequired": product.requested_amount_required,
        "approvedAmountRequired": product.approved_amount_required,
        "bookedAmountRequired": product.booked_amount_required,
        "fundedAmountRequired": product.funded_amount_required,
        "targetMeasurement": product.target_measurement,
    }
    if requested_amount_required is not None:
        product.requested_amount_required = requested_amount_required
    if approved_amount_required is not None:
        product.approved_amount_required = approved_amount_required
    if booked_amount_required is not None:
        product.booked_amount_required = booked_amount_required
    if funded_amount_required is not None:
        product.funded_amount_required = funded_amount_required
    if target_measurement is not None:
        measurement = target_measurement.strip().lower()
        if measurement not in {"count", "amount"}:
            raise AppError(
                status_code=422,
                code="TARGET_MEASUREMENT_INVALID",
                message="Product target measurement must be count or amount",
            )
        product.target_measurement = measurement
    product.updated_at = utcnow()
    await record_audit(
        session,
        action="product.field_rules",
        entity_type="product",
        entity_id=str(product.id),
        actor_id=actor.id,
        old_values=old,
        new_values={
            "requestedAmountRequired": product.requested_amount_required,
            "approvedAmountRequired": product.approved_amount_required,
            "bookedAmountRequired": product.booked_amount_required,
            "fundedAmountRequired": product.funded_amount_required,
            "targetMeasurement": product.target_measurement,
        },
    )
    await session.commit()
    return product


def _mapping_load():
    return (selectinload(BankProduct.bank), selectinload(BankProduct.product))


async def list_bank_products(
    session: AsyncSession,
    *,
    bank_id: UUID | None,
    product_id: UUID | None,
    include_inactive: bool,
) -> list[BankProduct]:
    stmt = select(BankProduct).options(*_mapping_load()).order_by(BankProduct.created_at)
    if bank_id:
        stmt = stmt.where(BankProduct.bank_id == bank_id)
    if product_id:
        stmt = stmt.where(BankProduct.product_id == product_id)
    if not include_inactive:
        stmt = stmt.where(BankProduct.status == MasterStatus.ACTIVE)
    return list((await session.execute(stmt)).scalars().unique().all())


async def create_bank_product(
    session: AsyncSession, actor: User, bank_id: UUID, product_id: UUID
) -> BankProduct:
    bank = await session.get(Bank, bank_id)
    if bank is None:
        raise AppError(status_code=404, code="BANK_NOT_FOUND", message="Bank not found")
    product = await session.get(Product, product_id)
    if product is None:
        raise AppError(status_code=404, code="PRODUCT_NOT_FOUND", message="Product not found")
    existing = (
        await session.execute(
            select(BankProduct).where(
                BankProduct.bank_id == bank.id, BankProduct.product_id == product.id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(
            status_code=409,
            code="BANK_PRODUCT_DUPLICATE",
            message="This bank-product mapping already exists",
        )
    now = utcnow()
    row = BankProduct(
        id=new_uuid(),
        bank_id=bank.id,
        product_id=product.id,
        status=MasterStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    await record_audit(
        session,
        action="bank_product.create",
        entity_type="bank_product",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values={"bankCode": bank.code, "productCode": product.code},
    )
    await session.commit()
    loaded = (
        await session.execute(
            select(BankProduct).options(*_mapping_load()).where(BankProduct.id == row.id)
        )
    ).scalar_one()
    return loaded


async def set_bank_product_status(
    session: AsyncSession, actor: User, row: BankProduct, status: MasterStatus
) -> BankProduct:
    row.status = status
    row.updated_at = utcnow()
    await record_audit(
        session,
        action="bank_product.status",
        entity_type="bank_product",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values={"status": status},
    )
    await session.commit()
    return (
        await session.execute(
            select(BankProduct).options(*_mapping_load()).where(BankProduct.id == row.id)
        )
    ).scalar_one()


def _variant_load():
    return (
        selectinload(ProductVariant.bank_product).selectinload(BankProduct.bank),
        selectinload(ProductVariant.bank_product).selectinload(BankProduct.product),
    )


async def list_product_variants(
    session: AsyncSession,
    *,
    bank_product_id: UUID | None,
    bank_id: UUID | None,
    product_id: UUID | None,
    include_inactive: bool,
) -> list[ProductVariant]:
    stmt = (
        select(ProductVariant)
        .join(BankProduct, ProductVariant.bank_product_id == BankProduct.id)
        .options(*_variant_load())
        .order_by(BankProduct.bank_id, BankProduct.product_id, ProductVariant.code)
    )
    if bank_product_id:
        stmt = stmt.where(ProductVariant.bank_product_id == bank_product_id)
    if bank_id:
        stmt = stmt.where(BankProduct.bank_id == bank_id)
    if product_id:
        stmt = stmt.where(BankProduct.product_id == product_id)
    if not include_inactive:
        stmt = stmt.where(
            ProductVariant.status == MasterStatus.ACTIVE,
            BankProduct.status == MasterStatus.ACTIVE,
            BankProduct.bank.has(Bank.status == MasterStatus.ACTIVE),
            BankProduct.product.has(Product.status == MasterStatus.ACTIVE),
        )
    return list((await session.execute(stmt)).scalars().unique().all())


async def get_product_variant(session: AsyncSession, variant_id: UUID) -> ProductVariant:
    row = (
        await session.execute(
            select(ProductVariant).options(*_variant_load()).where(ProductVariant.id == variant_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError(
            status_code=404,
            code="PRODUCT_VARIANT_NOT_FOUND",
            message="Product variant not found",
        )
    return row


def _normalize_variant_values(name: str, code: str | None, description: str | None):
    normalized_name = name.strip()
    if not normalized_name:
        raise AppError(
            status_code=422,
            code="PRODUCT_VARIANT_NAME_REQUIRED",
            message="Product variant name is required",
        )
    normalized_code = code.strip().upper() if code is not None else None
    normalized_description = description.strip() if description and description.strip() else None
    return normalized_name, normalized_code, normalized_description


async def _assert_variant_unique(
    session: AsyncSession,
    *,
    bank_product_id: UUID,
    code: str,
    name: str,
    exclude_id: UUID | None = None,
) -> None:
    stmt = select(ProductVariant).where(
        ProductVariant.bank_product_id == bank_product_id,
        or_(ProductVariant.code == code, func.lower(ProductVariant.name) == name.lower()),
    )
    if exclude_id:
        stmt = stmt.where(ProductVariant.id != exclude_id)
    existing = (await session.execute(stmt)).scalar_one_or_none()
    if existing:
        raise AppError(
            status_code=409,
            code="PRODUCT_VARIANT_DUPLICATE",
            message=(
                "A variant with this code or name already exists for the selected bank and product"
            ),
        )


async def create_product_variant(
    session: AsyncSession,
    actor: User,
    *,
    bank_product_id: UUID,
    name: str,
    code: str,
    description: str | None,
) -> ProductVariant:
    mapping = (
        await session.execute(
            select(BankProduct).options(*_mapping_load()).where(BankProduct.id == bank_product_id)
        )
    ).scalar_one_or_none()
    if mapping is None:
        raise AppError(
            status_code=404,
            code="BANK_PRODUCT_NOT_FOUND",
            message="Bank-product mapping not found",
        )
    if (
        mapping.status != MasterStatus.ACTIVE
        or mapping.bank.status != MasterStatus.ACTIVE
        or mapping.product.status != MasterStatus.ACTIVE
    ):
        raise AppError(
            status_code=422,
            code="PRODUCT_VARIANT_PARENT_INACTIVE",
            message="Variants can only be created for an active Bank–Product mapping",
        )
    normalized_name, normalized_code, normalized_description = _normalize_variant_values(
        name, code, description
    )
    assert normalized_code is not None
    await _assert_variant_unique(
        session,
        bank_product_id=mapping.id,
        code=normalized_code,
        name=normalized_name,
    )
    now = utcnow()
    row = ProductVariant(
        id=new_uuid(),
        bank_product_id=mapping.id,
        code=normalized_code,
        name=normalized_name,
        description=normalized_description,
        status=MasterStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as error:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="PRODUCT_VARIANT_DUPLICATE",
            message="A variant with this code already exists for the selected bank and product",
        ) from error
    await record_audit(
        session,
        action="product_variant.create",
        entity_type="product_variant",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values={
            "bankProductId": str(mapping.id),
            "bankCode": mapping.bank.code,
            "productCode": mapping.product.code,
            "code": row.code,
            "name": row.name,
            "description": row.description,
            "status": row.status,
        },
    )
    await session.commit()
    return await get_product_variant(session, row.id)


async def update_product_variant(
    session: AsyncSession,
    actor: User,
    row: ProductVariant,
    *,
    name: str,
    description: str | None,
) -> ProductVariant:
    normalized_name, _, normalized_description = _normalize_variant_values(name, None, description)
    await _assert_variant_unique(
        session,
        bank_product_id=row.bank_product_id,
        code=row.code,
        name=normalized_name,
        exclude_id=row.id,
    )
    old_values = {"name": row.name, "description": row.description}
    row.name = normalized_name
    row.description = normalized_description
    row.updated_at = utcnow()
    await record_audit(
        session,
        action="product_variant.update",
        entity_type="product_variant",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old_values,
        new_values={"name": row.name, "description": row.description},
    )
    await session.commit()
    return await get_product_variant(session, row.id)


async def set_product_variant_status(
    session: AsyncSession,
    actor: User,
    row: ProductVariant,
    status: MasterStatus,
) -> ProductVariant:
    if status == MasterStatus.ACTIVE:
        mapping = row.bank_product
        if (
            mapping.status != MasterStatus.ACTIVE
            or mapping.bank.status != MasterStatus.ACTIVE
            or mapping.product.status != MasterStatus.ACTIVE
        ):
            raise AppError(
                status_code=422,
                code="PRODUCT_VARIANT_PARENT_INACTIVE",
                message=(
                    "The Bank, Product, and Bank–Product mapping must be active before this "
                    "variant can be activated"
                ),
            )
    old_status = row.status
    row.status = status
    row.updated_at = utcnow()
    await record_audit(
        session,
        action="product_variant.status",
        entity_type="product_variant",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values={"status": old_status},
        new_values={"status": status},
    )
    await session.commit()
    return await get_product_variant(session, row.id)
