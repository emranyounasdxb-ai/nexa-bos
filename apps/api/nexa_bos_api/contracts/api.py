from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse

from nexa_bos_api.api.v1.deps import CurrentUser, require_any_permission, require_permission
from nexa_bos_api.contracts.schemas import (
    ContractAction,
    ContractCancel,
    ContractCreate,
    ContractDecision,
    ContractTypeCreate,
    ContractTypeUpdate,
    ContractUpdate,
)
from nexa_bos_api.contracts.service import (
    activate_contract,
    attachment_file,
    cancel_contract,
    create_contract,
    create_type,
    decide_contract,
    employee_options,
    get_contract,
    list_contracts,
    list_types,
    own_active_contract,
    reminders,
    submit_contract,
    update_contract,
    update_type,
    upload_attachment,
)
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.permissions import (
    CONTRACTS_APPROVE,
    CONTRACTS_CANCEL,
    CONTRACTS_CREATE,
    CONTRACTS_EDIT,
    CONTRACTS_RETURN_REJECT,
    CONTRACTS_SETTINGS,
    CONTRACTS_VIEW,
    CONTRACTS_VIEW_OWN,
)

router = APIRouter(prefix="/contracts", tags=["contracts"])
ContractFile = Annotated[UploadFile, File()]


@router.get("/types")
async def contract_types(
    session: SessionDep,
    _actor: Annotated[
        CurrentUser,
        Depends(require_any_permission(CONTRACTS_VIEW_OWN, CONTRACTS_VIEW, CONTRACTS_SETTINGS)),
    ],
    include_inactive: bool = False,
) -> dict[str, object]:
    return {"items": await list_types(session, include_inactive=include_inactive)}


@router.post("/types")
async def contract_types_create(
    payload: ContractTypeCreate,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_SETTINGS))],
) -> dict[str, object]:
    return await create_type(session, actor, payload)


@router.patch("/types/{type_id}")
async def contract_types_update(
    type_id: UUID,
    payload: ContractTypeUpdate,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_SETTINGS))],
) -> dict[str, object]:
    return await update_type(session, actor, type_id, payload)


@router.get("/employees")
async def contract_employees(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_CREATE))],
) -> dict[str, object]:
    return {"items": await employee_options(session)}


@router.get("")
async def contracts_list(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_VIEW))],
    status: str | None = None,
    employee_id: UUID | None = None,
) -> dict[str, object]:
    return {"items": await list_contracts(session, actor, status=status, employee_id=employee_id)}


@router.get("/me/active")
async def contracts_own_active(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_VIEW_OWN))],
) -> dict[str, object]:
    return {"item": await own_active_contract(session, actor)}


@router.get("/reminders")
async def contract_reminders(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_VIEW))],
) -> dict[str, object]:
    return {"items": await reminders(session, actor)}


@router.post("")
async def contracts_create(
    payload: ContractCreate,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_CREATE))],
) -> dict[str, object]:
    return await create_contract(session, actor, payload)


@router.get("/{contract_id}")
async def contracts_get(
    contract_id: UUID,
    session: SessionDep,
    actor: Annotated[
        CurrentUser, Depends(require_any_permission(CONTRACTS_VIEW_OWN, CONTRACTS_VIEW))
    ],
) -> dict[str, object]:
    return await get_contract(session, actor, contract_id)


@router.patch("/{contract_id}")
async def contracts_update(
    contract_id: UUID,
    payload: ContractUpdate,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_EDIT))],
) -> dict[str, object]:
    return await update_contract(session, actor, contract_id, payload)


@router.post("/{contract_id}/submit")
async def contracts_submit(
    contract_id: UUID,
    payload: ContractAction,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_CREATE))],
) -> dict[str, object]:
    return await submit_contract(session, actor, contract_id, payload)


@router.post("/{contract_id}/activate")
async def contracts_activate(
    contract_id: UUID,
    payload: ContractAction,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_APPROVE))],
) -> dict[str, object]:
    return await activate_contract(session, actor, contract_id, payload)


@router.post("/{contract_id}/decision")
async def contracts_decide(
    contract_id: UUID,
    payload: ContractDecision,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_RETURN_REJECT))],
) -> dict[str, object]:
    return await decide_contract(session, actor, contract_id, payload)


@router.post("/{contract_id}/cancel")
async def contracts_cancel(
    contract_id: UUID,
    payload: ContractCancel,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CONTRACTS_CANCEL))],
) -> dict[str, object]:
    return await cancel_contract(session, actor, contract_id, payload)


@router.post("/{contract_id}/attachment")
async def contracts_attachment_upload(
    contract_id: UUID,
    session: SessionDep,
    actor: Annotated[
        CurrentUser, Depends(require_any_permission(CONTRACTS_CREATE, CONTRACTS_EDIT))
    ],
    upload: ContractFile,
    reason: str | None = Form(default=None),
) -> dict[str, object]:
    return await upload_attachment(session, actor, contract_id, upload, reason=reason)


@router.get("/{contract_id}/attachments/{attachment_id}/file")
async def contracts_attachment_download(
    contract_id: UUID,
    attachment_id: UUID,
    session: SessionDep,
    actor: Annotated[
        CurrentUser, Depends(require_any_permission(CONTRACTS_VIEW_OWN, CONTRACTS_VIEW))
    ],
) -> FileResponse:
    path, content_type, filename = await attachment_file(session, actor, contract_id, attachment_id)
    return FileResponse(path, media_type=content_type, filename=filename)
