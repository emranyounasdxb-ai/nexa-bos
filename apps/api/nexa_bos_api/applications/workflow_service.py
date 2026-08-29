from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.applications.models import (
    Application,
    Workflow,
    WorkflowStage,
    WorkflowTransition,
    new_uuid,
)
from nexa_bos_api.applications.seed import (
    create_workflow_record,
    utcnow,
    workflow_load_options,
)
from nexa_bos_api.catalog.models import Bank, Product
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import MasterStatus, StageKind, StageSystemKey
from nexa_bos_api.identity.models import User


def serialize_stage(stage: WorkflowStage) -> dict[str, object]:
    return {
        "id": str(stage.id),
        "workflowId": str(stage.workflow_id),
        "code": stage.code,
        "name": stage.name,
        "kind": stage.kind,
        "systemKey": stage.system_key,
        "sortOrder": stage.sort_order,
        "status": stage.status,
    }


def serialize_workflow(workflow: Workflow, *, bank: Bank | None, product: Product | None) -> dict:
    return {
        "id": str(workflow.id),
        "bankId": str(workflow.bank_id),
        "productId": str(workflow.product_id),
        "version": workflow.version,
        "status": workflow.status,
        "bank": {"id": str(bank.id), "code": bank.code, "name": bank.name} if bank else None,
        "product": (
            {"id": str(product.id), "code": product.code, "name": product.name} if product else None
        ),
        "stages": [
            serialize_stage(row) for row in sorted(workflow.stages, key=lambda s: s.sort_order)
        ],
        "transitions": [
            {
                "id": str(row.id),
                "fromStageId": str(row.from_stage_id),
                "toStageId": str(row.to_stage_id),
            }
            for row in workflow.transitions
        ],
        "createdAt": workflow.created_at.isoformat(),
        "updatedAt": workflow.updated_at.isoformat(),
    }


async def load_workflow(session: AsyncSession, workflow_id: UUID) -> Workflow:
    row = (
        await session.execute(
            select(Workflow).options(*workflow_load_options()).where(Workflow.id == workflow_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError(status_code=404, code="WORKFLOW_NOT_FOUND", message="Workflow not found")
    return row


async def latest_active_workflow(
    session: AsyncSession, bank_id: UUID, product_id: UUID
) -> Workflow:
    row = (
        (
            await session.execute(
                select(Workflow)
                .options(*workflow_load_options())
                .where(
                    Workflow.bank_id == bank_id,
                    Workflow.product_id == product_id,
                    Workflow.status == MasterStatus.ACTIVE,
                )
                .order_by(Workflow.version.desc())
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        raise AppError(
            status_code=422,
            code="WORKFLOW_NOT_CONFIGURED",
            message=(
                "An active Bank and Product workflow must be configured "
                "before creating an application"
            ),
        )
    return row


async def list_workflows(
    session: AsyncSession, *, bank_id: UUID | None, product_id: UUID | None
) -> list[tuple[Workflow, Bank, Product]]:
    stmt = (
        select(Workflow, Bank, Product)
        .join(Bank, Workflow.bank_id == Bank.id)
        .join(Product, Workflow.product_id == Product.id)
        .options(*workflow_load_options())
        .order_by(Bank.code, Product.code, Workflow.version.desc())
    )
    if bank_id:
        stmt = stmt.where(Workflow.bank_id == bank_id)
    if product_id:
        stmt = stmt.where(Workflow.product_id == product_id)
    return list((await session.execute(stmt)).unique().all())


async def create_workflow_version(
    session: AsyncSession, actor: User, bank_id: UUID, product_id: UUID
) -> Workflow:
    latest = (
        (
            await session.execute(
                select(Workflow)
                .options(*workflow_load_options())
                .where(Workflow.bank_id == bank_id, Workflow.product_id == product_id)
                .order_by(Workflow.version.desc())
            )
        )
        .scalars()
        .first()
    )
    next_version = 1 if latest is None else latest.version + 1
    if latest is not None and latest.status == MasterStatus.ACTIVE:
        latest.status = MasterStatus.INACTIVE
        latest.updated_at = utcnow()
    created = await create_workflow_record(
        session, bank_id, product_id, version=next_version, copy_from=latest
    )
    await record_audit(
        session,
        action="workflow.version",
        entity_type="workflow",
        entity_id=str(created.id),
        actor_id=actor.id,
        new_values={"bankId": str(bank_id), "productId": str(product_id), "version": next_version},
    )
    await session.commit()
    return await load_workflow(session, created.id)


async def _assert_workflow_unused(session: AsyncSession, workflow: Workflow) -> None:
    used = (
        await session.execute(
            select(Application.id).where(Application.workflow_id == workflow.id).limit(1)
        )
    ).scalar_one_or_none()
    if used is not None:
        raise AppError(
            status_code=409,
            code="WORKFLOW_VERSION_IN_USE",
            message=(
                "This workflow version is in use by an application and cannot be mutated in place. "
                "Create a new workflow version."
            ),
        )


async def add_stage(
    session: AsyncSession, actor: User, workflow: Workflow, name: str, code: str, sort_order: int
) -> WorkflowStage:
    await _assert_workflow_unused(session, workflow)
    now = utcnow()
    normalized = code.strip().upper()
    duplicate = next((row for row in workflow.stages if row.code == normalized), None)
    if duplicate:
        raise AppError(
            status_code=409, code="STAGE_CODE_DUPLICATE", message="Stage code must be unique"
        )
    system_key = _system_key_for_code(normalized)
    if system_key == StageSystemKey.APPLICATION_CREATED:
        raise AppError(
            status_code=422,
            code="ENTRY_STAGE_LOCKED",
            message="Application Created is created with the workflow version",
        )
    stage = WorkflowStage(
        id=new_uuid(),
        workflow_id=workflow.id,
        code=normalized,
        name=name.strip(),
        kind=StageKind.NORMAL,
        system_key=system_key,
        sort_order=sort_order,
        status=MasterStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    session.add(stage)
    await record_audit(
        session,
        action="workflow_stage.create",
        entity_type="workflow_stage",
        entity_id=str(stage.id),
        actor_id=actor.id,
        new_values={"code": stage.code, "name": stage.name},
    )
    await session.commit()
    return stage


async def update_stage(
    session: AsyncSession,
    actor: User,
    stage: WorkflowStage,
    *,
    name: str | None,
    sort_order: int | None,
) -> WorkflowStage:
    workflow = await load_workflow(session, stage.workflow_id)
    await _assert_workflow_unused(session, workflow)
    if stage.system_key == StageSystemKey.APPLICATION_CREATED and name:
        if name.strip() != "Application Created":
            raise AppError(
                status_code=422,
                code="ENTRY_STAGE_LOCKED",
                message="Application Created is a globally fixed entry stage",
            )
    old = {"name": stage.name, "sortOrder": stage.sort_order}
    if name:
        stage.name = name.strip()
    if sort_order is not None:
        stage.sort_order = sort_order
    stage.updated_at = utcnow()
    await record_audit(
        session,
        action="workflow_stage.update",
        entity_type="workflow_stage",
        entity_id=str(stage.id),
        actor_id=actor.id,
        old_values=old,
        new_values={"name": stage.name, "sortOrder": stage.sort_order},
    )
    await session.commit()
    return stage


async def set_stage_status(
    session: AsyncSession, actor: User, stage: WorkflowStage, status: MasterStatus
) -> WorkflowStage:
    workflow = await load_workflow(session, stage.workflow_id)
    await _assert_workflow_unused(session, workflow)
    if stage.system_key == StageSystemKey.APPLICATION_CREATED and status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=422,
            code="ENTRY_STAGE_LOCKED",
            message="Application Created cannot be deactivated",
        )
    stage.status = status
    stage.updated_at = utcnow()
    await record_audit(
        session,
        action="workflow_stage.status",
        entity_type="workflow_stage",
        entity_id=str(stage.id),
        actor_id=actor.id,
        new_values={"status": status},
    )
    await session.commit()
    return stage


async def replace_transitions(
    session: AsyncSession, actor: User, workflow: Workflow, items: list[dict]
) -> Workflow:
    await _assert_workflow_unused(session, workflow)
    stage_ids = {row.id for row in workflow.stages}
    pairs: list[tuple[UUID, UUID]] = []
    for item in items:
        source = UUID(str(item.get("from_stage_id") or item.get("fromStageId")))
        target = UUID(str(item.get("to_stage_id") or item.get("toStageId")))
        if source not in stage_ids or target not in stage_ids:
            raise AppError(
                status_code=422,
                code="TRANSITION_STAGE_INVALID",
                message="Transitions must use stages from this workflow version",
            )
        if source == target:
            raise AppError(
                status_code=422,
                code="TRANSITION_SAME_STAGE",
                message="A stage cannot transition to itself",
            )
        pairs.append((source, target))
    for row in list(workflow.transitions):
        await session.delete(row)
    await session.flush()
    for source, target in pairs:
        session.add(
            WorkflowTransition(
                id=new_uuid(),
                workflow_id=workflow.id,
                from_stage_id=source,
                to_stage_id=target,
            )
        )
    workflow.updated_at = utcnow()
    await record_audit(
        session,
        action="workflow.transitions",
        entity_type="workflow",
        entity_id=str(workflow.id),
        actor_id=actor.id,
        new_values={"count": len(pairs)},
    )
    await session.commit()
    return await load_workflow(session, workflow.id)


def _system_key_for_code(code: str) -> str | None:
    compact = code.strip().lower().replace("-", "_").replace(" ", "_")
    for key in StageSystemKey:
        if compact in {key.value, key.name.lower()}:
            return key.value
    return None


async def load_stage(session: AsyncSession, stage_id: UUID) -> WorkflowStage:
    row = await session.get(WorkflowStage, stage_id)
    if row is None:
        raise AppError(status_code=404, code="STAGE_NOT_FOUND", message="Workflow stage not found")
    return row
