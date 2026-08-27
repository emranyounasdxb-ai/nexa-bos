from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.auth_service import public_user
from nexa_bos_api.identity.enums import AccountStatus
from nexa_bos_api.identity.permissions import (
    USERS_ACTIVATE,
    USERS_ASSIGN_USER_TYPE,
    USERS_CREATE,
    USERS_DEACTIVATE,
    USERS_EDIT,
    USERS_UNLOCK,
    USERS_VIEW,
    USERS_VIEW_AUDIT,
)
from nexa_bos_api.identity.schemas import (
    AssignUserTypeRequest,
    RehireRequest,
    SelfUpdateRequest,
    UserCreateRequest,
    UserUpdateRequest,
)
from nexa_bos_api.identity.users_service import (
    assign_user_type,
    create_user,
    get_visible_user,
    list_reporting_managers,
    list_users,
    photo_path,
    profile_history,
    rehire_user,
    save_photo,
    set_account_status,
    unlock_user,
    update_self_mobile,
    update_user,
)

router = APIRouter(prefix="/users", tags=["users"])

_PHOTO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
PhotoFile = Annotated[UploadFile, File()]


@router.get("")
async def directory(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_VIEW))],
    q: str | None = None,
    employment_status: Annotated[str | None, Query(alias="employmentStatus")] = None,
    account_status: Annotated[str | None, Query(alias="accountStatus")] = None,
    office_id: Annotated[UUID | None, Query(alias="officeId")] = None,
    department_id: Annotated[UUID | None, Query(alias="departmentId")] = None,
    user_type_id: Annotated[UUID | None, Query(alias="userTypeId")] = None,
) -> dict[str, object]:
    users = await list_users(
        session,
        actor,
        q=q,
        employment_status=employment_status,
        account_status=account_status,
        office_id=office_id,
        department_id=department_id,
        user_type_id=user_type_id,
    )
    return {"items": [public_user(user) for user in users]}


@router.get("/managers")
async def reporting_managers(
    session: SessionDep,
    actor: CurrentUser,
    exclude_user_id: Annotated[UUID | None, Query(alias="excludeUserId")] = None,
) -> dict[str, object]:
    if not (has_permission(actor, USERS_CREATE) or has_permission(actor, USERS_EDIT)):
        raise AppError(
            status_code=403,
            code="FORBIDDEN",
            message="You do not have permission to perform this action",
            details=[{"permission": USERS_EDIT}],
        )
    users = await list_reporting_managers(session, exclude_user_id=exclude_user_id)
    return {
        "items": [
            {
                "id": str(user.id),
                "userCode": user.user_code,
                "fullName": user.full_name,
            }
            for user in users
        ]
    }


@router.post("")
async def create_user_route(
    payload: UserCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_CREATE))],
) -> dict[str, object]:
    user = await create_user(session, actor, payload)
    return public_user(user)


@router.get("/me")
async def my_profile(user: CurrentUser) -> dict[str, object]:
    return public_user(user)


@router.patch("/me")
async def update_me(
    payload: SelfUpdateRequest, session: SessionDep, user: CurrentUser
) -> dict[str, object]:
    if payload.mobile is None:
        return public_user(user)
    updated = await update_self_mobile(session, user, payload.mobile)
    return public_user(updated)


@router.post("/me/photo")
async def update_my_photo(
    session: SessionDep,
    user: CurrentUser,
    file: PhotoFile,
) -> dict[str, object]:
    updated = await _store_photo(session, user, user, file)
    return public_user(updated)


@router.get("/{user_id}")
async def get_user(
    user_id: UUID,
    session: SessionDep,
    actor: CurrentUser,
) -> dict[str, object]:
    target = await get_visible_user(session, actor, user_id)
    if actor.id != target.id and not has_permission(actor, USERS_VIEW):
        raise AppError(
            status_code=403,
            code="FORBIDDEN",
            message="You do not have permission to perform this action",
            details=[{"permission": USERS_VIEW}],
        )
    return public_user(target)


@router.patch("/{user_id}")
async def edit_user(
    user_id: UUID,
    payload: UserUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_EDIT))],
) -> dict[str, object]:
    target = await get_visible_user(session, actor, user_id)
    updated = await update_user(session, actor, target, payload)
    return public_user(updated)


@router.post("/{user_id}/photo")
async def upload_photo(
    user_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_EDIT))],
    file: PhotoFile,
) -> dict[str, object]:
    target = await get_visible_user(session, actor, user_id)
    updated = await _store_photo(session, actor, target, file)
    return public_user(updated)


@router.get("/{user_id}/photo")
async def get_photo(user_id: UUID, session: SessionDep, actor: CurrentUser) -> FileResponse:
    target = await get_visible_user(session, actor, user_id)
    path = photo_path(target)
    if path is None:
        raise AppError(status_code=404, code="PHOTO_NOT_FOUND", message="No profile photo")
    return FileResponse(
        path,
        media_type=target.profile_photo_content_type or "application/octet-stream",
        filename=target.profile_photo_original_name or path.name,
    )


@router.post("/{user_id}/assign-type")
async def assign_type(
    user_id: UUID,
    payload: AssignUserTypeRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_ASSIGN_USER_TYPE))],
) -> dict[str, object]:
    target = await get_visible_user(session, actor, user_id)
    updated = await assign_user_type(session, actor, target, payload.user_type_id)
    return public_user(updated)


@router.post("/{user_id}/activate")
async def activate(
    user_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_ACTIVATE))],
) -> dict[str, object]:
    target = await get_visible_user(session, actor, user_id)
    updated = await set_account_status(session, actor, target, AccountStatus.ACTIVE)
    return public_user(updated)


@router.post("/{user_id}/deactivate")
async def deactivate(
    user_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_DEACTIVATE))],
) -> dict[str, object]:
    target = await get_visible_user(session, actor, user_id)
    updated = await set_account_status(session, actor, target, AccountStatus.DEACTIVATED)
    return public_user(updated)


@router.post("/{user_id}/rehire")
async def rehire(
    user_id: UUID,
    payload: RehireRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_EDIT))],
) -> dict[str, object]:
    target = await get_visible_user(session, actor, user_id)
    updated = await rehire_user(session, actor, target, payload)
    return public_user(updated)


@router.post("/{user_id}/unlock")
async def unlock(
    user_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_UNLOCK))],
) -> dict[str, object]:
    target = await get_visible_user(session, actor, user_id)
    updated = await unlock_user(session, actor, target)
    return public_user(updated)


@router.get("/{user_id}/history")
async def history(
    user_id: UUID,
    session: SessionDep,
    actor: CurrentUser,
) -> dict[str, object]:
    target = await get_visible_user(session, actor, user_id)
    data = await profile_history(session, target.id)
    if actor.id != target.id:
        if not has_permission(actor, USERS_VIEW_AUDIT):
            data = {
                "emails": data["emails"],
                "employeeCodes": data["employeeCodes"],
                "assignments": data["assignments"],
                "employmentPeriods": data["employmentPeriods"],
                "events": [],
            }
    return data


@router.delete("/{user_id}")
async def delete_forbidden(user_id: UUID) -> None:
    raise AppError(
        status_code=405, code="USER_DELETE_FORBIDDEN", message="User deletion is forbidden"
    )


async def _store_photo(session, actor, target, file: UploadFile):
    content_type = file.content_type or ""
    suffix = _PHOTO_TYPES.get(content_type)
    if suffix is None:
        raise AppError(
            status_code=422, code="PHOTO_TYPE", message="Photo must be JPEG, PNG, or WebP"
        )
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise AppError(
            status_code=422, code="PHOTO_TOO_LARGE", message="Photo must be 2MB or smaller"
        )
    return await save_photo(
        session,
        actor,
        target,
        data,
        suffix,
        content_type,
        file.filename or f"photo{suffix}",
    )
