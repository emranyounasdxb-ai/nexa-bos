from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.assets.enums import AssetReport, AssetStatus
from nexa_bos_api.assets.export import build_excel, build_pdf, build_print_html
from nexa_bos_api.assets.schemas import (
    AssetAllocationRequest,
    AssetCategoryCreateRequest,
    AssetCategoryUpdateRequest,
    AssetConditionCorrectionRequest,
    AssetCreateRequest,
    AssetMasterUpdateRequest,
    AssetReportExportRequest,
    AssetReturnRequest,
    AssetStatusRequest,
    EmployeeTransferRequest,
    IdentifierCorrectionRequest,
    OfficeTransferRequest,
)
from nexa_bos_api.assets.service import (
    allocate_asset,
    asset_audit,
    asset_history,
    asset_options,
    asset_report,
    correct_condition,
    correct_identifiers,
    create_asset,
    create_category,
    employee_assets,
    get_asset,
    list_assets,
    list_categories,
    return_asset,
    set_asset_status,
    set_category_status,
    transfer_employee,
    transfer_office,
    update_asset_master,
    update_category,
)
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.permissions import (
    ASSETS_ALLOCATE,
    ASSETS_MANAGE_MASTER,
    ASSETS_MANAGE_STATUS,
    ASSETS_MANAGE_STOCK,
    ASSETS_RETURN,
    ASSETS_TRANSFER,
    ASSETS_VIEW,
    ASSETS_VIEW_AUDIT,
)

router = APIRouter(prefix="/assets", tags=["assets"])


def _require_history_permission(actor: CurrentUser, report: AssetReport) -> None:
    if report is AssetReport.ASSET_HISTORY and not has_permission(actor, ASSETS_VIEW_AUDIT):
        raise AppError(
            status_code=403,
            code="FORBIDDEN",
            message="You do not have permission to perform this action",
            details=[{"permission": ASSETS_VIEW_AUDIT}],
        )


@router.get("/options")
async def options(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_VIEW))],
) -> dict[str, object]:
    return await asset_options(session, actor)


@router.get("/categories")
async def categories_list(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_VIEW))],
    active_only: Annotated[bool, Query(alias="activeOnly")] = False,
) -> dict[str, object]:
    return await list_categories(session, active_only=active_only)


@router.post("/categories")
async def categories_create(
    payload: AssetCategoryCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_MANAGE_MASTER))],
) -> dict[str, object]:
    return await create_category(session, actor, payload)


@router.patch("/categories/{category_id}")
async def categories_update(
    category_id: UUID,
    payload: AssetCategoryUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_MANAGE_MASTER))],
) -> dict[str, object]:
    return await update_category(session, actor, category_id, payload)


@router.post("/categories/{category_id}/activate")
async def categories_activate(
    category_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_MANAGE_MASTER))],
) -> dict[str, object]:
    return await set_category_status(session, actor, category_id, active=True)


@router.post("/categories/{category_id}/deactivate")
async def categories_deactivate(
    category_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_MANAGE_MASTER))],
) -> dict[str, object]:
    return await set_category_status(session, actor, category_id, active=False)


@router.delete("/categories/{category_id}")
async def categories_delete_forbidden(category_id: UUID, _actor: CurrentUser) -> None:
    raise AppError(
        status_code=405,
        code="ASSET_CATEGORY_DELETE_FORBIDDEN",
        message="Asset category deletion is forbidden",
    )


@router.get("/reports/{report}")
async def report_view(
    report: AssetReport,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_VIEW))],
    office_id: Annotated[UUID | None, Query(alias="officeId")] = None,
    employee_id: Annotated[UUID | None, Query(alias="employeeId")] = None,
    category_id: Annotated[UUID | None, Query(alias="categoryId")] = None,
) -> dict[str, object]:
    _require_history_permission(actor, report)
    return await asset_report(
        session,
        actor,
        report,
        office_id=office_id,
        employee_id=employee_id,
        category_id=category_id,
    )


@router.post("/reports/export")
async def report_export(
    payload: AssetReportExportRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_VIEW))],
) -> Response:
    _require_history_permission(actor, payload.report)
    report = await asset_report(
        session,
        actor,
        payload.report,
        office_id=payload.office_id,
        employee_id=payload.employee_id,
        category_id=payload.category_id,
    )
    filename = f"nexa-bos-{payload.report.value}"
    if payload.format == "xlsx":
        content = build_excel(report, actor)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disposition = f'attachment; filename="{filename}.xlsx"'
    elif payload.format == "pdf":
        content = build_pdf(report, actor)
        media_type = "application/pdf"
        disposition = f'attachment; filename="{filename}.pdf"'
    else:
        content = build_print_html(report, actor)
        media_type = "text/html"
        disposition = None
    await record_audit(
        session,
        action="asset.report.export",
        entity_type="asset_report",
        entity_id=payload.report.value,
        actor_id=actor.id,
        new_values={
            "format": payload.format,
            "report": payload.report.value,
            "scope": report["reportingScope"],
            "rowCount": report["total"],
            "filters": report["filters"],
        },
    )
    await session.commit()
    headers = {"Content-Disposition": disposition} if disposition else None
    return Response(content=content, media_type=media_type, headers=headers)


@router.get("/audit")
async def audit_list(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_VIEW_AUDIT))],
    asset_id: Annotated[UUID | None, Query(alias="assetId")] = None,
) -> dict[str, object]:
    return await asset_audit(session, actor, asset_id=asset_id)


@router.get("/employees/{employee_id}")
async def employee_asset_profile(
    employee_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_VIEW))],
) -> dict[str, object]:
    return await employee_assets(session, actor, employee_id)


@router.get("")
async def assets_list(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_VIEW))],
    q: str | None = None,
    status: AssetStatus | None = None,
    category_id: Annotated[UUID | None, Query(alias="categoryId")] = None,
    office_id: Annotated[UUID | None, Query(alias="officeId")] = None,
    employee_id: Annotated[UUID | None, Query(alias="employeeId")] = None,
    outstanding: bool | None = None,
) -> dict[str, object]:
    return await list_assets(
        session,
        actor,
        q=q,
        status=status,
        category_id=category_id,
        office_id=office_id,
        employee_id=employee_id,
        outstanding=outstanding,
    )


@router.post("")
async def assets_create(
    payload: AssetCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_MANAGE_STOCK))],
) -> dict[str, object]:
    return await create_asset(session, actor, payload)


@router.get("/{asset_id}")
async def assets_get(
    asset_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_VIEW))],
) -> dict[str, object]:
    return await get_asset(session, actor, asset_id)


@router.patch("/{asset_id}")
async def assets_update(
    asset_id: UUID,
    payload: AssetMasterUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_MANAGE_MASTER))],
) -> dict[str, object]:
    return await update_asset_master(session, actor, asset_id, payload)


@router.post("/{asset_id}/identifiers")
async def assets_identifiers(
    asset_id: UUID,
    payload: IdentifierCorrectionRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_MANAGE_MASTER))],
) -> dict[str, object]:
    return await correct_identifiers(session, actor, asset_id, payload)


@router.post("/{asset_id}/condition")
async def assets_condition(
    asset_id: UUID,
    payload: AssetConditionCorrectionRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_MANAGE_STOCK))],
) -> dict[str, object]:
    return await correct_condition(session, actor, asset_id, payload)


@router.post("/{asset_id}/allocate")
async def assets_allocate(
    asset_id: UUID,
    payload: AssetAllocationRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_ALLOCATE))],
) -> dict[str, object]:
    return await allocate_asset(session, actor, asset_id, payload)


@router.post("/{asset_id}/return")
async def assets_return(
    asset_id: UUID,
    payload: AssetReturnRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_RETURN))],
) -> dict[str, object]:
    return await return_asset(session, actor, asset_id, payload)


@router.post("/{asset_id}/transfer/employee")
async def assets_transfer_employee(
    asset_id: UUID,
    payload: EmployeeTransferRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_TRANSFER))],
) -> dict[str, object]:
    return await transfer_employee(session, actor, asset_id, payload)


@router.post("/{asset_id}/transfer/office")
async def assets_transfer_office(
    asset_id: UUID,
    payload: OfficeTransferRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_TRANSFER))],
) -> dict[str, object]:
    return await transfer_office(session, actor, asset_id, payload)


@router.post("/{asset_id}/status")
async def assets_status(
    asset_id: UUID,
    payload: AssetStatusRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_MANAGE_STATUS))],
) -> dict[str, object]:
    return await set_asset_status(session, actor, asset_id, payload)


@router.get("/{asset_id}/history")
async def assets_history(
    asset_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(ASSETS_VIEW_AUDIT))],
) -> dict[str, object]:
    return await asset_history(session, actor, asset_id)


@router.delete("/{asset_id}")
async def assets_delete_forbidden(asset_id: UUID, _actor: CurrentUser) -> None:
    raise AppError(
        status_code=405,
        code="ASSET_DELETE_FORBIDDEN",
        message="Asset deletion is forbidden",
    )
