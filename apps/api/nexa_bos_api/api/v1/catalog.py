from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse

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
from nexa_bos_api.core.image_storage import (
    image_path,
    remove_image,
    store_image,
    validate_image_upload,
)
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.audit import record_audit
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
logger = logging.getLogger(__name__)
ImageFile = Annotated[UploadFile, File()]


async def _replace_image(
    session: SessionDep,
    actor: CurrentUser,
    row: Any,
    *,
    entity_type: str,
    category: str,
    file: UploadFile,
) -> None:
    image = await validate_image_upload(file)
    await session.refresh(row, with_for_update=True)
    new_key = store_image(image, category)
    old_key = row.image_key
    row.image_key = new_key
    row.image_content_type = image.content_type
    row.image_width = image.width
    row.image_height = image.height
    row.image_size_bytes = len(image.data)
    row.image_updated_at = datetime.now(UTC)
    try:
        await record_audit(
            session,
            action=(f"{entity_type}.image.replace" if old_key else f"{entity_type}.image.upload"),
            entity_type=entity_type,
            entity_id=str(row.id),
            actor_id=actor.id,
            old_values={"hasImage": bool(old_key)},
            new_values={
                "hasImage": True,
                "contentType": image.content_type,
                "width": image.width,
                "height": image.height,
                "sizeBytes": len(image.data),
            },
        )
        await session.commit()
    except Exception:
        await session.rollback()
        remove_image(new_key)
        raise
    if old_key:
        try:
            remove_image(old_key)
        except OSError:
            logger.warning("Could not remove replaced %s image", entity_type, exc_info=True)
    await session.refresh(row)


async def _remove_entity_image(
    session: SessionDep,
    actor: CurrentUser,
    row: Any,
    *,
    entity_type: str,
) -> None:
    await session.refresh(row, with_for_update=True)
    old_key = row.image_key
    if not old_key:
        return
    row.image_key = None
    row.image_content_type = None
    row.image_width = None
    row.image_height = None
    row.image_size_bytes = None
    row.image_updated_at = None
    try:
        await record_audit(
            session,
            action=f"{entity_type}.image.remove",
            entity_type=entity_type,
            entity_id=str(row.id),
            actor_id=actor.id,
            old_values={"hasImage": True},
            new_values={"hasImage": False},
        )
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    try:
        remove_image(old_key)
    except OSError:
        logger.warning("Could not remove deleted %s image", entity_type, exc_info=True)
    await session.refresh(row)


def _image_response(row: Any) -> FileResponse:
    if not row.image_key:
        raise AppError(status_code=404, code="IMAGE_NOT_FOUND", message="Image not found")
    path = image_path(row.image_key)
    if not path.is_file():
        raise AppError(status_code=404, code="IMAGE_NOT_FOUND", message="Image not found")
    return FileResponse(
        path,
        media_type=row.image_content_type or "application/octet-stream",
        filename=path.name,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff"},
    )


def _include_inactive(actor, permission: str | tuple[str, ...], requested: bool) -> bool:
    permissions = (permission,) if isinstance(permission, str) else permission
    return requested and any(has_permission(actor, code) for code in permissions)


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


@router.post("/banks/{bank_id}/image")
async def banks_image_upload(
    bank_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(BANKS_EDIT))],
    file: ImageFile,
) -> dict[str, object]:
    bank = await session.get(Bank, bank_id)
    if bank is None:
        raise AppError(status_code=404, code="BANK_NOT_FOUND", message="Bank not found")
    await _replace_image(
        session, actor, bank, entity_type="bank", category="catalogue/banks", file=file
    )
    return serialize_bank(bank)


@router.get("/banks/{bank_id}/image")
async def banks_image(bank_id: UUID, session: SessionDep, actor: CurrentUser) -> FileResponse:
    bank = await session.get(Bank, bank_id)
    if bank is None:
        raise AppError(status_code=404, code="BANK_NOT_FOUND", message="Bank not found")
    return _image_response(bank)


@router.delete("/banks/{bank_id}/image")
async def banks_image_remove(
    bank_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(BANKS_EDIT))],
) -> dict[str, object]:
    bank = await session.get(Bank, bank_id)
    if bank is None:
        raise AppError(status_code=404, code="BANK_NOT_FOUND", message="Bank not found")
    await _remove_entity_image(session, actor, bank, entity_type="bank")
    return serialize_bank(bank)


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


@router.post("/products/{product_id}/image")
async def products_image_upload(
    product_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCTS_EDIT))],
    file: ImageFile,
) -> dict[str, object]:
    product = await session.get(Product, product_id)
    if product is None:
        raise AppError(status_code=404, code="PRODUCT_NOT_FOUND", message="Product not found")
    await _replace_image(
        session,
        actor,
        product,
        entity_type="product",
        category="catalogue/products",
        file=file,
    )
    return serialize_product(product)


@router.get("/products/{product_id}/image")
async def products_image(product_id: UUID, session: SessionDep, actor: CurrentUser) -> FileResponse:
    product = await session.get(Product, product_id)
    if product is None:
        raise AppError(status_code=404, code="PRODUCT_NOT_FOUND", message="Product not found")
    return _image_response(product)


@router.delete("/products/{product_id}/image")
async def products_image_remove(
    product_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCTS_EDIT))],
) -> dict[str, object]:
    product = await session.get(Product, product_id)
    if product is None:
        raise AppError(status_code=404, code="PRODUCT_NOT_FOUND", message="Product not found")
    await _remove_entity_image(session, actor, product, entity_type="product")
    return serialize_product(product)


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
        include_inactive=_include_inactive(
            actor,
            (
                PRODUCT_VARIANTS_EDIT,
                PRODUCT_VARIANTS_ACTIVATE,
                PRODUCT_VARIANTS_DEACTIVATE,
            ),
            include_inactive,
        ),
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


@router.post("/product-variants/{variant_id}/image")
async def product_variants_image_upload(
    variant_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCT_VARIANTS_EDIT))],
    file: ImageFile,
) -> dict[str, object]:
    row = await get_product_variant(session, variant_id)
    await _replace_image(
        session,
        actor,
        row,
        entity_type="product_variant",
        category="catalogue/product-variants",
        file=file,
    )
    return serialize_product_variant(row)


@router.get("/product-variants/{variant_id}/image")
async def product_variants_image(
    variant_id: UUID, session: SessionDep, actor: CurrentUser
) -> FileResponse:
    row = await get_product_variant(session, variant_id)
    return _image_response(row)


@router.delete("/product-variants/{variant_id}/image")
async def product_variants_image_remove(
    variant_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(PRODUCT_VARIANTS_EDIT))],
) -> dict[str, object]:
    row = await get_product_variant(session, variant_id)
    await _remove_entity_image(session, actor, row, entity_type="product_variant")
    return serialize_product_variant(row)


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
