"""Business units use existing Departments.Manage authority; deletion is separately OWNER-only."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import MasterStatus
from nexa_bos_api.identity.models import (
    BusinessUnit,
    BusinessUnitNameHistory,
    Department,
    Office,
    Team,
    User,
    new_uuid,
)
from nexa_bos_api.identity.org_service import _unique_code, utcnow


def serialize_business_unit(row: BusinessUnit):
    return {
        "id": str(row.id),
        "officeId": str(row.office_id),
        "departmentId": str(row.department_id),
        "code": row.code,
        "name": row.name,
        "status": row.status,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
        "createdById": str(row.created_by_id),
        "updatedById": str(row.updated_by_id),
    }


async def validate_parents(session: AsyncSession, office_id: UUID, department_id: UUID):
    office = await session.get(Office, office_id)
    department = await session.get(Department, department_id)
    if office is None or department is None or department.office_id != office_id:
        raise AppError(
            status_code=422,
            code="BUSINESS_UNIT_ORG_MISMATCH",
            message="Department must belong to the selected office",
        )
    if office.status != MasterStatus.ACTIVE or department.status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=422,
            code="BUSINESS_UNIT_PARENT_INACTIVE",
            message="Select an active office and department",
        )


async def validate_business_unit(
    session: AsyncSession, unit_id: UUID, office_id: UUID, department_id: UUID
):
    unit = await session.scalar(
        select(BusinessUnit).where(BusinessUnit.id == unit_id).with_for_update(read=True)
    )
    if unit is None or unit.office_id != office_id or unit.department_id != department_id:
        raise AppError(
            status_code=422,
            code="BUSINESS_UNIT_ORG_MISMATCH",
            message="Business Unit must match the selected office and department",
        )
    if unit.status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=422, code="BUSINESS_UNIT_INACTIVE", message="Select an active Business Unit"
        )
    return unit


async def save_business_unit(
    session: AsyncSession,
    actor: User,
    *,
    office_id: UUID,
    department_id: UUID,
    name: str,
    code: str | None = None,
    unit_id: UUID | None = None,
):
    if not name.strip() or (unit_id is None and not (code or "").strip()):
        raise AppError(
            status_code=422,
            code="BUSINESS_UNIT_DETAILS_REQUIRED",
            message="Business Unit name and immutable code cannot be blank",
        )
    await validate_parents(session, office_id, department_id)
    now = utcnow()
    if unit_id is None:
        row = BusinessUnit(
            id=new_uuid(),
            office_id=office_id,
            department_id=department_id,
            code=await _unique_code(session, BusinessUnit, code or "", "business_unit"),
            name=name.strip(),
            status=MasterStatus.ACTIVE,
            created_at=now,
            updated_at=now,
            created_by_id=actor.id,
            updated_by_id=actor.id,
        )
        session.add(row)
        await session.flush()
        action, old = "create", None
    else:
        row = await session.get(BusinessUnit, unit_id, with_for_update=True)
        if row is None:
            raise AppError(
                status_code=404, code="BUSINESS_UNIT_NOT_FOUND", message="Business Unit not found"
            )
        old = serialize_business_unit(row)
        if (row.office_id, row.department_id) != (office_id, department_id):
            # Parent changes are only safe before any actual use, including history.
            from nexa_bos_api.identity.org_deletion import (
                _reference_queries,
                lock_master_references,
            )

            try:
                await lock_master_references(session, "business_unit", row.id)
            except DBAPIError as exc:
                await session.rollback()
                raise AppError(
                    status_code=409,
                    code="MASTER_CHANGE_CONFLICT",
                    message="Concurrent activity prevented this change",
                ) from exc

            for _, query in _reference_queries("business_unit", row.id):
                if await session.scalar(query):
                    raise AppError(
                        status_code=409,
                        code="MASTER_IN_USE",
                        message="A used Business Unit cannot change office or department",
                    )
        row.office_id, row.department_id = office_id, department_id
        row.name, row.updated_at, row.updated_by_id = name.strip(), now, actor.id
        action = "rename"
    if old is None or old["name"] != row.name:
        current = await session.scalar(
            select(BusinessUnitNameHistory).where(
                BusinessUnitNameHistory.business_unit_id == row.id,
                BusinessUnitNameHistory.effective_to.is_(None),
            )
        )
        if current is not None:
            current.effective_to = now
        session.add(
            BusinessUnitNameHistory(
                id=new_uuid(),
                original_record_id=row.id,
                business_unit_id=row.id,
                name=row.name,
                effective_from=now,
            )
        )
    await record_audit(
        session,
        action=f"business_unit.{action}",
        entity_type="business_unit",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old,
        new_values=serialize_business_unit(row),
    )
    await session.commit()
    return serialize_business_unit(row)


async def business_unit_status(
    session: AsyncSession, actor: User, unit_id: UUID, status: MasterStatus
):
    row = await session.get(BusinessUnit, unit_id, with_for_update=True)
    if row is None:
        raise AppError(
            status_code=404, code="BUSINESS_UNIT_NOT_FOUND", message="Business Unit not found"
        )
    if status == MasterStatus.INACTIVE:
        for model in (Team, User):
            if await session.scalar(
                select(func.count()).select_from(model).where(model.business_unit_id == row.id)
            ):
                raise AppError(
                    status_code=409,
                    code="MASTER_IN_USE",
                    message="Business Unit still has teams or employees",
                )
    else:
        await validate_parents(session, row.office_id, row.department_id)
    row.status, row.updated_at, row.updated_by_id = status, utcnow(), actor.id
    await record_audit(
        session,
        action="business_unit.status",
        entity_type="business_unit",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values={"status": status},
    )
    await session.commit()
    return serialize_business_unit(row)
