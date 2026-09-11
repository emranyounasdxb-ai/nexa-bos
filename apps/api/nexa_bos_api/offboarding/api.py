from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from nexa_bos_api.api.v1.deps import CurrentUser, require_any_permission
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.offboarding import service
from nexa_bos_api.offboarding.schemas import (
    ClearanceUpdate,
    ExitAction,
    ExitCreate,
    ExitUpdate,
    SettlementUpdate,
)

router = APIRouter(prefix="/exits", tags=["employee-exits"])
ExitActor = Annotated[
    CurrentUser, Depends(require_any_permission("Exits.View", "Exits.ViewOwn", "Exits.Clearance"))
]


@router.get("")
async def listing(session: SessionDep, actor: ExitActor, status: str | None = None):
    return {"items": await service.listing(session, actor, status)}


@router.get("/options")
async def options(session: SessionDep, actor: ExitActor):
    return await service.options(session, actor)


@router.post("")
async def create(data: ExitCreate, session: SessionDep, actor: ExitActor):
    return await service.create(session, actor, data)


@router.get("/{exit_id}")
async def detail(exit_id: UUID, session: SessionDep, actor: ExitActor):
    return await service.detail(session, actor, exit_id)


@router.patch("/{exit_id}")
async def edit(exit_id: UUID, data: ExitUpdate, session: SessionDep, actor: ExitActor):
    return await service.edit(session, actor, exit_id, data)


@router.post("/{exit_id}/action")
async def action(exit_id: UUID, data: ExitAction, session: SessionDep, actor: ExitActor):
    return await service.action(session, actor, exit_id, data)


@router.patch("/{exit_id}/checklist/{key}")
async def checklist(
    exit_id: UUID, key: str, data: ClearanceUpdate, session: SessionDep, actor: ExitActor
):
    return await service.clear_item(session, actor, exit_id, key, data)


@router.patch("/{exit_id}/settlement")
async def settlement(exit_id: UUID, data: SettlementUpdate, session: SessionDep, actor: ExitActor):
    return await service.settlement(session, actor, exit_id, data)
