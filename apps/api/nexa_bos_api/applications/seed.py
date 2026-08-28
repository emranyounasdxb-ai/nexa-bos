from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.applications.models import Workflow, WorkflowStage, WorkflowTransition, new_uuid
from nexa_bos_api.identity.enums import MasterStatus, StageKind, StageSystemKey


def utcnow() -> datetime:
    return datetime.now(UTC)


async def create_workflow_record(
    session: AsyncSession,
    bank_id,
    product_id,
    *,
    version: int,
    copy_from: Workflow | None,
) -> Workflow:
    now = utcnow()
    workflow = Workflow(
        id=new_uuid(),
        bank_id=bank_id,
        product_id=product_id,
        version=version,
        status=MasterStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    session.add(workflow)
    await session.flush()
    if copy_from is None:
        session.add(
            WorkflowStage(
                id=new_uuid(),
                workflow_id=workflow.id,
                code="APPLICATION_CREATED",
                name="Application Created",
                kind=StageKind.ENTRY,
                system_key=StageSystemKey.APPLICATION_CREATED,
                sort_order=10,
                status=MasterStatus.ACTIVE,
                created_at=now,
                updated_at=now,
            )
        )
        await session.flush()
        return workflow
    old_to_new: dict[object, object] = {}
    stages = sorted(copy_from.stages, key=lambda row: row.sort_order)
    for row in stages:
        stage = WorkflowStage(
            id=new_uuid(),
            workflow_id=workflow.id,
            code=row.code,
            name=row.name,
            kind=row.kind,
            system_key=row.system_key,
            sort_order=row.sort_order,
            status=row.status,
            created_at=now,
            updated_at=now,
        )
        session.add(stage)
        await session.flush()
        old_to_new[row.id] = stage.id
    for row in copy_from.transitions:
        session.add(
            WorkflowTransition(
                id=new_uuid(),
                workflow_id=workflow.id,
                from_stage_id=old_to_new[row.from_stage_id],
                to_stage_id=old_to_new[row.to_stage_id],
            )
        )
    return workflow


def entry_stage(workflow: Workflow) -> WorkflowStage:
    for row in workflow.stages:
        if row.system_key == StageSystemKey.APPLICATION_CREATED:
            return row
        if row.kind == StageKind.ENTRY:
            return row
    return min(workflow.stages, key=lambda item: item.sort_order)


def stage_by_key(workflow: Workflow, key: str) -> WorkflowStage | None:
    for row in workflow.stages:
        if row.system_key == key and row.status == MasterStatus.ACTIVE:
            return row
    return None


def workflow_load_options():
    return (selectinload(Workflow.stages), selectinload(Workflow.transitions))
