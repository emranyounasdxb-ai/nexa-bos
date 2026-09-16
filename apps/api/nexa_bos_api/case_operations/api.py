from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response

from nexa_bos_api.api.v1.deps import CurrentUser, require_any_permission, require_permission
from nexa_bos_api.applications.models import Application
from nexa_bos_api.applications.service import get_visible_application, serialize_application
from nexa_bos_api.case_operations.csv_service import (
    blank_template,
    current_cases_csv,
    import_stage_csv,
    validate_stage_csv,
)
from nexa_bos_api.case_operations.reporting import (
    case_report,
    case_report_xlsx,
    employee_metrics,
    team_metrics,
)
from nexa_bos_api.case_operations.schemas import (
    BankSubmissionRequest,
    BookCaseRequest,
    CardPointRuleCreateRequest,
    ClawbackCreateRequest,
    ClawbackDecisionRequest,
    RoutingAssignmentRequest,
    SalesManagerDecisionRequest,
)
from nexa_bos_api.case_operations.service import (
    book_case,
    case_operations_options,
    create_card_rule,
    create_clawback,
    decide_clawback,
    list_card_rules,
    list_clawbacks,
    list_earnings_for_clawback,
    list_routing,
    sales_manager_decision,
    set_card_rule_status,
    set_routing_status,
    submit_bank_file,
    upsert_routing,
)
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_user_type
from nexa_bos_api.identity.permissions import (
    APPLICATIONS_SUBMIT,
    CASE_CLAWBACK_APPROVE,
    CASE_CLAWBACK_SUBMIT,
    CASE_REPORTS_EXPORT,
    CASE_REPORTS_VIEW,
    CASE_ROUTING_MANAGE,
    CASE_ROUTING_VIEW,
    CASE_RULES_MANAGE,
    CASE_RULES_VIEW,
    CASE_STAGE_CSV,
)

router = APIRouter(prefix="/case-operations", tags=["case-operations"])
CsvFile = Annotated[UploadFile, File()]


@router.get("/options")
async def options(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(CASE_RULES_VIEW))],
) -> dict[str, object]:
    return await case_operations_options(session)


@router.get("/card-point-rules")
async def card_point_rules(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(CASE_RULES_VIEW))],
) -> dict[str, object]:
    return await list_card_rules(session)


@router.post("/card-point-rules")
async def card_point_rule_create(
    payload: CardPointRuleCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_RULES_MANAGE))],
) -> dict[str, object]:
    return await create_card_rule(session, actor, payload)


@router.post("/card-point-rules/{rule_id}/{action}")
async def card_point_rule_status(
    rule_id: UUID,
    action: str,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_RULES_MANAGE))],
) -> dict[str, object]:
    if action not in {"activate", "deactivate"}:
        from nexa_bos_api.core.exceptions import AppError

        raise AppError(status_code=404, code="ACTION_NOT_FOUND", message="Action not found")
    return await set_card_rule_status(session, actor, rule_id, active=action == "activate")


@router.get("/routing")
async def routing_assignments(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(CASE_ROUTING_VIEW))],
) -> dict[str, object]:
    if has_user_type(_actor, "TL"):
        raise AppError(
            status_code=403,
            code="FORBIDDEN",
            message="Global routing is not available to Team Leaders",
        )
    return await list_routing(session)


@router.put("/routing")
async def routing_upsert(
    payload: RoutingAssignmentRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_ROUTING_MANAGE))],
) -> dict[str, object]:
    return await upsert_routing(session, actor, payload)


@router.post("/routing/{assignment_id}/{action}")
async def routing_status(
    assignment_id: UUID,
    action: str,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_ROUTING_MANAGE))],
) -> dict[str, object]:
    if action not in {"activate", "deactivate"}:
        from nexa_bos_api.core.exceptions import AppError

        raise AppError(status_code=404, code="ACTION_NOT_FOUND", message="Action not found")
    return await set_routing_status(session, actor, assignment_id, active=action == "activate")


@router.post("/applications/{application_id}/book")
async def application_book(
    application_id: UUID,
    payload: BookCaseRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_ROUTING_VIEW))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    return await serialize_application(
        session, await book_case(session, actor, application, payload)
    )


@router.post("/applications/{application_id}/sales-manager-decision")
async def application_sm_decision(
    application_id: UUID,
    payload: SalesManagerDecisionRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_ROUTING_VIEW))],
) -> dict[str, object]:
    application = await session.get(Application, application_id)
    if application is None:
        raise AppError(
            status_code=404, code="APPLICATION_NOT_FOUND", message="Application not found"
        )
    return await serialize_application(
        session, await sales_manager_decision(session, actor, application, payload)
    )


@router.post("/applications/{application_id}/bank-submission")
async def application_bank_submission(
    application_id: UUID,
    payload: BankSubmissionRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_SUBMIT))],
) -> dict[str, object]:
    application = await session.get(Application, application_id)
    if application is None:
        raise AppError(
            status_code=404, code="APPLICATION_NOT_FOUND", message="Application not found"
        )
    return await serialize_application(
        session, await submit_bank_file(session, actor, application, payload)
    )


@router.get("/clawbacks")
async def clawbacks(
    session: SessionDep,
    actor: Annotated[
        CurrentUser,
        Depends(require_any_permission(CASE_CLAWBACK_SUBMIT, CASE_CLAWBACK_APPROVE)),
    ],
) -> dict[str, object]:
    return await list_clawbacks(session, actor)


@router.get("/earnings")
async def earnings_for_clawback(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_CLAWBACK_SUBMIT))],
) -> dict[str, object]:
    return await list_earnings_for_clawback(session, actor)


@router.post("/clawbacks")
async def clawback_create(
    payload: ClawbackCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_CLAWBACK_SUBMIT))],
) -> dict[str, object]:
    return await create_clawback(session, actor, payload)


@router.post("/clawbacks/{request_id}/decision")
async def clawback_decision(
    request_id: UUID,
    payload: ClawbackDecisionRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_CLAWBACK_APPROVE))],
) -> dict[str, object]:
    return await decide_clawback(session, actor, request_id, payload)


@router.get("/stage-csv/template")
async def stage_csv_template(
    _actor: Annotated[CurrentUser, Depends(require_permission(CASE_STAGE_CSV))],
) -> Response:
    return Response(
        blank_template(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="case-stage-template.csv"'},
    )


@router.get("/stage-csv/current-cases")
async def stage_csv_current_cases(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_STAGE_CSV))],
) -> Response:
    return Response(
        await current_cases_csv(session, actor),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="current-cases.csv"'},
    )


@router.post("/stage-csv/validate")
async def stage_csv_validate(
    file: CsvFile,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_STAGE_CSV))],
) -> dict[str, object]:
    return await validate_stage_csv(session, actor, await file.read())


@router.post("/stage-csv/import")
async def stage_csv_import(
    file: CsvFile,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_STAGE_CSV))],
) -> dict[str, object]:
    return await import_stage_csv(session, actor, await file.read())


@router.get("/reports/cases")
async def reports_cases(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_REPORTS_VIEW))],
    booking_from: date | None = None,
    booking_to: date | None = None,
) -> dict[str, object]:
    if has_user_type(actor, "TL"):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Use your own and direct-team dashboard"
        )
    return await case_report(session, actor, booking_from=booking_from, booking_to=booking_to)


@router.get("/reports/cases.xlsx")
async def reports_cases_xlsx(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_REPORTS_EXPORT))],
    booking_from: date | None = None,
    booking_to: date | None = None,
) -> Response:
    report = await case_report(session, actor, booking_from=booking_from, booking_to=booking_to)
    return Response(
        case_report_xlsx(report),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="case-operations.xlsx"'},
    )


@router.get("/metrics/employees/{employee_id}")
async def metrics_employee(
    employee_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_REPORTS_VIEW))],
) -> dict[str, object]:
    return await employee_metrics(session, actor, employee_id)


@router.get("/metrics/teams/{team_id}")
async def metrics_team(
    team_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CASE_REPORTS_VIEW))],
) -> dict[str, object]:
    return await team_metrics(session, actor, team_id)
