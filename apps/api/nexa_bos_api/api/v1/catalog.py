from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.catalog.models import Bank, BankProduct, Product
from nexa_bos_api.catalog.schemas import (
    BankCreateRequest,
    BankNameUpdateRequest,
    BankProductCreateRequest,
    ProductCreateRequest,
    ProductFieldRulesUpdate,
    ProductNameUpdateRequest,
    ProductVariantCreateRequest,
    ProductVariantUpdateRequest,
)
from nexa_bos_api.catalog.service import (
    create_bank,
    create_bank_product,
    create_product,
    create_product_variant,
    delete_catalog_forbidden,
    get_product_variant,
    list_bank_products,
    list_banks,
    list_product_variants,
    list_products,
    rename_bank,
    rename_product,
    serialize_bank,
    serialize_bank_product,
    serialize_product,
    serialize_product_variant,
    set_bank_product_status,
    set_bank_status,
    set_product_status,
    set_product_variant_status,
    update_product_field_rules,
    update_product_variant,
)
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.enums import MasterStatus
from nexa_bos_api.identity.permissions import (
    BANK_PRODUCTS_ACTIVATE,
    BANK_PRODUCTS_CREATE,
    BANK_PRODUCTS_DEACTIVATE,
    BANKS_ACTIVATE,
    BANKS_CREATE,
    BANKS_DEACTIVATE,
    BANKS_EDIT,
    PRODUCT_VARIANTS_ACTIVATE,
    PRODUCT_VARIANTS_CREATE,
    PRODUCT_VARIANTS_DEACTIVATE,
    PRODUCT_VARIANTS_EDIT,
    PRODUCTS_ACTIVATE,
    PRODUCTS_CREATE,
    PRODUCTS_DEACTIVATE,
    PRODUCTS_EDIT,
)

router = APIRouter(tags=["catalog"])


def _include_inactive(actor, permission: str, requested: bool) -> bool:
    return requested and has_permission(actor, permission)


@router.get("/banks")
async def banks_list(
    session: SessionDep,
    actor: CurrentUser,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
) -> dict[str, object]:
    rows = await list_banks(
        session, include_inactive=_include_inactive(actor, BANKS_EDIT, include_inactive)
    )
    return {"items": [serialize_bank(row) for row in rows]}


@router.post("/banks")
async def banks_create(
    payload: BankCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(BANKS_CREATE))],
) -> dict[str, object]:
    return serialize_bank(await create_bank(session, actor, payload.name, payload.code))


@router.patch("/banks/{bank_id}")
async def banks_rename(
    bank_id: UUID,
    payload: BankNameUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(BANKS_EDIT))],
) -> dict[str, object]:
    bank = await session.get(Bank, bank_id)
    if bank is None:
        raise AppError(status_code=404, code="BANK_NOT_FOUND", message="Bank not found")
    return serialize_bank(await rename_bank(session, actor, bank, payload.name))


@router.post("/banks/{bank_id}/deactivate")
async def banks_deactivate(
    bank_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(BANKS_DEACTIVATE))],
) -> dict[str, object]:
    bank = await session.get(Bank, bank_id)
    if bank is None:
        raise AppError(status_code=404, code="BANK_NOT_FOUND", message="Bank not found")
    return serialize_bank(await set_bank_status(session, actor, bank, MasterStatus.INACTIVE))


@router.post("/banks/{bank_id}/activate")
async def banks_activate(
    bank_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(BANKS_ACTIVATE))],
) -> dict[str, object]:
    bank = await session.get(Bank, bank_id)
    if bank is None:
        raise AppError(status_code=404, code="BANK_NOT_FOUND", message="Bank not found")
    return serialize_bank(await set_bank_status(session, actor, bank, MasterStatus.ACTIVE))


@router.delete("/banks/{bank_id}")
async def banks_delete(bank_id: UUID) -> None:
    delete_catalog_forbidden()


@router.get("/products")
async def products_list(
    session: SessionDep,
    actor: CurrentUser,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
) -> dict[str, object]:
    rows = await list_products(
        session, include_inactive=_include_inactive(actor, PRODUCTS_EDIT, include_inactive)
    )
    return {"items": [serialize_product(row) for row in rows]}


@router.post("/products")
async def products_create(
    payload: ProductCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCTS_CREATE))],
) -> dict[str, object]:
    return serialize_product(await create_product(session, actor, payload.name, payload.code))


@router.patch("/products/{product_id}")
async def products_rename(
    product_id: UUID,
    payload: ProductNameUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCTS_EDIT))],
) -> dict[str, object]:
    product = await session.get(Product, product_id)
    if product is None:
        raise AppError(status_code=404, code="PRODUCT_NOT_FOUND", message="Product not found")
    return serialize_product(await rename_product(session, actor, product, payload.name))


@router.put("/products/{product_id}/field-rules")
async def products_field_rules(
    product_id: UUID,
    payload: ProductFieldRulesUpdate,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCTS_EDIT))],
) -> dict[str, object]:
    product = await session.get(Product, product_id)
    if product is None:
        raise AppError(status_code=404, code="PRODUCT_NOT_FOUND", message="Product not found")
    return serialize_product(
        await update_product_field_rules(
            session,
            actor,
            product,
            requested_amount_required=payload.requested_amount_required,
            approved_amount_required=payload.approved_amount_required,
            booked_amount_required=payload.booked_amount_required,
            funded_amount_required=payload.funded_amount_required,
            target_measurement=payload.target_measurement,
        )
    )


@router.post("/products/{product_id}/deactivate")
async def products_deactivate(
    product_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCTS_DEACTIVATE))],
) -> dict[str, object]:
    product = await session.get(Product, product_id)
    if product is None:
        raise AppError(status_code=404, code="PRODUCT_NOT_FOUND", message="Product not found")
    return serialize_product(
        await set_product_status(session, actor, product, MasterStatus.INACTIVE)
    )


@router.post("/products/{product_id}/activate")
async def products_activate(
    product_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCTS_ACTIVATE))],
) -> dict[str, object]:
    product = await session.get(Product, product_id)
    if product is None:
        raise AppError(status_code=404, code="PRODUCT_NOT_FOUND", message="Product not found")
    return serialize_product(await set_product_status(session, actor, product, MasterStatus.ACTIVE))


@router.delete("/products/{product_id}")
async def products_delete(product_id: UUID) -> None:
    delete_catalog_forbidden()


@router.get("/bank-products")
async def bank_products_list(
    session: SessionDep,
    actor: CurrentUser,
    bank_id: Annotated[UUID | None, Query(alias="bankId")] = None,
    product_id: Annotated[UUID | None, Query(alias="productId")] = None,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
) -> dict[str, object]:
    rows = await list_bank_products(
        session,
        bank_id=bank_id,
        product_id=product_id,
        include_inactive=_include_inactive(actor, BANK_PRODUCTS_CREATE, include_inactive),
    )
    return {"items": [serialize_bank_product(row) for row in rows]}


@router.post("/bank-products")
async def bank_products_create(
    payload: BankProductCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(BANK_PRODUCTS_CREATE))],
) -> dict[str, object]:
    return serialize_bank_product(
        await create_bank_product(session, actor, payload.bank_id, payload.product_id)
    )


@router.post("/bank-products/{mapping_id}/deactivate")
async def bank_products_deactivate(
    mapping_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(BANK_PRODUCTS_DEACTIVATE))],
) -> dict[str, object]:
    row = await session.get(BankProduct, mapping_id)
    if row is None:
        raise AppError(
            status_code=404, code="BANK_PRODUCT_NOT_FOUND", message="Bank-product mapping not found"
        )
    return serialize_bank_product(
        await set_bank_product_status(session, actor, row, MasterStatus.INACTIVE)
    )


@router.post("/bank-products/{mapping_id}/activate")
async def bank_products_activate(
    mapping_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(BANK_PRODUCTS_ACTIVATE))],
) -> dict[str, object]:
    row = await session.get(BankProduct, mapping_id)
    if row is None:
        raise AppError(
            status_code=404, code="BANK_PRODUCT_NOT_FOUND", message="Bank-product mapping not found"
        )
    return serialize_bank_product(
        await set_bank_product_status(session, actor, row, MasterStatus.ACTIVE)
    )


@router.delete("/bank-products/{mapping_id}")
async def bank_products_delete(mapping_id: UUID) -> None:
    delete_catalog_forbidden()


@router.get("/product-variants")
async def product_variants_list(
    session: SessionDep,
    actor: CurrentUser,
    bank_product_id: Annotated[UUID | None, Query(alias="bankProductId")] = None,
    bank_id: Annotated[UUID | None, Query(alias="bankId")] = None,
    product_id: Annotated[UUID | None, Query(alias="productId")] = None,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
) -> dict[str, object]:
    rows = await list_product_variants(
        session,
        bank_product_id=bank_product_id,
        bank_id=bank_id,
        product_id=product_id,
        include_inactive=_include_inactive(actor, PRODUCT_VARIANTS_EDIT, include_inactive),
    )
    return {"items": [serialize_product_variant(row) for row in rows]}


@router.post("/product-variants")
async def product_variants_create(
    payload: ProductVariantCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCT_VARIANTS_CREATE))],
) -> dict[str, object]:
    return serialize_product_variant(
        await create_product_variant(
            session,
            actor,
            bank_product_id=payload.bank_product_id,
            name=payload.name,
            code=payload.code,
            description=payload.description,
        )
    )


@router.patch("/product-variants/{variant_id}")
async def product_variants_update(
    variant_id: UUID,
    payload: ProductVariantUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCT_VARIANTS_EDIT))],
) -> dict[str, object]:
    row = await get_product_variant(session, variant_id)
    return serialize_product_variant(
        await update_product_variant(
            session,
            actor,
            row,
            name=payload.name,
            description=payload.description,
        )
    )


@router.post("/product-variants/{variant_id}/deactivate")
async def product_variants_deactivate(
    variant_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCT_VARIANTS_DEACTIVATE))],
) -> dict[str, object]:
    row = await get_product_variant(session, variant_id)
    return serialize_product_variant(
        await set_product_variant_status(session, actor, row, MasterStatus.INACTIVE)
    )


@router.post("/product-variants/{variant_id}/activate")
async def product_variants_activate(
    variant_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCT_VARIANTS_ACTIVATE))],
) -> dict[str, object]:
    row = await get_product_variant(session, variant_id)
    return serialize_product_variant(
        await set_product_variant_status(session, actor, row, MasterStatus.ACTIVE)
    )


@router.delete("/product-variants/{variant_id}")
async def product_variants_delete(variant_id: UUID) -> None:
    delete_catalog_forbidden()
