from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.assets.enums import (
    REPORT_TITLES,
    AllocationEndType,
    AssetCondition,
    AssetReport,
    AssetStatus,
)
from nexa_bos_api.assets.models import (
    Asset,
    AssetAllocation,
    AssetCategory,
    AssetCodeCounter,
    AssetOfficeCustody,
)
from nexa_bos_api.assets.schemas import (
    AssetAllocationRequest,
    AssetCategoryCreateRequest,
    AssetCategoryUpdateRequest,
    AssetConditionCorrectionRequest,
    AssetCreateRequest,
    AssetMasterUpdateRequest,
    AssetReturnRequest,
    AssetStatusRequest,
    CategoryFieldInput,
    EmployeeTransferRequest,
    IdentifierCorrectionRequest,
    OfficeTransferRequest,
)
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import (
    has_permission,
    user_load_options,
    visibility_scope,
    visible_user_ids,
)
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import EmploymentStatus, MasterStatus, VisibilityScope
from nexa_bos_api.identity.models import AuditEvent, Office, User, new_uuid
from nexa_bos_api.identity.permissions import ASSETS_MANAGE_STATUS

BUILTIN_FIELDS = {
    "brand",
    "model",
    "serial_number",
    "imei",
    "iccid",
    "mobile_number",
    "operator",
}
ELIGIBLE_EMPLOYMENT = {
    EmploymentStatus.ACTIVE.value,
    EmploymentStatus.PROBATION.value,
    EmploymentStatus.NOTICE_PERIOD.value,
}
OUTSTANDING_EMPLOYMENT = {
    EmploymentStatus.NOTICE_PERIOD.value,
    EmploymentStatus.RESIGNED.value,
    EmploymentStatus.TERMINATED.value,
    EmploymentStatus.INACTIVE.value,
}


def utcnow() -> datetime:
    return datetime.now(UTC)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.strip().split())
    return cleaned or None


def _identifier(value: str | None, *, compact: bool = False) -> str | None:
    cleaned = _clean(value)
    if cleaned is None:
        return None
    if compact:
        cleaned = cleaned.replace(" ", "").replace("-", "")
    return cleaned.upper()


def _asset_options():
    return (
        selectinload(Asset.category),
        selectinload(Asset.office),
        selectinload(Asset.allocations).selectinload(AssetAllocation.employee),
        selectinload(Asset.allocations).selectinload(AssetAllocation.issued_by),
        selectinload(Asset.allocations).selectinload(AssetAllocation.received_by),
        selectinload(Asset.office_history).selectinload(AssetOfficeCustody.office),
        selectinload(Asset.office_history).selectinload(AssetOfficeCustody.transferred_by),
    )


def _active_allocation(asset: Asset) -> AssetAllocation | None:
    return next((row for row in asset.allocations if row.return_date is None), None)


def _active_custody(asset: Asset) -> AssetOfficeCustody | None:
    return next((row for row in asset.office_history if row.ended_on is None), None)


def _not_found() -> AppError:
    return AppError(status_code=404, code="ASSET_NOT_FOUND", message="Asset was not found")


async def _asset_in_scope(session: AsyncSession, actor: User, asset: Asset) -> bool:
    scope = visibility_scope(actor)
    if scope is VisibilityScope.COMPANY:
        return True
    if scope is VisibilityScope.OFFICE:
        return actor.office_id is not None and asset.office_id == actor.office_id
    allocation = _active_allocation(asset)
    if allocation is None:
        return False
    allowed = await visible_user_ids(session, actor)
    return allowed is not None and allocation.employee_id in allowed


def _office_in_scope(actor: User, office_id: UUID) -> bool:
    scope = visibility_scope(actor)
    return scope is VisibilityScope.COMPANY or (
        scope is VisibilityScope.OFFICE and actor.office_id == office_id
    )


async def _get_asset(
    session: AsyncSession,
    actor: User,
    asset_id: UUID,
    *,
    lock: bool = False,
) -> Asset:
    stmt = select(Asset).options(*_asset_options()).where(Asset.id == asset_id)
    if lock:
        stmt = stmt.with_for_update()
    asset = (await session.execute(stmt)).unique().scalar_one_or_none()
    if asset is None or not await _asset_in_scope(session, actor, asset):
        raise _not_found()
    return asset


async def _visible_assets_stmt(session: AsyncSession, actor: User):
    stmt = select(Asset).options(*_asset_options())
    scope = visibility_scope(actor)
    if scope is VisibilityScope.COMPANY:
        return stmt
    if scope is VisibilityScope.OFFICE:
        if actor.office_id is None:
            return stmt.where(Asset.id.is_(None))
        return stmt.where(Asset.office_id == actor.office_id)
    allowed = await visible_user_ids(session, actor)
    if not allowed:
        return stmt.where(Asset.id.is_(None))
    active_assets = select(AssetAllocation.asset_id).where(
        AssetAllocation.return_date.is_(None),
        AssetAllocation.employee_id.in_(allowed),
    )
    return stmt.where(Asset.id.in_(active_assets))


def _normalize_definitions(fields: list[CategoryFieldInput]) -> list[dict[str, object]]:
    seen: set[str] = set()
    definitions: list[dict[str, object]] = []
    for field in fields:
        if field.key in seen:
            raise AppError(
                status_code=422,
                code="ASSET_CATEGORY_FIELD_DUPLICATE",
                message="Asset category field keys must be unique",
            )
        seen.add(field.key)
        definitions.append(
            {
                "key": field.key,
                "label": _clean(field.label),
                "required": field.required,
            }
        )
    return definitions


def serialize_category(category: AssetCategory) -> dict[str, object]:
    return {
        "id": str(category.id),
        "code": category.code,
        "name": category.name,
        "description": category.description,
        "status": category.status,
        "fields": category.field_definitions,
        "createdAt": category.created_at.isoformat(),
        "updatedAt": category.updated_at.isoformat(),
    }


def _require_company_master_scope(actor: User) -> None:
    if visibility_scope(actor) is not VisibilityScope.COMPANY:
        raise AppError(
            status_code=403,
            code="ASSET_CATEGORY_SCOPE_FORBIDDEN",
            message="Company scope is required to manage global Asset categories",
        )


async def list_categories(
    session: AsyncSession,
    *,
    active_only: bool = False,
) -> dict[str, object]:
    stmt = select(AssetCategory).order_by(AssetCategory.name)
    if active_only:
        stmt = stmt.where(AssetCategory.status == MasterStatus.ACTIVE)
    rows = list((await session.execute(stmt)).scalars())
    return {"items": [serialize_category(row) for row in rows]}


async def create_category(
    session: AsyncSession,
    actor: User,
    payload: AssetCategoryCreateRequest,
) -> dict[str, object]:
    _require_company_master_scope(actor)
    now = utcnow()
    category = AssetCategory(
        id=new_uuid(),
        code=payload.code.strip().upper(),
        name=_clean(payload.name) or payload.name,
        description=_clean(payload.description),
        status=MasterStatus.ACTIVE,
        field_definitions=_normalize_definitions(payload.fields),
        created_by_id=actor.id,
        updated_by_id=actor.id,
        created_at=now,
        updated_at=now,
    )
    session.add(category)
    await record_audit(
        session,
        action="asset.category.create",
        entity_type="asset_category",
        entity_id=str(category.id),
        actor_id=actor.id,
        new_values={
            "code": category.code,
            "name": category.name,
            "fields": category.field_definitions,
            "status": category.status,
        },
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="ASSET_CATEGORY_DUPLICATE",
            message="Asset category code already exists",
        ) from exc
    return serialize_category(category)


async def _get_category(session: AsyncSession, category_id: UUID, *, lock: bool = False):
    stmt = select(AssetCategory).where(AssetCategory.id == category_id)
    if lock:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise AppError(
            status_code=404,
            code="ASSET_CATEGORY_NOT_FOUND",
            message="Asset category was not found",
        )
    return row


async def update_category(
    session: AsyncSession,
    actor: User,
    category_id: UUID,
    payload: AssetCategoryUpdateRequest,
) -> dict[str, object]:
    _require_company_master_scope(actor)
    category = await _get_category(session, category_id, lock=True)
    old = serialize_category(category)
    data = payload.model_dump(exclude_unset=True)
    if "fields" in data:
        definitions = _normalize_definitions(payload.fields or [])
        if definitions != category.field_definitions:
            count = await session.scalar(
                select(func.count()).select_from(Asset).where(Asset.category_id == category.id)
            )
            if count:
                raise AppError(
                    status_code=409,
                    code="ASSET_CATEGORY_FIELDS_LOCKED",
                    message="Field definitions cannot change after Assets use the category",
                )
            category.field_definitions = definitions
    if "name" in data and payload.name is not None:
        category.name = _clean(payload.name) or category.name
    if "description" in data:
        category.description = _clean(payload.description)
    category.updated_by_id = actor.id
    category.updated_at = utcnow()
    await record_audit(
        session,
        action="asset.category.update",
        entity_type="asset_category",
        entity_id=str(category.id),
        actor_id=actor.id,
        old_values=old,
        new_values=serialize_category(category),
    )
    await session.commit()
    return serialize_category(category)


async def set_category_status(
    session: AsyncSession,
    actor: User,
    category_id: UUID,
    *,
    active: bool,
) -> dict[str, object]:
    _require_company_master_scope(actor)
    category = await _get_category(session, category_id, lock=True)
    target = MasterStatus.ACTIVE if active else MasterStatus.INACTIVE
    if category.status == target:
        return serialize_category(category)
    old = category.status
    category.status = target
    category.updated_by_id = actor.id
    category.updated_at = utcnow()
    await record_audit(
        session,
        action="asset.category.activate" if active else "asset.category.deactivate",
        entity_type="asset_category",
        entity_id=str(category.id),
        actor_id=actor.id,
        old_values={"status": old},
        new_values={"status": category.status},
    )
    await session.commit()
    return serialize_category(category)


async def next_asset_code(session: AsyncSession) -> str:
    counter = await session.get(AssetCodeCounter, 1, with_for_update=True)
    if counter is None:
        counter = AssetCodeCounter(id=1, last_value=0)
        session.add(counter)
        await session.flush()
        counter = await session.get(AssetCodeCounter, 1, with_for_update=True)
        assert counter is not None
    counter.last_value += 1
    return f"AST-{counter.last_value:06d}"


def _asset_values(asset: Asset) -> dict[str, str | None]:
    return {
        "brand": asset.brand,
        "model": asset.model,
        "serial_number": asset.serial_number,
        "imei": asset.imei,
        "iccid": asset.iccid,
        "mobile_number": asset.mobile_number,
        "operator": asset.operator,
    }


def _validate_identifier_shapes(values: dict[str, str | None]) -> None:
    imei = values.get("imei")
    if imei is not None and (not imei.isdigit() or not 14 <= len(imei) <= 16):
        raise AppError(
            status_code=422,
            code="ASSET_IMEI_INVALID",
            message="IMEI must contain 14 to 16 digits",
        )
    iccid = values.get("iccid")
    if iccid is not None and (not iccid.isdigit() or not 18 <= len(iccid) <= 22):
        raise AppError(
            status_code=422,
            code="ASSET_ICCID_INVALID",
            message="ICCID must contain 18 to 22 digits",
        )


def _validate_category_values(
    category: AssetCategory,
    values: dict[str, str | None],
    attributes: dict[str, str],
) -> dict[str, str]:
    definitions = {str(row["key"]): row for row in category.field_definitions}
    normalized_attributes = {
        key: cleaned for key, value in attributes.items() if (cleaned := _clean(value)) is not None
    }
    for key, value in values.items():
        if value is not None and key not in definitions:
            raise AppError(
                status_code=422,
                code="ASSET_FIELD_NOT_ALLOWED",
                message=f"{key} is not configured for this Asset category",
            )
    for key in normalized_attributes:
        if key in BUILTIN_FIELDS or key not in definitions:
            raise AppError(
                status_code=422,
                code="ASSET_ATTRIBUTE_NOT_ALLOWED",
                message=f"{key} is not configured as an additional category attribute",
            )
    combined: dict[str, str | None] = {**values, **normalized_attributes}
    missing = [
        str(row.get("label") or key)
        for key, row in definitions.items()
        if bool(row.get("required")) and not combined.get(key)
    ]
    if missing:
        raise AppError(
            status_code=422,
            code="ASSET_CATEGORY_FIELDS_REQUIRED",
            message="Required Asset category fields are missing",
            details=[{"fields": missing}],
        )
    _validate_identifier_shapes(values)
    return normalized_attributes


def _allocation_payload(row: AssetAllocation) -> dict[str, object]:
    return {
        "id": str(row.id),
        "employeeId": str(row.employee_id),
        "employeeCode": row.employee.user_code if row.employee else None,
        "employeeName": row.employee.full_name if row.employee else None,
        "employmentStatus": row.employee.employment_status if row.employee else None,
        "issueDate": row.issue_date.isoformat(),
        "issuedById": str(row.issued_by_id),
        "issuedBy": row.issued_by.full_name if row.issued_by else None,
        "conditionAtIssue": row.condition_at_issue,
        "issueRemarks": row.issue_remarks,
        "returnDate": row.return_date.isoformat() if row.return_date else None,
        "receivedById": str(row.received_by_id) if row.received_by_id else None,
        "receivedBy": row.received_by.full_name if row.received_by else None,
        "returnCondition": row.return_condition,
        "returnRemarks": row.return_remarks,
        "endType": row.end_type,
        "previousAllocationId": (
            str(row.previous_allocation_id) if row.previous_allocation_id else None
        ),
        "active": row.return_date is None,
    }


def _custody_payload(row: AssetOfficeCustody) -> dict[str, object]:
    return {
        "id": str(row.id),
        "officeId": str(row.office_id),
        "officeCode": row.office.code if row.office else None,
        "officeName": row.office.name if row.office else None,
        "startedOn": row.started_on.isoformat(),
        "endedOn": row.ended_on.isoformat() if row.ended_on else None,
        "transferredById": str(row.transferred_by_id),
        "transferredBy": row.transferred_by.full_name if row.transferred_by else None,
        "reason": row.reason,
        "previousCustodyId": str(row.previous_custody_id) if row.previous_custody_id else None,
        "active": row.ended_on is None,
    }


def serialize_asset(asset: Asset) -> dict[str, object]:
    allocation = _active_allocation(asset)
    outstanding = bool(
        allocation
        and allocation.employee
        and allocation.employee.employment_status in OUTSTANDING_EMPLOYMENT
    )
    return {
        "id": str(asset.id),
        "assetCode": asset.asset_code,
        "category": serialize_category(asset.category),
        "office": {
            "id": str(asset.office.id),
            "code": asset.office.code,
            "name": asset.office.name,
        }
        if asset.office
        else None,
        "status": asset.status,
        "condition": asset.condition,
        "brand": asset.brand,
        "model": asset.model,
        "serialNumber": asset.serial_number,
        "imei": asset.imei,
        "iccid": asset.iccid,
        "mobileNumber": asset.mobile_number,
        "operator": asset.operator,
        "attributes": asset.attributes,
        "description": asset.description,
        "currentAllocation": _allocation_payload(allocation) if allocation else None,
        "outstanding": outstanding,
        "createdAt": asset.created_at.isoformat(),
        "updatedAt": asset.updated_at.isoformat(),
    }


def _asset_audit_values(asset: Asset) -> dict[str, object]:
    allocation = _active_allocation(asset)
    return {
        "assetCode": asset.asset_code,
        "categoryId": str(asset.category_id),
        "officeId": str(asset.office_id),
        "status": asset.status,
        "condition": asset.condition,
        "brand": asset.brand,
        "model": asset.model,
        "serialNumber": asset.serial_number,
        "imei": asset.imei,
        "iccid": asset.iccid,
        "mobileNumber": asset.mobile_number,
        "operator": asset.operator,
        "attributes": asset.attributes,
        "activeEmployeeId": str(allocation.employee_id) if allocation else None,
    }


def _integrity_error(exc: IntegrityError) -> AppError:
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    constraint = (getattr(diag, "constraint_name", None) or "").lower()
    blob = f"{constraint} {orig or exc}".lower()
    if "serial_number" in blob:
        code, message = "ASSET_SERIAL_DUPLICATE", "Serial Number / Service Tag already exists"
    elif "imei" in blob:
        code, message = "ASSET_IMEI_DUPLICATE", "IMEI already exists"
    elif "iccid" in blob:
        code, message = "ASSET_ICCID_DUPLICATE", "ICCID already exists"
    elif "asset_allocations_active" in blob:
        code, message = (
            "ASSET_ALREADY_ALLOCATED",
            "Asset already has an active employee allocation",
        )
    elif "asset_code" in blob:
        code, message = "ASSET_CODE_CONFLICT", "Asset Code could not be allocated"
    else:
        code, message = "ASSET_CONFLICT", "Asset change conflicts with existing data"
    return AppError(status_code=409, code=code, message=message)


async def create_asset(
    session: AsyncSession,
    actor: User,
    payload: AssetCreateRequest,
) -> dict[str, object]:
    if not _office_in_scope(actor, payload.office_id):
        raise AppError(
            status_code=404,
            code="ASSET_OFFICE_NOT_FOUND",
            message="Asset Office was not found",
        )
    office = await session.get(Office, payload.office_id)
    if office is None or office.status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=404,
            code="ASSET_OFFICE_NOT_FOUND",
            message="Asset Office was not found",
        )
    category = await _get_category(session, payload.category_id)
    if category.status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=422,
            code="ASSET_CATEGORY_INACTIVE",
            message="New Assets require an active category",
        )
    values = {
        "brand": _clean(payload.brand),
        "model": _clean(payload.model),
        "serial_number": _identifier(payload.serial_number),
        "imei": _identifier(payload.imei, compact=True),
        "iccid": _identifier(payload.iccid, compact=True),
        "mobile_number": _clean(payload.mobile_number),
        "operator": _clean(payload.operator),
    }
    attributes = _validate_category_values(category, values, payload.attributes)
    now = utcnow()
    asset = Asset(
        id=new_uuid(),
        asset_code=await next_asset_code(session),
        category_id=category.id,
        office_id=office.id,
        status=AssetStatus.IN_STOCK,
        condition=payload.condition.value,
        **values,
        attributes=attributes,
        description=_clean(payload.description),
        created_by_id=actor.id,
        updated_by_id=actor.id,
        created_at=now,
        updated_at=now,
    )
    session.add(asset)
    session.add(
        AssetOfficeCustody(
            id=new_uuid(),
            asset_id=asset.id,
            office_id=office.id,
            started_on=now.date(),
            ended_on=None,
            transferred_by_id=actor.id,
            reason="Initial Asset custody",
            previous_custody_id=None,
            created_at=now,
            closed_at=None,
        )
    )
    await record_audit(
        session,
        action="asset.create",
        entity_type="asset",
        entity_id=str(asset.id),
        actor_id=actor.id,
        new_values=_asset_audit_values(asset),
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _integrity_error(exc) from exc
    return serialize_asset(await _get_asset(session, actor, asset.id))


async def list_assets(
    session: AsyncSession,
    actor: User,
    *,
    q: str | None = None,
    status: AssetStatus | None = None,
    category_id: UUID | None = None,
    office_id: UUID | None = None,
    employee_id: UUID | None = None,
    outstanding: bool | None = None,
) -> dict[str, object]:
    stmt = await _visible_assets_stmt(session, actor)
    if q and (cleaned := _clean(q)):
        like = f"%{cleaned}%"
        stmt = stmt.where(
            or_(
                Asset.asset_code.ilike(like),
                Asset.brand.ilike(like),
                Asset.model.ilike(like),
                Asset.serial_number.ilike(like),
                Asset.imei.ilike(like),
                Asset.iccid.ilike(like),
                Asset.mobile_number.ilike(like),
            )
        )
    if status is not None:
        stmt = stmt.where(Asset.status == status.value)
    if category_id is not None:
        stmt = stmt.where(Asset.category_id == category_id)
    if office_id is not None:
        stmt = stmt.where(Asset.office_id == office_id)
    if employee_id is not None:
        stmt = stmt.where(
            Asset.allocations.any(
                and_(
                    AssetAllocation.employee_id == employee_id,
                    AssetAllocation.return_date.is_(None),
                )
            )
        )
    stmt = stmt.order_by(Asset.asset_code)
    rows = list((await session.execute(stmt)).unique().scalars())
    if outstanding is not None:
        rows = [row for row in rows if bool(serialize_asset(row)["outstanding"]) is outstanding]
    return {"items": [serialize_asset(row) for row in rows], "total": len(rows)}


async def get_asset(session: AsyncSession, actor: User, asset_id: UUID) -> dict[str, object]:
    return serialize_asset(await _get_asset(session, actor, asset_id))


async def update_asset_master(
    session: AsyncSession,
    actor: User,
    asset_id: UUID,
    payload: AssetMasterUpdateRequest,
) -> dict[str, object]:
    asset = await _get_asset(session, actor, asset_id, lock=True)
    old = _asset_audit_values(asset)
    data = payload.model_dump(exclude_unset=True)
    category = asset.category
    if "category_id" in data:
        if payload.category_id is None:
            raise AppError(
                status_code=422,
                code="ASSET_CATEGORY_REQUIRED",
                message="Asset category cannot be cleared",
            )
        if _active_allocation(asset) is not None:
            raise AppError(
                status_code=409,
                code="ASSET_CATEGORY_ALLOCATED",
                message="An allocated Asset category cannot be changed",
            )
        category = await _get_category(session, payload.category_id)
        if category.status != MasterStatus.ACTIVE:
            raise AppError(
                status_code=422,
                code="ASSET_CATEGORY_INACTIVE",
                message="Asset category must be active",
            )
        asset.category_id = category.id
        asset.category = category
    for field in ("brand", "model", "mobile_number", "operator", "description"):
        if field in data:
            setattr(asset, field, _clean(getattr(payload, field)))
    if "attributes" in data:
        asset.attributes = payload.attributes or {}
    values = _asset_values(asset)
    asset.attributes = _validate_category_values(category, values, asset.attributes)
    asset.updated_by_id = actor.id
    asset.updated_at = utcnow()
    await record_audit(
        session,
        action="asset.master.update",
        entity_type="asset",
        entity_id=str(asset.id),
        actor_id=actor.id,
        old_values=old,
        new_values=_asset_audit_values(asset),
    )
    await session.commit()
    return serialize_asset(await _get_asset(session, actor, asset.id))


async def correct_identifiers(
    session: AsyncSession,
    actor: User,
    asset_id: UUID,
    payload: IdentifierCorrectionRequest,
) -> dict[str, object]:
    asset = await _get_asset(session, actor, asset_id, lock=True)
    changed = payload.model_fields_set.intersection({"serial_number", "imei", "iccid"})
    if not changed:
        raise AppError(
            status_code=422,
            code="ASSET_IDENTIFIER_REQUIRED",
            message="At least one identifier correction is required",
        )
    old = {key: getattr(asset, key) for key in changed}
    if "serial_number" in changed:
        asset.serial_number = _identifier(payload.serial_number)
    if "imei" in changed:
        asset.imei = _identifier(payload.imei, compact=True)
    if "iccid" in changed:
        asset.iccid = _identifier(payload.iccid, compact=True)
    asset.attributes = _validate_category_values(
        asset.category, _asset_values(asset), asset.attributes
    )
    asset.updated_by_id = actor.id
    asset.updated_at = utcnow()
    new = {key: getattr(asset, key) for key in changed}
    await record_audit(
        session,
        action="asset.identifier.correct",
        entity_type="asset",
        entity_id=str(asset.id),
        actor_id=actor.id,
        old_values=old,
        new_values=new,
        note=_clean(payload.reason),
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _integrity_error(exc) from exc
    return serialize_asset(await _get_asset(session, actor, asset.id))


async def correct_condition(
    session: AsyncSession,
    actor: User,
    asset_id: UUID,
    payload: AssetConditionCorrectionRequest,
) -> dict[str, object]:
    asset = await _get_asset(session, actor, asset_id, lock=True)
    old = asset.condition
    asset.condition = payload.condition.value
    asset.updated_by_id = actor.id
    asset.updated_at = utcnow()
    await record_audit(
        session,
        action="asset.condition.correct",
        entity_type="asset",
        entity_id=str(asset.id),
        actor_id=actor.id,
        old_values={"condition": old},
        new_values={"condition": asset.condition},
        note=_clean(payload.reason),
    )
    await session.commit()
    return serialize_asset(await _get_asset(session, actor, asset.id))


async def _authorized_employee(
    session: AsyncSession,
    actor: User,
    employee_id: UUID,
) -> User:
    employee = (
        await session.execute(
            select(User).options(*user_load_options()).where(User.id == employee_id)
        )
    ).scalar_one_or_none()
    allowed = await visible_user_ids(session, actor)
    if employee is None or (allowed is not None and employee.id not in allowed):
        raise AppError(
            status_code=404,
            code="ASSET_EMPLOYEE_NOT_FOUND",
            message="Asset employee was not found",
        )
    return employee


def _require_eligible_employee(employee: User) -> None:
    if employee.employment_status not in ELIGIBLE_EMPLOYMENT:
        raise AppError(
            status_code=422,
            code="ASSET_EMPLOYEE_INELIGIBLE",
            message="Employee employment status is not eligible for a new Asset allocation",
            details=[{"employmentStatus": employee.employment_status}],
        )


async def allocate_asset(
    session: AsyncSession,
    actor: User,
    asset_id: UUID,
    payload: AssetAllocationRequest,
) -> dict[str, object]:
    asset = await _get_asset(session, actor, asset_id, lock=True)
    if asset.status != AssetStatus.IN_STOCK or _active_allocation(asset) is not None:
        raise AppError(
            status_code=409,
            code="ASSET_NOT_AVAILABLE",
            message="Only an In Stock Asset without active custody can be allocated",
        )
    employee = await _authorized_employee(session, actor, payload.employee_id)
    _require_eligible_employee(employee)
    if employee.office_id is None or employee.office_id != asset.office_id:
        raise AppError(
            status_code=422,
            code="ASSET_OFFICE_MISMATCH",
            message="Asset and employee must have the same current Office custody",
        )
    now = utcnow()
    allocation = AssetAllocation(
        id=new_uuid(),
        asset_id=asset.id,
        employee_id=employee.id,
        issue_date=payload.issue_date,
        issued_by_id=actor.id,
        condition_at_issue=payload.condition_at_issue.value,
        issue_remarks=_clean(payload.remarks),
        return_date=None,
        received_by_id=None,
        return_condition=None,
        return_remarks=None,
        end_type=None,
        previous_allocation_id=None,
        created_at=now,
        closed_at=None,
    )
    session.add(allocation)
    asset.allocations.append(allocation)
    asset.status = AssetStatus.ALLOCATED
    asset.condition = payload.condition_at_issue.value
    asset.updated_by_id = actor.id
    asset.updated_at = now
    await record_audit(
        session,
        action="asset.allocate",
        entity_type="asset",
        entity_id=str(asset.id),
        actor_id=actor.id,
        target_user_id=employee.id,
        old_values={"status": AssetStatus.IN_STOCK.value, "activeEmployeeId": None},
        new_values={
            "status": asset.status,
            "activeEmployeeId": str(employee.id),
            "issueDate": payload.issue_date.isoformat(),
            "conditionAtIssue": payload.condition_at_issue.value,
        },
        note=_clean(payload.remarks),
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _integrity_error(exc) from exc
    return serialize_asset(await _get_asset(session, actor, asset.id))


async def return_asset(
    session: AsyncSession,
    actor: User,
    asset_id: UUID,
    payload: AssetReturnRequest,
) -> dict[str, object]:
    asset = await _get_asset(session, actor, asset_id, lock=True)
    allocation = _active_allocation(asset)
    if allocation is None:
        raise AppError(
            status_code=409,
            code="ASSET_NOT_ALLOCATED",
            message="Asset has no active employee allocation to return",
        )
    if payload.return_date < allocation.issue_date:
        raise AppError(
            status_code=422,
            code="ASSET_RETURN_DATE_INVALID",
            message="Return Date cannot precede the Allocation Date",
        )
    return_reason = _clean(payload.remarks)
    if payload.return_condition is AssetCondition.DAMAGED:
        if not has_permission(actor, ASSETS_MANAGE_STATUS):
            raise AppError(
                status_code=403,
                code="FORBIDDEN",
                message="You do not have permission to perform this action",
                details=[{"permission": ASSETS_MANAGE_STATUS}],
            )
        if return_reason is None:
            raise AppError(
                status_code=422,
                code="ASSET_STATUS_REASON_REQUIRED",
                message="A reason is required when a damaged return changes Asset status",
            )
    now = utcnow()
    old_status = asset.status
    allocation.return_date = payload.return_date
    allocation.received_by_id = actor.id
    allocation.received_by = actor
    allocation.return_condition = payload.return_condition.value
    allocation.return_remarks = return_reason
    allocation.end_type = AllocationEndType.RETURN
    allocation.closed_at = now
    asset.status = (
        AssetStatus.DAMAGED
        if payload.return_condition is AssetCondition.DAMAGED
        else AssetStatus.IN_STOCK
    )
    asset.condition = payload.return_condition.value
    asset.updated_by_id = actor.id
    asset.updated_at = now
    await record_audit(
        session,
        action="asset.return",
        entity_type="asset",
        entity_id=str(asset.id),
        actor_id=actor.id,
        target_user_id=allocation.employee_id,
        old_values={
            "status": old_status,
            "activeEmployeeId": str(allocation.employee_id),
        },
        new_values={
            "status": asset.status,
            "activeEmployeeId": None,
            "returnDate": payload.return_date.isoformat(),
            "returnCondition": payload.return_condition.value,
        },
        note=return_reason,
    )
    await session.commit()
    return serialize_asset(await _get_asset(session, actor, asset.id))


def _close_office_custody(
    asset: Asset,
    actor: User,
    *,
    destination: Office,
    transfer_date: date,
    remarks: str | None,
) -> None:
    current = _active_custody(asset)
    if current is None:
        raise AppError(
            status_code=409,
            code="ASSET_CUSTODY_INVALID",
            message="Asset does not have a current Office custody record",
        )
    if transfer_date < current.started_on:
        raise AppError(
            status_code=422,
            code="ASSET_TRANSFER_DATE_INVALID",
            message="Transfer Date cannot precede current Office custody",
        )
    if destination.id == current.office_id:
        raise AppError(
            status_code=409,
            code="ASSET_OFFICE_UNCHANGED",
            message="Asset is already in the requested Office",
        )
    now = utcnow()
    current.ended_on = transfer_date
    current.closed_at = now
    next_custody = AssetOfficeCustody(
        id=new_uuid(),
        asset_id=asset.id,
        office_id=destination.id,
        started_on=transfer_date,
        ended_on=None,
        transferred_by_id=actor.id,
        reason=_clean(remarks),
        previous_custody_id=current.id,
        created_at=now,
        closed_at=None,
        office=destination,
        transferred_by=actor,
    )
    asset.office_history.append(next_custody)
    asset.office_id = destination.id
    asset.office = destination


async def transfer_employee(
    session: AsyncSession,
    actor: User,
    asset_id: UUID,
    payload: EmployeeTransferRequest,
) -> dict[str, object]:
    asset = await _get_asset(session, actor, asset_id, lock=True)
    current = _active_allocation(asset)
    if current is None:
        raise AppError(
            status_code=409,
            code="ASSET_NOT_ALLOCATED",
            message="Employee transfer requires an active Asset allocation",
        )
    if payload.transfer_date < current.issue_date:
        raise AppError(
            status_code=422,
            code="ASSET_TRANSFER_DATE_INVALID",
            message="Transfer Date cannot precede the current Allocation Date",
        )
    if payload.employee_id == current.employee_id:
        raise AppError(
            status_code=409,
            code="ASSET_EMPLOYEE_UNCHANGED",
            message="Asset is already allocated to the requested employee",
        )
    employee = await _authorized_employee(session, actor, payload.employee_id)
    _require_eligible_employee(employee)
    if employee.office_id is None:
        raise AppError(
            status_code=422,
            code="ASSET_EMPLOYEE_OFFICE_REQUIRED",
            message="Target employee must have an Office assignment",
        )
    old_office_id = asset.office_id
    if employee.office_id != asset.office_id:
        if not _office_in_scope(actor, employee.office_id):
            raise AppError(
                status_code=404,
                code="ASSET_EMPLOYEE_NOT_FOUND",
                message="Asset employee was not found",
            )
        destination = await session.get(Office, employee.office_id)
        if destination is None or destination.status != MasterStatus.ACTIVE:
            raise AppError(
                status_code=422,
                code="ASSET_EMPLOYEE_OFFICE_INACTIVE",
                message="Target employee Office must be active",
            )
        _close_office_custody(
            asset,
            actor,
            destination=destination,
            transfer_date=payload.transfer_date,
            remarks=payload.remarks,
        )
    now = utcnow()
    current.return_date = payload.transfer_date
    current.received_by_id = actor.id
    current.received_by = actor
    current.return_condition = payload.condition.value
    current.return_remarks = _clean(payload.remarks)
    current.end_type = AllocationEndType.EMPLOYEE_TRANSFER
    current.closed_at = now
    next_allocation = AssetAllocation(
        id=new_uuid(),
        asset_id=asset.id,
        employee_id=employee.id,
        issue_date=payload.transfer_date,
        issued_by_id=actor.id,
        condition_at_issue=payload.condition.value,
        issue_remarks=_clean(payload.remarks),
        return_date=None,
        received_by_id=None,
        return_condition=None,
        return_remarks=None,
        end_type=None,
        previous_allocation_id=current.id,
        created_at=now,
        closed_at=None,
        employee=employee,
        issued_by=actor,
    )
    asset.allocations.append(next_allocation)
    asset.status = AssetStatus.ALLOCATED
    asset.condition = payload.condition.value
    asset.updated_by_id = actor.id
    asset.updated_at = now
    await record_audit(
        session,
        action="asset.employee.transfer",
        entity_type="asset",
        entity_id=str(asset.id),
        actor_id=actor.id,
        target_user_id=employee.id,
        old_values={
            "employeeId": str(current.employee_id),
            "officeId": str(old_office_id),
        },
        new_values={
            "employeeId": str(employee.id),
            "officeId": str(asset.office_id),
            "transferDate": payload.transfer_date.isoformat(),
            "condition": payload.condition.value,
        },
        note=_clean(payload.remarks),
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _integrity_error(exc) from exc
    return serialize_asset(await _get_asset(session, actor, asset.id))


async def transfer_office(
    session: AsyncSession,
    actor: User,
    asset_id: UUID,
    payload: OfficeTransferRequest,
) -> dict[str, object]:
    asset = await _get_asset(session, actor, asset_id, lock=True)
    if asset.status == AssetStatus.RETIRED:
        raise AppError(
            status_code=409,
            code="ASSET_RETIRED_IMMUTABLE",
            message="Retired Asset custody cannot be changed",
        )
    if not _office_in_scope(actor, payload.office_id):
        raise AppError(
            status_code=404,
            code="ASSET_OFFICE_NOT_FOUND",
            message="Asset Office was not found",
        )
    destination = await session.get(Office, payload.office_id)
    if destination is None or destination.status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=404,
            code="ASSET_OFFICE_NOT_FOUND",
            message="Asset Office was not found",
        )
    allocation = _active_allocation(asset)
    if allocation and allocation.employee and allocation.employee.office_id != destination.id:
        raise AppError(
            status_code=409,
            code="ASSET_ALLOCATED_OFFICE_MISMATCH",
            message="Allocated Asset Office must match the current employee Office",
        )
    old_office_id = asset.office_id
    _close_office_custody(
        asset,
        actor,
        destination=destination,
        transfer_date=payload.transfer_date,
        remarks=payload.remarks,
    )
    asset.updated_by_id = actor.id
    asset.updated_at = utcnow()
    await record_audit(
        session,
        action="asset.office.transfer",
        entity_type="asset",
        entity_id=str(asset.id),
        actor_id=actor.id,
        old_values={"officeId": str(old_office_id)},
        new_values={
            "officeId": str(destination.id),
            "transferDate": payload.transfer_date.isoformat(),
        },
        note=_clean(payload.remarks),
    )
    await session.commit()
    return serialize_asset(await _get_asset(session, actor, asset.id))


async def set_asset_status(
    session: AsyncSession,
    actor: User,
    asset_id: UUID,
    payload: AssetStatusRequest,
) -> dict[str, object]:
    asset = await _get_asset(session, actor, asset_id, lock=True)
    allocation = _active_allocation(asset)
    target = payload.status
    if target is AssetStatus.RETIRED and allocation is not None:
        raise AppError(
            status_code=409,
            code="ASSET_RETIRED_ALLOCATED",
            message="An actively allocated Asset cannot be retired",
        )
    if target is AssetStatus.IN_STOCK and allocation is not None:
        raise AppError(
            status_code=409,
            code="ASSET_STATUS_CUSTODY_CONFLICT",
            message="An actively allocated Asset cannot be marked In Stock",
        )
    if target is AssetStatus.ALLOCATED and allocation is None:
        raise AppError(
            status_code=409,
            code="ASSET_STATUS_CUSTODY_CONFLICT",
            message="Allocated status requires an active employee allocation",
        )
    old = asset.status
    asset.status = target.value
    asset.updated_by_id = actor.id
    asset.updated_at = utcnow()
    await record_audit(
        session,
        action="asset.status.change",
        entity_type="asset",
        entity_id=str(asset.id),
        actor_id=actor.id,
        old_values={"status": old},
        new_values={"status": asset.status},
        note=_clean(payload.reason),
    )
    await session.commit()
    return serialize_asset(await _get_asset(session, actor, asset.id))


def _event_payload(event: AuditEvent) -> dict[str, object]:
    return {
        "id": str(event.id),
        "action": event.action,
        "entityId": event.entity_id,
        "actorId": str(event.actor_id) if event.actor_id else None,
        "targetUserId": str(event.target_user_id) if event.target_user_id else None,
        "oldValues": event.old_values,
        "newValues": event.new_values,
        "reason": event.note,
        "createdAt": event.created_at.isoformat(),
    }


async def asset_history(
    session: AsyncSession,
    actor: User,
    asset_id: UUID,
) -> dict[str, object]:
    asset = await _get_asset(session, actor, asset_id)
    events = list(
        (
            await session.execute(
                select(AuditEvent)
                .where(
                    AuditEvent.entity_type == "asset",
                    AuditEvent.entity_id == str(asset.id),
                )
                .order_by(AuditEvent.created_at.desc())
            )
        ).scalars()
    )
    return {
        "asset": serialize_asset(asset),
        "allocations": [_allocation_payload(row) for row in asset.allocations],
        "officeCustody": [_custody_payload(row) for row in asset.office_history],
        "events": [_event_payload(row) for row in events],
    }


async def asset_audit(
    session: AsyncSession,
    actor: User,
    *,
    asset_id: UUID | None = None,
) -> dict[str, object]:
    if asset_id is not None:
        asset = await _get_asset(session, actor, asset_id)
        ids = {str(asset.id)}
    else:
        stmt = await _visible_assets_stmt(session, actor)
        rows = list((await session.execute(stmt)).unique().scalars())
        ids = {str(row.id) for row in rows}
    if not ids:
        return {"items": [], "total": 0}
    events = list(
        (
            await session.execute(
                select(AuditEvent)
                .where(
                    AuditEvent.entity_type == "asset",
                    AuditEvent.entity_id.in_(ids),
                )
                .order_by(AuditEvent.created_at.desc())
            )
        ).scalars()
    )
    return {"items": [_event_payload(row) for row in events], "total": len(events)}


async def employee_assets(
    session: AsyncSession,
    actor: User,
    employee_id: UUID,
) -> dict[str, object]:
    await _authorized_employee(session, actor, employee_id)
    stmt = await _visible_assets_stmt(session, actor)
    stmt = stmt.where(Asset.allocations.any(AssetAllocation.employee_id == employee_id))
    assets = list((await session.execute(stmt.order_by(Asset.asset_code))).unique().scalars())
    current: list[dict[str, object]] = []
    history: list[dict[str, object]] = []
    for asset in assets:
        for allocation in asset.allocations:
            if allocation.employee_id != employee_id:
                continue
            item = {
                "asset": serialize_asset(asset),
                "allocation": _allocation_payload(allocation),
            }
            if allocation.return_date is None:
                current.append(item)
            else:
                history.append(item)
    return {"current": current, "history": history}


async def asset_options(session: AsyncSession, actor: User) -> dict[str, object]:
    categories = await list_categories(session, active_only=True)
    office_stmt = select(Office).where(Office.status == MasterStatus.ACTIVE).order_by(Office.name)
    scope = visibility_scope(actor)
    if scope is not VisibilityScope.COMPANY:
        if actor.office_id is None:
            offices: list[Office] = []
        else:
            offices = list(
                (await session.execute(office_stmt.where(Office.id == actor.office_id))).scalars()
            )
    else:
        offices = list((await session.execute(office_stmt)).scalars())
    allowed = await visible_user_ids(session, actor)
    employee_stmt = select(User).options(*user_load_options()).order_by(User.full_name)
    if allowed is not None:
        employee_stmt = employee_stmt.where(User.id.in_(allowed))
    employees = list((await session.execute(employee_stmt)).scalars())
    return {
        "categories": categories["items"],
        "offices": [{"id": str(row.id), "code": row.code, "name": row.name} for row in offices],
        "employees": [
            {
                "id": str(row.id),
                "userCode": row.user_code,
                "fullName": row.full_name,
                "employmentStatus": row.employment_status,
                "officeId": str(row.office_id) if row.office_id else None,
            }
            for row in employees
        ],
        "statuses": [row.value for row in AssetStatus],
        "conditions": [row.value for row in AssetCondition],
        "reports": [
            {"key": report.value, "title": title} for report, title in REPORT_TITLES.items()
        ],
    }


def _report_asset_row(asset: dict[str, Any]) -> dict[str, object]:
    allocation = asset.get("currentAllocation") or {}
    category = asset.get("category") or {}
    office = asset.get("office") or {}
    return {
        "Asset Code": asset.get("assetCode"),
        "Category": category.get("name"),
        "Office": office.get("name"),
        "Status": asset.get("status"),
        "Condition": asset.get("condition"),
        "Brand": asset.get("brand"),
        "Model": asset.get("model"),
        "Serial / Service Tag": asset.get("serialNumber"),
        "IMEI": asset.get("imei"),
        "ICCID": asset.get("iccid"),
        "Mobile Number": asset.get("mobileNumber"),
        "Operator": asset.get("operator"),
        "Employee Code": allocation.get("employeeCode"),
        "Employee": allocation.get("employeeName"),
        "Issue Date": allocation.get("issueDate"),
        "Outstanding": "Yes" if asset.get("outstanding") else "No",
    }


async def asset_report(
    session: AsyncSession,
    actor: User,
    report: AssetReport,
    *,
    office_id: UUID | None = None,
    employee_id: UUID | None = None,
    category_id: UUID | None = None,
) -> dict[str, object]:
    listed = await list_assets(
        session,
        actor,
        office_id=office_id,
        category_id=category_id,
    )
    assets = list(listed["items"])
    if report is AssetReport.AVAILABLE_STOCK:
        assets = [row for row in assets if row["status"] == AssetStatus.IN_STOCK]
    elif report in (AssetReport.ALLOCATED_ASSETS, AssetReport.EMPLOYEE_ASSETS):
        assets = [row for row in assets if row["currentAllocation"] is not None]
    elif report is AssetReport.DAMAGED_ASSETS:
        assets = [row for row in assets if row["status"] == AssetStatus.DAMAGED]
    elif report is AssetReport.LOST_ASSETS:
        assets = [row for row in assets if row["status"] == AssetStatus.LOST]
    elif report is AssetReport.UNDER_REPAIR_ASSETS:
        assets = [row for row in assets if row["status"] == AssetStatus.UNDER_REPAIR]
    elif report is AssetReport.OUTSTANDING_ASSETS:
        assets = [row for row in assets if row["outstanding"]]
    if employee_id is not None and report is not AssetReport.RETURNED_ASSETS:
        assets = [
            row
            for row in assets
            if row["currentAllocation"]
            and row["currentAllocation"]["employeeId"] == str(employee_id)
        ]
    if report is AssetReport.RETURNED_ASSETS:
        stmt = await _visible_assets_stmt(session, actor)
        if office_id is not None:
            stmt = stmt.where(Asset.office_id == office_id)
        if category_id is not None:
            stmt = stmt.where(Asset.category_id == category_id)
        rows = list((await session.execute(stmt)).unique().scalars())
        items: list[dict[str, object]] = []
        for asset in rows:
            base = _report_asset_row(serialize_asset(asset))
            for allocation in asset.allocations:
                if allocation.end_type != AllocationEndType.RETURN:
                    continue
                if employee_id is not None and allocation.employee_id != employee_id:
                    continue
                items.append(
                    {
                        **base,
                        "Employee Code": allocation.employee.user_code,
                        "Employee": allocation.employee.full_name,
                        "Issue Date": allocation.issue_date.isoformat(),
                        "Return Date": allocation.return_date.isoformat()
                        if allocation.return_date
                        else None,
                        "Return Condition": allocation.return_condition,
                        "Received By": allocation.received_by.full_name
                        if allocation.received_by
                        else None,
                    }
                )
    elif report is AssetReport.ASSET_HISTORY:
        audit = await asset_audit(session, actor)
        items = [
            {
                "Action": row["action"],
                "Asset ID": row["newValues"].get("assetCode")
                if isinstance(row.get("newValues"), dict)
                else None,
                "Actor ID": row["actorId"],
                "Reason": row["reason"],
                "Timestamp": row["createdAt"],
            }
            for row in audit["items"]
        ]
    else:
        items = [_report_asset_row(row) for row in assets]
    return {
        "report": report.value,
        "title": REPORT_TITLES[report],
        "reportingScope": visibility_scope(actor).value,
        "filters": {
            "officeId": str(office_id) if office_id else None,
            "employeeId": str(employee_id) if employee_id else None,
            "categoryId": str(category_id) if category_id else None,
        },
        "items": items,
        "total": len(items),
    }
