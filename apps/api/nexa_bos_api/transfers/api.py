from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from nexa_bos_api.api.v1.deps import CurrentUser, require_any_permission
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.transfers import service
from nexa_bos_api.transfers.schemas import TransferAction, TransferCreate, TransferUpdate

router = APIRouter(prefix="/transfers", tags=["employee-transfers"])
TransferActor = Annotated[
    CurrentUser,
    Depends(require_any_permission("Transfers.View", "Transfers.ViewOwn", "Transfers.Recommend")),
]


@router.get("")
async def list_transfers(
    session: SessionDep,
    actor: TransferActor,
    status: str | None = None,
    employee_id: UUID | None = None,
):
    return {
        "items": await service.list_transfers(
            session, actor, status=status, employee_id=employee_id
        )
    }


@router.get("/options")
async def options(
    session: SessionDep,
    actor: Annotated[
        CurrentUser,
        Depends(
            require_any_permission("Transfers.Create", "Transfers.Recommend", "Transfers.Edit")
        ),
    ],
):
    return await service.options(session, actor)


@router.post("")
async def create(payload: TransferCreate, session: SessionDep, actor: TransferActor):
    return await service.create_transfer(session, actor, payload)


@router.post("/recommend")
async def recommend(payload: TransferCreate, session: SessionDep, actor: TransferActor):
    return await service.create_transfer(session, actor, payload, recommend=True)


@router.get("/{transfer_id}")
async def detail(transfer_id: UUID, session: SessionDep, actor: TransferActor):
    return await service.get_transfer(session, actor, transfer_id)


@router.patch("/{transfer_id}")
async def update(
    transfer_id: UUID, payload: TransferUpdate, session: SessionDep, actor: TransferActor
):
    return await service.edit_transfer(session, actor, transfer_id, payload)


@router.post("/{transfer_id}/action")
async def action(
    transfer_id: UUID, payload: TransferAction, session: SessionDep, actor: TransferActor
):
    return await service.action_transfer(session, actor, transfer_id, payload)
