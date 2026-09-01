from __future__ import annotations

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.api.v1.pagination import PaginationDep
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.models import User
from nexa_bos_api.identity.permissions import (
    DASHBOARD_VIEW,
    REPORTS_EXPORT_EXCEL,
    REPORTS_EXPORT_PDF,
    REPORTS_PRINT,
    REPORTS_VIEW,
)
from nexa_bos_api.reporting.export import build_excel, build_pdf, build_print_html
from nexa_bos_api.reporting.periods import DEFAULT_PERIOD
from nexa_bos_api.reporting.service import (
    ReportFilters,
    comparison_payload,
    dashboard_payload,
    drilldown_payload,
    employee_profile_payload,
    filter_options_payload,
    rankings_payload,
)

router = APIRouter(prefix="/reports", tags=["reports"])


class ExportRequest(BaseModel):
    format: Literal["xlsx", "pdf", "print"]
    report: Literal["dashboard", "drill_down", "rankings", "comparisons", "employee_profile"]
    period: str = DEFAULT_PERIOD
    date_from: date | None = None
    date_to: date | None = None
    compare_from: date | None = None
    compare_to: date | None = None
    office_id: UUID | None = None
    department_id: UUID | None = None
    team_id: UUID | None = None
    employee_id: UUID | None = None
    bank_id: UUID | None = None
    product_id: UUID | None = None
    stage_id: UUID | None = None
    terminal_outcome: str | None = None
    metric: str = "funded"
    ranking_metric: str = "funded_value"
    comparison_kind: str = "period"
    dimension: str | None = None
    left_id: UUID | None = None
    right_id: UUID | None = None
    comparison_period: str = "month"


def _filters(
    office_id: UUID | None = None,
    department_id: UUID | None = None,
    team_id: UUID | None = None,
    employee_id: UUID | None = None,
    bank_id: UUID | None = None,
    product_id: UUID | None = None,
    stage_id: UUID | None = None,
    terminal_outcome: str | None = None,
) -> ReportFilters:
    return ReportFilters(
        office_id=office_id,
        department_id=department_id,
        team_id=team_id,
        employee_id=employee_id,
        bank_id=bank_id,
        product_id=product_id,
        stage_id=stage_id,
        terminal_outcome=terminal_outcome,
    )


def _filter_dict(
    filters: ReportFilters, extra: dict[str, object] | None = None
) -> dict[str, object]:
    payload: dict[str, object] = {
        "officeId": str(filters.office_id) if filters.office_id else None,
        "departmentId": str(filters.department_id) if filters.department_id else None,
        "teamId": str(filters.team_id) if filters.team_id else None,
        "employeeId": str(filters.employee_id) if filters.employee_id else None,
        "bankId": str(filters.bank_id) if filters.bank_id else None,
        "productId": str(filters.product_id) if filters.product_id else None,
        "stageId": str(filters.stage_id) if filters.stage_id else None,
        "terminalOutcome": filters.terminal_outcome,
    }
    if extra:
        payload.update(extra)
    return {key: value for key, value in payload.items() if value is not None}


def require_reporting_read(user: User) -> User:
    if has_permission(user, DASHBOARD_VIEW) or has_permission(user, REPORTS_VIEW):
        return user
    raise AppError(status_code=403, code="FORBIDDEN", message="Permission denied")


async def reporting_reader(actor: CurrentUser) -> User:
    return require_reporting_read(actor)


ReportingReader = Annotated[User, Depends(reporting_reader)]


@router.get("/dashboard")
async def get_dashboard(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DASHBOARD_VIEW))],
    period: str = DEFAULT_PERIOD,
    date_from: date | None = None,
    date_to: date | None = None,
    office_id: UUID | None = None,
    department_id: UUID | None = None,
    team_id: UUID | None = None,
    employee_id: UUID | None = None,
    bank_id: UUID | None = None,
    product_id: UUID | None = None,
    stage_id: UUID | None = None,
    terminal_outcome: str | None = None,
    ranking_metric: str = "funded_value",
) -> dict[str, object]:
    return await dashboard_payload(
        session,
        actor,
        period=period,
        date_from=date_from,
        date_to=date_to,
        filters=_filters(
            office_id,
            department_id,
            team_id,
            employee_id,
            bank_id,
            product_id,
            stage_id,
            terminal_outcome,
        ),
        ranking_metric=ranking_metric,
    )


@router.get("/applications")
async def get_drilldown(
    session: SessionDep,
    actor: ReportingReader,
    pagination: PaginationDep,
    metric: str = Query(default="submitted"),
    period: str = DEFAULT_PERIOD,
    date_from: date | None = None,
    date_to: date | None = None,
    office_id: UUID | None = None,
    department_id: UUID | None = None,
    team_id: UUID | None = None,
    employee_id: UUID | None = None,
    bank_id: UUID | None = None,
    product_id: UUID | None = None,
    stage_id: UUID | None = None,
    terminal_outcome: str | None = None,
) -> dict[str, object]:
    return await drilldown_payload(
        session,
        actor,
        metric=metric,
        period=period,
        date_from=date_from,
        date_to=date_to,
        filters=_filters(
            office_id,
            department_id,
            team_id,
            employee_id,
            bank_id,
            product_id,
            stage_id,
            terminal_outcome,
        ),
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/rankings")
async def get_rankings(
    session: SessionDep,
    actor: ReportingReader,
    period: str = DEFAULT_PERIOD,
    date_from: date | None = None,
    date_to: date | None = None,
    office_id: UUID | None = None,
    department_id: UUID | None = None,
    team_id: UUID | None = None,
    employee_id: UUID | None = None,
    bank_id: UUID | None = None,
    product_id: UUID | None = None,
    ranking_metric: str = "funded_value",
) -> dict[str, object]:
    return await rankings_payload(
        session,
        actor,
        period=period,
        date_from=date_from,
        date_to=date_to,
        filters=_filters(office_id, department_id, team_id, employee_id, bank_id, product_id),
        ranking_metric=ranking_metric,
    )


@router.get("/comparisons")
async def get_comparisons(
    session: SessionDep,
    actor: ReportingReader,
    kind: str = "period",
    dimension: str | None = None,
    left_id: UUID | None = None,
    right_id: UUID | None = None,
    period: str = "month",
    date_from: date | None = None,
    date_to: date | None = None,
    compare_from: date | None = None,
    compare_to: date | None = None,
    metric: str = "funded_value",
    office_id: UUID | None = None,
    department_id: UUID | None = None,
    team_id: UUID | None = None,
    employee_id: UUID | None = None,
    bank_id: UUID | None = None,
    product_id: UUID | None = None,
) -> dict[str, object]:
    return await comparison_payload(
        session,
        actor,
        kind=kind,
        dimension=dimension,
        left_id=left_id,
        right_id=right_id,
        period=period,
        date_from=date_from,
        date_to=date_to,
        compare_from=compare_from,
        compare_to=compare_to,
        metric=metric,
        filters=_filters(office_id, department_id, team_id, employee_id, bank_id, product_id),
    )


@router.get("/employees/{employee_id}")
async def get_employee_profile(
    employee_id: UUID,
    session: SessionDep,
    actor: ReportingReader,
    period: str = DEFAULT_PERIOD,
    date_from: date | None = None,
    date_to: date | None = None,
    ranking_metric: str = "funded_value",
) -> dict[str, object]:
    return await employee_profile_payload(
        session,
        actor,
        employee_id,
        period=period,
        date_from=date_from,
        date_to=date_to,
        ranking_metric=ranking_metric,
    )


@router.get("/filters")
async def get_filters(
    session: SessionDep,
    actor: ReportingReader,
) -> dict[str, object]:
    return await filter_options_payload(session, actor)


@router.post("/export")
async def export_report(
    payload: ExportRequest,
    session: SessionDep,
    actor: CurrentUser,
) -> Response:
    permission = {
        "xlsx": REPORTS_EXPORT_EXCEL,
        "pdf": REPORTS_EXPORT_PDF,
        "print": REPORTS_PRINT,
    }[payload.format]
    if not has_permission(actor, permission):
        raise AppError(status_code=403, code="FORBIDDEN", message="Permission denied")
    require_reporting_read(actor)
    filters = _filters(
        payload.office_id,
        payload.department_id,
        payload.team_id,
        payload.employee_id,
        payload.bank_id,
        payload.product_id,
        payload.stage_id,
        payload.terminal_outcome,
    )
    title = {
        "dashboard": "Performance / MIS Dashboard",
        "drill_down": "Report Drill-down",
        "rankings": "Performance Rankings",
        "comparisons": "Performance Comparison",
        "employee_profile": "Employee Performance Profile",
    }[payload.report]
    if payload.report == "dashboard":
        data = await dashboard_payload(
            session,
            actor,
            period=payload.period,
            date_from=payload.date_from,
            date_to=payload.date_to,
            filters=filters,
            ranking_metric=payload.ranking_metric,
        )
    elif payload.report == "drill_down":
        data = await drilldown_payload(
            session,
            actor,
            metric=payload.metric,
            period=payload.period,
            date_from=payload.date_from,
            date_to=payload.date_to,
            filters=filters,
        )
        title = f"Drill-down - {payload.metric}"
    elif payload.report == "rankings":
        data = await rankings_payload(
            session,
            actor,
            period=payload.period,
            date_from=payload.date_from,
            date_to=payload.date_to,
            filters=filters,
            ranking_metric=payload.ranking_metric,
        )
    elif payload.report == "comparisons":
        data = await comparison_payload(
            session,
            actor,
            kind=payload.comparison_kind,
            dimension=payload.dimension,
            left_id=payload.left_id,
            right_id=payload.right_id,
            period=payload.comparison_period,
            date_from=payload.date_from,
            date_to=payload.date_to,
            compare_from=payload.compare_from,
            compare_to=payload.compare_to,
            metric=payload.metric,
            filters=filters,
        )
    else:
        if payload.employee_id is None:
            raise AppError(
                status_code=422,
                code="EMPLOYEE_REQUIRED",
                message="Employee profile export requires employee_id",
            )
        data = await employee_profile_payload(
            session,
            actor,
            payload.employee_id,
            period=payload.period,
            date_from=payload.date_from,
            date_to=payload.date_to,
            ranking_metric=payload.ranking_metric,
        )
    filter_meta = _filter_dict(filters, {"period": payload.period, "report": payload.report})
    await record_audit(
        session,
        action="reports.export",
        entity_type="report",
        entity_id=payload.report,
        actor_id=actor.id,
        new_values={
            "exportType": payload.format,
            "report": payload.report,
            "period": payload.period,
            "filters": filter_meta,
            "reportingScope": data.get("reportingScope"),
        },
    )
    await session.commit()
    if payload.format == "xlsx":
        content = build_excel(title=title, actor=actor, payload=data, filters=filter_meta)
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="nexa-bos-report.xlsx"'},
        )
    if payload.format == "pdf":
        content = build_pdf(title=title, actor=actor, payload=data, filters=filter_meta)
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="nexa-bos-report.pdf"'},
        )
    html = build_print_html(title=title, actor=actor, payload=data, filters=filter_meta)
    return HTMLResponse(content=html)
