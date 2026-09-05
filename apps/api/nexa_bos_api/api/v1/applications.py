from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.api.v1.pagination import PaginationDep
from nexa_bos_api.applications.models import Application
from nexa_bos_api.applications.review import (
    ReviewActionRequest,
    require_review_mutation,
    review_payload,
    transition_review,
)
from nexa_bos_api.applications.schemas import (
    ApplicationCreateRequest,
    ApplicationUpdateRequest,
    CaseNumberRequest,
    CorrectDelayRequest,
    CorrectSubmittedRequest,
    MarkDelayRequest,
    MigrateWorkflowRequest,
    OutcomeRequest,
    ReassignOwnerRequest,
    StageCorrectionRequest,
    StageUpdateRequest,
)
from nexa_bos_api.applications.service import (
    application_progress,
    application_timeline,
    correct_stage,
    correct_submitted,
    create_application,
    get_visible_application,
    list_applications,
    list_customer_applications,
    list_referenced_case_owners,
    list_referenced_product_variants,
    list_referenced_stages,
    match_application_customer,
    migrate_application,
    reassign_case_owner,
    save_case_number,
    serialize_application,
    serialize_applications,
    set_outcome,
    update_application,
    update_stage,
)
from nexa_bos_api.applications.tat import correct_delay, mark_delay
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.customers.schemas import CustomerIdentityMatchRequest
from nexa_bos_api.customers.service import get_visible_customer
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission, has_user_type
from nexa_bos_api.identity.permissions import (
    APPLICATIONS_CORRECT_DELAY,
    APPLICATIONS_CORRECT_STAGE,
    APPLICATIONS_CORRECT_SUBMITTED,
    APPLICATIONS_CREATE,
    APPLICATIONS_EDIT,
    APPLICATIONS_MARK_DELAY,
    APPLICATIONS_REASSIGN_CASE_OWNER,
    APPLICATIONS_SET_OUTCOME,
    APPLICATIONS_SUBMIT,
    APPLICATIONS_UPDATE_STAGE,
    APPLICATIONS_VIEW,
    CUSTOMERS_VIEW,
    WORKFLOWS_MIGRATE_APPLICATION,
)

router = APIRouter(tags=["applications"])


async def _require_application_mutation_scope(
    actor: CurrentUser,
    application: Application,
    session: SessionDep,
    *,
    editing: bool = False,
) -> None:
    role_code = actor.user_type.code if actor.user_type else None
    if role_code in {"BDM", "SM", "TL", "SE", "OM"} and application.case_owner_id != actor.id:
        raise AppError(
            status_code=404,
            code="APPLICATION_NOT_FOUND",
            message="Application not found",
        )
    await require_review_mutation(session, actor, application, editing=editing)


def _filters(
    q: str | None,
    application_id: str | None,
    bank_case_number: str | None,
    customer_code: str | None,
    customer_name: str | None,
    customer_mobile: str | None,
    bank_id: str | None,
    product_id: str | None,
    product_variant_id: str | None,
    case_owner_id: str | None,
    office_id: str | None,
    department_id: str | None,
    team_id: str | None,
    current_stage_id: str | None,
    terminal_outcome: str | None,
    submission_from: str | None,
    submission_to: str | None,
    created_from: str | None,
    created_to: str | None,
    bank_stage_date: str | None,
    bank_stage_from: str | None,
    bank_stage_to: str | None,
    requested_min: str | None,
    requested_max: str | None,
    approved_min: str | None,
    approved_max: str | None,
    booked_min: str | None,
    booked_max: str | None,
    funded_min: str | None,
    funded_max: str | None,
    dashboard_metric: str | None,
    dashboard_period: str | None,
) -> dict[str, str | None]:
    return {
        "q": q,
        "application_id": application_id,
        "bank_case_number": bank_case_number,
        "customer_code": customer_code,
        "customer_name": customer_name,
        "customer_mobile": customer_mobile,
        "bank_id": bank_id,
        "product_id": product_id,
        "product_variant_id": product_variant_id,
        "case_owner_id": case_owner_id,
        "office_id": office_id,
        "department_id": department_id,
        "team_id": team_id,
        "current_stage_id": current_stage_id,
        "terminal_outcome": terminal_outcome,
        "submission_from": submission_from,
        "submission_to": submission_to,
        "created_from": created_from,
        "created_to": created_to,
        "bank_stage_date": bank_stage_date,
        "bank_stage_from": bank_stage_from,
        "bank_stage_to": bank_stage_to,
        "requested_min": requested_min,
        "requested_max": requested_max,
        "approved_min": approved_min,
        "approved_max": approved_max,
        "booked_min": booked_min,
        "booked_max": booked_max,
        "funded_min": funded_min,
        "funded_max": funded_max,
        "dashboard_metric": dashboard_metric,
        "dashboard_period": dashboard_period,
    }


@router.get("/applications")
async def applications_list(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_VIEW))],
    pagination: PaginationDep,
    q: str | None = None,
    application_id: str | None = None,
    bank_case_number: str | None = None,
    customer_code: str | None = None,
    customer_name: str | None = None,
    customer_mobile: str | None = None,
    bank_id: str | None = None,
    product_id: str | None = None,
    product_variant_id: str | None = None,
    case_owner_id: str | None = None,
    office_id: str | None = None,
    department_id: str | None = None,
    team_id: str | None = None,
    current_stage_id: str | None = None,
    terminal_outcome: str | None = None,
    submission_from: str | None = None,
    submission_to: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
    bank_stage_date: str | None = None,
    bank_stage_from: str | None = None,
    bank_stage_to: str | None = None,
    requested_min: str | None = None,
    requested_max: str | None = None,
    approved_min: str | None = None,
    approved_max: str | None = None,
    booked_min: str | None = None,
    booked_max: str | None = None,
    funded_min: str | None = None,
    funded_max: str | None = None,
    dashboard_metric: str | None = None,
    dashboard_period: str | None = None,
) -> dict[str, object]:
    rows = await list_applications(
        session,
        actor,
        _filters(
            q,
            application_id,
            bank_case_number,
            customer_code,
            customer_name,
            customer_mobile,
            bank_id,
            product_id,
            product_variant_id,
            case_owner_id,
            office_id,
            department_id,
            team_id,
            current_stage_id,
            terminal_outcome,
            submission_from,
            submission_to,
            created_from,
            created_to,
            bank_stage_date,
            bank_stage_from,
            bank_stage_to,
            requested_min,
            requested_max,
            approved_min,
            approved_max,
            booked_min,
            booked_max,
            funded_min,
            funded_max,
            dashboard_metric,
            dashboard_period,
        ),
        page=pagination.page,
        page_size=pagination.page_size,
    )
    return {
        "items": await serialize_applications(session, rows.items),
        "pagination": rows.metadata(),
    }


@router.post("/applications")
async def applications_create(
    payload: ApplicationCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_CREATE))],
) -> dict[str, object]:
    return await serialize_application(session, await create_application(session, actor, payload))


@router.post("/applications/customer-match")
async def applications_customer_match(
    payload: CustomerIdentityMatchRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_CREATE))],
) -> dict[str, object]:
    return await match_application_customer(
        session,
        actor,
        emirates_id=payload.emirates_id,
        passport=payload.passport,
    )


@router.get("/applications/case-owners")
async def applications_case_owners(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_VIEW))],
) -> dict[str, object]:
    users = await list_referenced_case_owners(session, actor)
    return {
        "items": [
            {
                "id": str(user.id),
                "userCode": user.user_code,
                "fullName": user.full_name,
                "officeId": str(user.office_id) if user.office_id else None,
                "departmentId": str(user.department_id) if user.department_id else None,
                "teamId": str(user.team_id) if user.team_id else None,
            }
            for user in users
        ]
    }


@router.get("/applications/product-variants")
async def applications_product_variants(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_VIEW))],
) -> dict[str, object]:
    variants = await list_referenced_product_variants(session, actor)
    return {
        "items": [
            {
                "id": str(variant.id),
                "bankId": str(variant.bank_product.bank_id),
                "productId": str(variant.bank_product.product_id),
                "code": variant.code,
                "name": variant.name,
                "status": variant.status,
            }
            for variant in variants
        ]
    }


@router.get("/applications/stages")
async def applications_stages(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_VIEW))],
) -> dict[str, object]:
    stages = await list_referenced_stages(session, actor)
    return {
        "items": [{"id": str(stage.id), "code": stage.code, "name": stage.name} for stage in stages]
    }


@router.get("/applications/{application_id}")
async def applications_get(
    application_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_VIEW))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    return await serialize_application(session, application)


@router.get("/applications/{application_id}/timeline")
async def applications_timeline(
    application_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_VIEW))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    return {"items": await application_timeline(session, application)}


@router.get("/applications/{application_id}/internal-review")
async def application_review(
    application_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_VIEW))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    return await review_payload(session, application, actor)


@router.post("/applications/{application_id}/internal-review")
async def application_review_action(
    application_id: UUID,
    payload: ReviewActionRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_VIEW))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    return await transition_review(session, application, actor, payload)


@router.get("/applications/{application_id}/progress")
async def applications_progress(
    application_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_VIEW))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    return await application_progress(session, application)


@router.patch("/applications/{application_id}")
async def applications_update(
    application_id: UUID,
    payload: ApplicationUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_EDIT))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    await _require_application_mutation_scope(actor, application, session, editing=True)
    return await serialize_application(
        session, await update_application(session, actor, application, payload)
    )


@router.post("/applications/{application_id}/case-number")
async def applications_case_number(
    application_id: UUID,
    payload: CaseNumberRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_SUBMIT))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    await _require_application_mutation_scope(actor, application, session)
    return await serialize_application(
        session,
        await save_case_number(
            session, actor, application, payload.bank_case_number, payload.reason
        ),
    )


@router.post("/applications/{application_id}/correct-submitted")
async def applications_correct_submitted(
    application_id: UUID,
    payload: CorrectSubmittedRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_CORRECT_SUBMITTED))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    await _require_application_mutation_scope(actor, application, session)
    return await serialize_application(
        session, await correct_submitted(session, actor, application, payload)
    )


@router.post("/applications/{application_id}/reassign-owner")
async def applications_reassign(
    application_id: UUID,
    payload: ReassignOwnerRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_REASSIGN_CASE_OWNER))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    await _require_application_mutation_scope(actor, application, session)
    return await serialize_application(
        session,
        await reassign_case_owner(
            session, actor, application, payload.case_owner_id, payload.reason
        ),
    )


@router.post("/applications/{application_id}/stage")
async def applications_stage(
    application_id: UUID,
    payload: StageUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_UPDATE_STAGE))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    await _require_application_mutation_scope(actor, application, session)
    return await serialize_application(
        session, await update_stage(session, actor, application, payload)
    )


@router.post("/applications/{application_id}/correct-stage")
async def applications_correct_stage(
    application_id: UUID,
    payload: StageCorrectionRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_CORRECT_STAGE))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    await _require_application_mutation_scope(actor, application, session)
    return await serialize_application(
        session, await correct_stage(session, actor, application, payload)
    )


@router.post("/applications/{application_id}/outcome")
async def applications_outcome(
    application_id: UUID,
    payload: OutcomeRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_SET_OUTCOME))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    await _require_application_mutation_scope(actor, application, session)
    return await serialize_application(
        session, await set_outcome(session, actor, application, payload.outcome, payload.reason)
    )


@router.post("/applications/{application_id}/migrate")
async def applications_migrate(
    application_id: UUID,
    payload: MigrateWorkflowRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(WORKFLOWS_MIGRATE_APPLICATION))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    await _require_application_mutation_scope(actor, application, session)
    return await serialize_application(
        session,
        await migrate_application(
            session,
            actor,
            application,
            payload.workflow_id,
            payload.target_stage_id,
            payload.reason,
        ),
    )


@router.post("/applications/{application_id}/delays")
async def applications_mark_delay(
    application_id: UUID,
    payload: MarkDelayRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_MARK_DELAY))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    await _require_application_mutation_scope(actor, application, session)
    await mark_delay(session, actor, application, payload)
    refreshed = (await session.get(Application, application.id)) or application
    return await serialize_application(session, refreshed)


@router.post("/applications/{application_id}/delays/{delay_id}/correct")
async def applications_correct_delay(
    application_id: UUID,
    delay_id: UUID,
    payload: CorrectDelayRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(APPLICATIONS_CORRECT_DELAY))],
) -> dict[str, object]:
    application = await get_visible_application(session, actor, application_id)
    await _require_application_mutation_scope(actor, application, session)
    await correct_delay(session, actor, application, delay_id, payload)
    refreshed = (await session.get(Application, application.id)) or application
    return await serialize_application(session, refreshed)


@router.get("/customers/{customer_id}/applications")
async def customer_applications(
    customer_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(CUSTOMERS_VIEW))],
) -> dict[str, object]:
    if not has_user_type(actor, "OWNER", "GM"):
        raise AppError(
            status_code=403,
            code="FORBIDDEN",
            message="Customer directory access is restricted to Owners and General Managers",
        )
    await get_visible_customer(session, actor, customer_id)
    if not has_permission(actor, APPLICATIONS_VIEW):
        return {"items": []}
    rows = await list_customer_applications(session, actor, customer_id)
    return {"items": [await serialize_application(session, row) for row in rows]}
