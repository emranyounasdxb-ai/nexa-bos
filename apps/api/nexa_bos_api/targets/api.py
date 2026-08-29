from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.permissions import (
    TARGETS_ACTIVATE,
    TARGETS_CREATE,
    TARGETS_DEACTIVATE,
    TARGETS_EDIT,
    TARGETS_REOPEN_PERIOD,
    TARGETS_VIEW,
)
from nexa_bos_api.targets.schemas import (
    KpiScorecardCreateRequest,
    KpiScorecardUpdateRequest,
    TargetCreateRequest,
    TargetPeriodReopenRequest,
    TargetUpdateRequest,
)
from nexa_bos_api.targets.service import (
    create_scorecard,
    create_target,
    filter_options,
    get_scorecard,
    get_target,
    kpi_metric_catalog,
    list_periods,
    list_scorecards,
    list_targets,
    lock_period,
    reopen_period,
    set_scorecard_status,
    set_target_status,
    update_scorecard,
    update_target,
)

router = APIRouter(prefix="/targets", tags=["targets"])


@router.get("/options")
async def targets_options(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_VIEW))],
) -> dict[str, object]:
    return await filter_options(session, actor)


@router.get("/periods")
async def targets_periods(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_VIEW))],
) -> dict[str, object]:
    return await list_periods(session)


@router.post("/periods/{period_month}/lock")
async def targets_period_lock(
    period_month: date,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_EDIT))],
) -> dict[str, object]:
    return await lock_period(session, actor, period_month)


@router.post("/periods/{period_month}/reopen")
async def targets_period_reopen(
    period_month: date,
    payload: TargetPeriodReopenRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_REOPEN_PERIOD))],
) -> dict[str, object]:
    return await reopen_period(session, actor, period_month, payload.reason)


@router.get("/kpi/metrics")
async def kpi_metrics(
    _actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_VIEW))],
) -> dict[str, object]:
    return {"items": kpi_metric_catalog()}


@router.get("/kpi")
async def kpi_list(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_VIEW))],
) -> dict[str, object]:
    return await list_scorecards(session)


@router.post("/kpi")
async def kpi_create(
    payload: KpiScorecardCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_CREATE))],
) -> dict[str, object]:
    return await create_scorecard(session, actor, payload)


@router.get("/kpi/{scorecard_id}")
async def kpi_get(
    scorecard_id: UUID,
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_VIEW))],
) -> dict[str, object]:
    return await get_scorecard(session, scorecard_id)


@router.patch("/kpi/{scorecard_id}")
async def kpi_update(
    scorecard_id: UUID,
    payload: KpiScorecardUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_EDIT))],
) -> dict[str, object]:
    return await update_scorecard(session, actor, scorecard_id, payload)


@router.post("/kpi/{scorecard_id}/activate")
async def kpi_activate(
    scorecard_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_ACTIVATE))],
) -> dict[str, object]:
    return await set_scorecard_status(session, actor, scorecard_id, active=True)


@router.post("/kpi/{scorecard_id}/deactivate")
async def kpi_deactivate(
    scorecard_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_DEACTIVATE))],
) -> dict[str, object]:
    return await set_scorecard_status(session, actor, scorecard_id, active=False)


@router.get("")
async def targets_list(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_VIEW))],
    level: str | None = None,
    entity_id: UUID | None = None,
    period_month: date | None = None,
    product_id: UUID | None = None,
    bank_id: UUID | None = None,
    milestone: str | None = None,
    status: str | None = None,
    period: Annotated[str, Query()] = "month",
) -> dict[str, object]:
    return await list_targets(
        session,
        actor,
        level=level,
        entity_id=entity_id,
        period_month=period_month,
        product_id=product_id,
        bank_id=bank_id,
        milestone=milestone,
        status=status,
        period=period,
    )


@router.post("")
async def targets_create(
    payload: TargetCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_CREATE))],
) -> dict[str, object]:
    return await create_target(session, actor, payload)


@router.get("/{target_id}")
async def targets_get(
    target_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_VIEW))],
    period: Annotated[str, Query()] = "month",
) -> dict[str, object]:
    return await get_target(session, actor, target_id, period=period)


@router.patch("/{target_id}")
async def targets_update(
    target_id: UUID,
    payload: TargetUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_EDIT))],
) -> dict[str, object]:
    return await update_target(session, actor, target_id, payload)


@router.post("/{target_id}/activate")
async def targets_activate(
    target_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_ACTIVATE))],
) -> dict[str, object]:
    return await set_target_status(session, actor, target_id, active=True)


@router.post("/{target_id}/deactivate")
async def targets_deactivate(
    target_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TARGETS_DEACTIVATE))],
) -> dict[str, object]:
    return await set_target_status(session, actor, target_id, active=False)
