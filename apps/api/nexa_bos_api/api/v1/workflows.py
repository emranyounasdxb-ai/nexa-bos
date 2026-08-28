from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.applications.schemas import (
    WorkflowCreateRequest,
    WorkflowStageCreateRequest,
    WorkflowStageUpdateRequest,
    WorkflowTransitionsRequest,
)
from nexa_bos_api.applications.workflow_service import (
    add_stage,
    create_workflow_version,
    list_workflows,
    load_stage,
    load_workflow,
    replace_transitions,
    serialize_stage,
    serialize_workflow,
    set_stage_status,
    update_stage,
)
from nexa_bos_api.catalog.models import Bank, Product
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.enums import MasterStatus
from nexa_bos_api.identity.permissions import (
    APPLICATIONS_VIEW,
    WORKFLOW_STAGES_ACTIVATE,
    WORKFLOW_STAGES_CONFIGURE_TRANSITIONS,
    WORKFLOW_STAGES_CREATE,
    WORKFLOW_STAGES_DEACTIVATE,
    WORKFLOW_STAGES_EDIT,
)

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("")
async def workflows_list(
    session: SessionDep,
    actor: CurrentUser,
    bank_id: UUID | None = None,
    product_id: UUID | None = None,
) -> dict[str, object]:
    if not (
        has_permission(actor, WORKFLOW_STAGES_EDIT) or has_permission(actor, APPLICATIONS_VIEW)
    ):
        raise AppError(
            status_code=403,
            code="FORBIDDEN",
            message="You do not have permission to perform this action",
        )
    rows = await list_workflows(session, bank_id=bank_id, product_id=product_id)
    return {
        "items": [
            serialize_workflow(workflow, bank=bank, product=product)
            for workflow, bank, product in rows
        ]
    }


@router.post("")
async def workflows_create(
    payload: WorkflowCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(WORKFLOW_STAGES_CREATE))],
) -> dict[str, object]:
    workflow = await create_workflow_version(session, actor, payload.bank_id, payload.product_id)
    bank = await session.get(Bank, workflow.bank_id)
    product = await session.get(Product, workflow.product_id)
    return serialize_workflow(workflow, bank=bank, product=product)


@router.get("/{workflow_id}")
async def workflows_get(
    workflow_id: UUID,
    session: SessionDep,
    actor: CurrentUser,
) -> dict[str, object]:
    if not (
        has_permission(actor, WORKFLOW_STAGES_EDIT) or has_permission(actor, APPLICATIONS_VIEW)
    ):
        raise AppError(
            status_code=403,
            code="FORBIDDEN",
            message="You do not have permission to perform this action",
        )
    workflow = await load_workflow(session, workflow_id)
    bank = await session.get(Bank, workflow.bank_id)
    product = await session.get(Product, workflow.product_id)
    return serialize_workflow(workflow, bank=bank, product=product)


@router.post("/{workflow_id}/stages")
async def workflows_add_stage(
    workflow_id: UUID,
    payload: WorkflowStageCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(WORKFLOW_STAGES_CREATE))],
) -> dict[str, object]:
    workflow = await load_workflow(session, workflow_id)
    stage = await add_stage(
        session, actor, workflow, payload.name, payload.code, payload.sort_order
    )
    return serialize_stage(stage)


@router.put("/{workflow_id}/transitions")
async def workflows_transitions(
    workflow_id: UUID,
    payload: WorkflowTransitionsRequest,
    session: SessionDep,
    actor: Annotated[
        CurrentUser, Depends(require_permission(WORKFLOW_STAGES_CONFIGURE_TRANSITIONS))
    ],
) -> dict[str, object]:
    workflow = await load_workflow(session, workflow_id)
    updated = await replace_transitions(session, actor, workflow, payload.items)
    bank = await session.get(Bank, updated.bank_id)
    product = await session.get(Product, updated.product_id)
    return serialize_workflow(updated, bank=bank, product=product)


@router.patch("/stages/{stage_id}")
async def workflows_update_stage(
    stage_id: UUID,
    payload: WorkflowStageUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(WORKFLOW_STAGES_EDIT))],
) -> dict[str, object]:
    stage = await load_stage(session, stage_id)
    updated = await update_stage(
        session, actor, stage, name=payload.name, sort_order=payload.sort_order
    )
    return serialize_stage(updated)


@router.post("/stages/{stage_id}/activate")
async def workflows_activate_stage(
    stage_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(WORKFLOW_STAGES_ACTIVATE))],
) -> dict[str, object]:
    stage = await load_stage(session, stage_id)
    return serialize_stage(await set_stage_status(session, actor, stage, MasterStatus.ACTIVE))


@router.post("/stages/{stage_id}/deactivate")
async def workflows_deactivate_stage(
    stage_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(WORKFLOW_STAGES_DEACTIVATE))],
) -> dict[str, object]:
    stage = await load_stage(session, stage_id)
    return serialize_stage(await set_stage_status(session, actor, stage, MasterStatus.INACTIVE))
