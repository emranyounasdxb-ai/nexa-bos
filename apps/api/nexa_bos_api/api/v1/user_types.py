from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.enums import UserTypeStatus
from nexa_bos_api.identity.permissions import (
    PERMISSION_CATALOG,
    USER_TYPES_ACTIVATE,
    USER_TYPES_ASSIGN_PERMISSIONS,
    USER_TYPES_ASSIGN_SCOPE,
    USER_TYPES_CREATE,
    USER_TYPES_DEACTIVATE,
    USER_TYPES_EDIT,
    USER_TYPES_VIEW,
)
from nexa_bos_api.identity.schemas import (
    AssignApplicationScopeRequest,
    AssignCaseOwnerRequest,
    AssignCustomerScopeRequest,
    AssignPermissionsRequest,
    AssignScopeRequest,
    UserTypeCreateRequest,
    UserTypeUpdateRequest,
)
from nexa_bos_api.identity.user_types_service import (
    assign_application_scope,
    assign_case_owner_eligibility,
    assign_customer_scope,
    assign_permissions,
    assign_scope,
    create_custom_type,
    list_user_types,
    load_user_type,
    serialize_user_type,
    set_user_type_status,
    update_custom_type,
)

router = APIRouter(tags=["user-types"])


@router.get("/permissions")
async def list_permissions(
    _actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_VIEW))],
) -> dict[str, object]:
    return {
        "items": [
            {"code": code, "description": description} for code, description in PERMISSION_CATALOG
        ]
    }


@router.get("/user-types")
async def directory(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_VIEW))],
) -> dict[str, object]:
    rows = await list_user_types(session)
    return {"items": [serialize_user_type(row) for row in rows]}


@router.post("/user-types")
async def create_type(
    payload: UserTypeCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_CREATE))],
) -> dict[str, object]:
    row = await create_custom_type(session, actor, payload)
    return serialize_user_type(row)


@router.get("/user-types/{user_type_id}")
async def get_type(
    user_type_id: UUID,
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_VIEW))],
) -> dict[str, object]:
    row = await load_user_type(session, user_type_id)
    return serialize_user_type(row)


@router.patch("/user-types/{user_type_id}")
async def edit_type(
    user_type_id: UUID,
    payload: UserTypeUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_EDIT))],
) -> dict[str, object]:
    row = await load_user_type(session, user_type_id)
    updated = await update_custom_type(session, actor, row, payload)
    return serialize_user_type(updated)


@router.post("/user-types/{user_type_id}/activate")
async def activate_type(
    user_type_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_ACTIVATE))],
) -> dict[str, object]:
    row = await load_user_type(session, user_type_id)
    updated = await set_user_type_status(session, actor, row, UserTypeStatus.ACTIVE)
    return serialize_user_type(updated)


@router.post("/user-types/{user_type_id}/deactivate")
async def deactivate_type(
    user_type_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_DEACTIVATE))],
) -> dict[str, object]:
    row = await load_user_type(session, user_type_id)
    updated = await set_user_type_status(session, actor, row, UserTypeStatus.INACTIVE)
    return serialize_user_type(updated)


@router.put("/user-types/{user_type_id}/permissions")
async def set_permissions(
    user_type_id: UUID,
    payload: AssignPermissionsRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_ASSIGN_PERMISSIONS))],
) -> dict[str, object]:
    row = await load_user_type(session, user_type_id)
    updated = await assign_permissions(session, actor, row, payload.permissions)
    return serialize_user_type(updated)


@router.put("/user-types/{user_type_id}/scope")
async def set_scope(
    user_type_id: UUID,
    payload: AssignScopeRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_ASSIGN_SCOPE))],
) -> dict[str, object]:
    row = await load_user_type(session, user_type_id)
    updated = await assign_scope(session, actor, row, payload.visibility_scope)
    return serialize_user_type(updated)


@router.put("/user-types/{user_type_id}/customer-scope")
async def set_customer_scope(
    user_type_id: UUID,
    payload: AssignCustomerScopeRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_ASSIGN_SCOPE))],
) -> dict[str, object]:
    row = await load_user_type(session, user_type_id)
    updated = await assign_customer_scope(session, actor, row, payload.customer_visibility_scope)
    return serialize_user_type(updated)


@router.put("/user-types/{user_type_id}/application-scope")
async def set_application_scope(
    user_type_id: UUID,
    payload: AssignApplicationScopeRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_ASSIGN_SCOPE))],
) -> dict[str, object]:
    row = await load_user_type(session, user_type_id)
    updated = await assign_application_scope(
        session, actor, row, payload.application_visibility_scope
    )
    return serialize_user_type(updated)


@router.put("/user-types/{user_type_id}/case-owner")
async def set_case_owner_eligibility(
    user_type_id: UUID,
    payload: AssignCaseOwnerRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_TYPES_EDIT))],
) -> dict[str, object]:
    row = await load_user_type(session, user_type_id)
    updated = await assign_case_owner_eligibility(session, actor, row, payload.can_be_case_owner)
    return serialize_user_type(updated)
