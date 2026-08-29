from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse, Response

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.finance.export import build_excel, build_pdf, build_print_html
from nexa_bos_api.finance.schemas import (
    AdjustmentCreateRequest,
    ClawbackCreateRequest,
    CommissionRuleCreateRequest,
    FinanceExportRequest,
    IncentivePlanCreateRequest,
    PeriodReopenRequest,
)
from nexa_bos_api.finance.service import (
    add_adjustment,
    add_clawback,
    create_incentive_plan,
    create_rule,
    finalize_period,
    finance_options,
    generate_period,
    get_rule,
    list_incentive_plans,
    list_periods,
    list_rules,
    payout_components,
    period_payload,
    reopen_period,
    review_period,
    set_incentive_plan_status,
    set_rule_status,
    statement_payload,
)
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.permissions import (
    FINANCE_EDIT_ADJUSTMENT,
    FINANCE_FINALIZE,
    FINANCE_GENERATE_PAYOUT,
    FINANCE_MANAGE_COMMISSION_RULES,
    FINANCE_REOPEN_PERIOD,
    FINANCE_REVIEW,
    FINANCE_VIEW,
    FINANCE_VIEW_COMMISSION_RULES,
)

router = APIRouter(prefix="/finance", tags=["finance"])


@router.get("/options")
async def options(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_VIEW_COMMISSION_RULES))],
) -> dict[str, object]:
    return await finance_options(session)


@router.get("/commission-rules")
async def commission_rules(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_VIEW_COMMISSION_RULES))],
) -> dict[str, object]:
    return await list_rules(session)


@router.post("/commission-rules")
async def commission_rule_create(
    payload: CommissionRuleCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_MANAGE_COMMISSION_RULES))],
) -> dict[str, object]:
    return await create_rule(session, actor, payload)


@router.get("/commission-rules/{rule_id}")
async def commission_rule_get(
    rule_id: UUID,
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_VIEW_COMMISSION_RULES))],
) -> dict[str, object]:
    return await get_rule(session, rule_id)


@router.post("/commission-rules/{rule_id}/activate")
async def commission_rule_activate(
    rule_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_MANAGE_COMMISSION_RULES))],
) -> dict[str, object]:
    return await set_rule_status(session, actor, rule_id, active=True)


@router.post("/commission-rules/{rule_id}/deactivate")
async def commission_rule_deactivate(
    rule_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_MANAGE_COMMISSION_RULES))],
) -> dict[str, object]:
    return await set_rule_status(session, actor, rule_id, active=False)


@router.get("/incentive-plans")
async def incentive_plans(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_VIEW_COMMISSION_RULES))],
) -> dict[str, object]:
    return await list_incentive_plans(session)


@router.post("/incentive-plans")
async def incentive_plan_create(
    payload: IncentivePlanCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_MANAGE_COMMISSION_RULES))],
) -> dict[str, object]:
    return await create_incentive_plan(session, actor, payload)


@router.post("/incentive-plans/{plan_id}/activate")
async def incentive_plan_activate(
    plan_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_MANAGE_COMMISSION_RULES))],
) -> dict[str, object]:
    return await set_incentive_plan_status(session, actor, plan_id, active=True)


@router.post("/incentive-plans/{plan_id}/deactivate")
async def incentive_plan_deactivate(
    plan_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_MANAGE_COMMISSION_RULES))],
) -> dict[str, object]:
    return await set_incentive_plan_status(session, actor, plan_id, active=False)


@router.get("/periods")
async def periods(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_VIEW))],
) -> dict[str, object]:
    return await list_periods(session, actor)


@router.get("/periods/{period_id}")
async def period_get(
    period_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_VIEW))],
) -> dict[str, object]:
    return await period_payload(session, actor, period_id)


@router.post("/periods/{period_month}/generate")
async def period_generate(
    period_month: date,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_GENERATE_PAYOUT))],
) -> dict[str, object]:
    return await generate_period(session, actor, period_month)


@router.post("/periods/{period_month}/review")
async def period_review(
    period_month: date,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_REVIEW))],
) -> dict[str, object]:
    return await review_period(session, actor, period_month)


@router.post("/periods/{period_month}/finalize")
async def period_finalize(
    period_month: date,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_FINALIZE))],
) -> dict[str, object]:
    return await finalize_period(session, actor, period_month)


@router.post("/periods/{period_month}/reopen")
async def period_reopen(
    period_month: date,
    payload: PeriodReopenRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_REOPEN_PERIOD))],
) -> dict[str, object]:
    return await reopen_period(session, actor, period_month, payload.reason)


@router.post("/periods/{period_month}/adjustments")
async def adjustment_create(
    period_month: date,
    payload: AdjustmentCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_EDIT_ADJUSTMENT))],
) -> dict[str, object]:
    return await add_adjustment(session, actor, period_month, payload)


@router.post("/periods/{period_month}/clawbacks")
async def clawback_create(
    period_month: date,
    payload: ClawbackCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_EDIT_ADJUSTMENT))],
) -> dict[str, object]:
    return await add_clawback(session, actor, period_month, payload)


@router.get("/statements")
async def statements(
    period_month: date,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_VIEW))],
    recipient_id: UUID | None = None,
) -> dict[str, object]:
    return await statement_payload(session, actor, period_month, recipient_id)


@router.get("/payouts/{payout_id}/components")
async def components(
    payout_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_VIEW))],
) -> dict[str, object]:
    return await payout_components(session, actor, payout_id)


@router.post("/export")
async def export_statement(
    payload: FinanceExportRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(FINANCE_VIEW))],
) -> Response:
    statement = await statement_payload(session, actor, payload.period_month, payload.recipient_id)
    await record_audit(
        session,
        action="finance.statement.export",
        entity_type="finance_statement",
        entity_id=payload.period_month.isoformat(),
        actor_id=actor.id,
        new_values={
            "format": payload.format,
            "periodMonth": payload.period_month.isoformat(),
            "recipientId": str(payload.recipient_id) if payload.recipient_id else None,
            "reportingScope": statement.get("reportingScope"),
            "rowCount": statement.get("total"),
        },
    )
    await session.commit()
    if payload.format == "xlsx":
        return Response(
            content=build_excel(statement, actor),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="nexa-bos-finance.xlsx"'},
        )
    if payload.format == "pdf":
        return Response(
            content=build_pdf(statement, actor),
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="nexa-bos-finance.pdf"'},
        )
    return HTMLResponse(content=build_print_html(statement, actor))
