from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse, Response

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.employee_profiles.schemas import (
    BasicProfileUpdate,
    DocumentActionRequest,
    EmployeeDocumentCreate,
    EmployeeDocumentUpdate,
    HRProfileUpdate,
)
from nexa_bos_api.employee_profiles.service import (
    create_document,
    document_file,
    document_history,
    get_profile,
    hr_dashboard,
    inactivate_document,
    pro_dashboard,
    purge_document,
    update_basic_profile,
    update_document_metadata,
    update_hr_profile,
    upload_document_file,
)
from nexa_bos_api.identity.permissions import USER_PROFILES_HR_VIEW, USER_PROFILES_PRO_VIEW

router = APIRouter(prefix="/employee-profiles", tags=["employee-profiles"])
DocumentFile = Annotated[UploadFile, File()]


@router.get("/dashboards/hr")
async def hr_dashboard_route(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_PROFILES_HR_VIEW))],
) -> dict[str, object]:
    return await hr_dashboard(session, actor)


@router.get("/dashboards/pro")
async def pro_dashboard_route(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USER_PROFILES_PRO_VIEW))],
) -> dict[str, object]:
    return await pro_dashboard(session, actor)


@router.get("/{user_id}")
async def profile_route(
    user_id: UUID, session: SessionDep, actor: CurrentUser
) -> dict[str, object]:
    return await get_profile(session, actor, user_id)


@router.patch("/{user_id}/basic")
async def update_basic_route(
    user_id: UUID, payload: BasicProfileUpdate, session: SessionDep, actor: CurrentUser
) -> dict[str, object]:
    return await update_basic_profile(session, actor, user_id, payload)


@router.put("/{user_id}/hr")
async def update_hr_route(
    user_id: UUID, payload: HRProfileUpdate, session: SessionDep, actor: CurrentUser
) -> dict[str, object]:
    return await update_hr_profile(session, actor, user_id, payload)


@router.post("/{user_id}/documents", status_code=201)
async def create_document_route(
    user_id: UUID,
    payload: EmployeeDocumentCreate,
    session: SessionDep,
    actor: CurrentUser,
) -> dict[str, object]:
    return await create_document(session, actor, user_id, payload)


@router.patch("/{user_id}/documents/{document_id}")
async def update_document_route(
    user_id: UUID,
    document_id: UUID,
    payload: EmployeeDocumentUpdate,
    session: SessionDep,
    actor: CurrentUser,
) -> dict[str, object]:
    return await update_document_metadata(session, actor, user_id, document_id, payload)


@router.post("/{user_id}/documents/{document_id}/upload")
async def upload_document_route(
    user_id: UUID,
    document_id: UUID,
    session: SessionDep,
    actor: CurrentUser,
    file: DocumentFile,
) -> dict[str, object]:
    return await upload_document_file(
        session, actor, user_id, document_id, file, reason=None, replace=False
    )


@router.post("/{user_id}/documents/{document_id}/replace")
async def replace_document_route(
    user_id: UUID,
    document_id: UUID,
    session: SessionDep,
    actor: CurrentUser,
    file: DocumentFile,
    reason: Annotated[str, Form(min_length=3, max_length=500)],
) -> dict[str, object]:
    return await upload_document_file(
        session, actor, user_id, document_id, file, reason=reason, replace=True
    )


@router.get("/{user_id}/documents/{document_id}/view")
async def view_document_route(
    user_id: UUID, document_id: UUID, session: SessionDep, actor: CurrentUser
) -> FileResponse:
    path, row = await document_file(session, actor, user_id, document_id, download=False)
    return FileResponse(
        path,
        media_type=row.content_type or "application/octet-stream",
        filename=row.original_filename or "document",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/{user_id}/documents/{document_id}/download")
async def download_document_route(
    user_id: UUID, document_id: UUID, session: SessionDep, actor: CurrentUser
) -> FileResponse:
    path, row = await document_file(session, actor, user_id, document_id, download=True)
    return FileResponse(
        path,
        media_type=row.content_type or "application/octet-stream",
        filename=row.original_filename or "document",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/{user_id}/documents/{document_id}/history")
async def document_history_route(
    user_id: UUID, document_id: UUID, session: SessionDep, actor: CurrentUser
) -> dict[str, object]:
    return {"items": await document_history(session, actor, user_id, document_id)}


@router.delete("/{user_id}/documents/{document_id}", status_code=204)
async def delete_document_route(
    user_id: UUID,
    document_id: UUID,
    payload: DocumentActionRequest,
    session: SessionDep,
    actor: CurrentUser,
) -> Response:
    await inactivate_document(session, actor, user_id, document_id, payload.reason)
    return Response(status_code=204)


@router.delete("/{user_id}/documents/{document_id}/purge")
async def purge_document_route(
    user_id: UUID,
    document_id: UUID,
    payload: DocumentActionRequest,
    session: SessionDep,
    actor: CurrentUser,
) -> dict[str, int]:
    return {
        "versionsPurged": await purge_document(session, actor, user_id, document_id, payload.reason)
    }
