from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from nexa_bos_api.api.v1.deps import CurrentUser
from nexa_bos_api.approvals import service
from nexa_bos_api.approvals.schemas import Decision, Module, QueueFilters
from nexa_bos_api.db.session import SessionDep

router = APIRouter(prefix="/approvals", tags=["hr-approvals"])


@router.get("")
async def queue(session: SessionDep, actor: CurrentUser, filters: Annotated[QueueFilters, Query()]):
    return await service.queue(session, actor, filters)


@router.get("/dashboard")
async def dashboard(session: SessionDep, actor: CurrentUser):
    return await service.dashboard(session, actor)


@router.get("/me")
async def personal(session: SessionDep, actor: CurrentUser):
    return await service.personal(session, actor)


@router.post("/reminders")
async def reminders(session: SessionDep, actor: CurrentUser):
    return await service.reminders(session, actor)


@router.post("/{module}/{record_id}/decision")
async def decide(
    module: Module, record_id: UUID, data: Decision, session: SessionDep, actor: CurrentUser
):
    return await service.decide(session, actor, module, record_id, data)
