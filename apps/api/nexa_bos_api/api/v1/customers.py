from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.api.v1.pagination import PaginationDep
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.customers.schemas import (
    CustomerCreateRequest,
    CustomerMergeRequest,
    CustomerUpdateRequest,
)
from nexa_bos_api.customers.service import (
    create_customer,
    customer_history,
    get_visible_customer,
    list_customers,
    merge_customers,
    serialize_customer,
    set_customer_status,
    update_customer,
)
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.enums import CustomerStatus
from nexa_bos_api.identity.permissions import (
    CUSTOMERS_ACTIVATE,
    CUSTOMERS_CREATE,
    CUSTOMERS_DEACTIVATE,
    CUSTOMERS_EDIT,
    CUSTOMERS_MERGE,
    CUSTOMERS_VIEW,
)

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("")
async def customers_list(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CUSTOMERS_VIEW))],
    pagination: PaginationDep,
    q: str | None = None,
    status: str | None = None,
) -> dict[str, object]:
    rows = await list_customers(
        session,
        actor,
        q=q,
        status=status,
        page=pagination.page,
        page_size=pagination.page_size,
    )
    return {
        "items": [serialize_customer(row) for row in rows.items],
        "pagination": rows.metadata(),
    }


@router.post("")
async def customers_create(
    payload: CustomerCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CUSTOMERS_CREATE))],
) -> dict[str, object]:
    return serialize_customer(await create_customer(session, actor, payload))


@router.get("/{customer_id}")
async def customers_get(
    customer_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CUSTOMERS_VIEW))],
) -> dict[str, object]:
    customer = await get_visible_customer(session, actor, customer_id)
    return serialize_customer(customer)


@router.get("/{customer_id}/history")
async def customers_history(
    customer_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CUSTOMERS_VIEW))],
) -> dict[str, object]:
    customer = await get_visible_customer(session, actor, customer_id)
    return await customer_history(session, customer)


@router.patch("/{customer_id}")
async def customers_update(
    customer_id: UUID,
    payload: CustomerUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CUSTOMERS_EDIT))],
) -> dict[str, object]:
    customer = await get_visible_customer(session, actor, customer_id)
    return serialize_customer(await update_customer(session, actor, customer, payload))


@router.post("/{customer_id}/deactivate")
async def customers_deactivate(
    customer_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CUSTOMERS_DEACTIVATE))],
) -> dict[str, object]:
    customer = await get_visible_customer(session, actor, customer_id)
    return serialize_customer(
        await set_customer_status(session, actor, customer, CustomerStatus.INACTIVE)
    )


@router.post("/{customer_id}/activate")
async def customers_activate(
    customer_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CUSTOMERS_ACTIVATE))],
) -> dict[str, object]:
    customer = await get_visible_customer(session, actor, customer_id)
    return serialize_customer(
        await set_customer_status(session, actor, customer, CustomerStatus.ACTIVE)
    )


@router.post("/{customer_id}/merge")
async def customers_merge(
    customer_id: UUID,
    payload: CustomerMergeRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CUSTOMERS_MERGE))],
) -> dict[str, object]:
    source = await get_visible_customer(session, actor, customer_id)
    return serialize_customer(
        await merge_customers(session, actor, source, payload.primary_customer_id)
    )


@router.delete("/{customer_id}")
async def customers_delete(customer_id: UUID) -> None:
    raise AppError(
        status_code=405,
        code="CUSTOMER_DELETE_FORBIDDEN",
        message="Customers cannot be deleted",
    )
