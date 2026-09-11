from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.business_units import (
    business_unit_status,
    save_business_unit,
    serialize_business_unit,
    validate_business_unit,
)
from nexa_bos_api.identity.enums import MasterStatus
from nexa_bos_api.identity.hierarchy_service import organization_hierarchy
from nexa_bos_api.identity.models import BusinessUnit, Department, Designation, Office
from nexa_bos_api.identity.org_deletion import (
    _reference_queries,
    delete_unused_master,
    deletion_preview,
    lock_master_references,
)
from nexa_bos_api.identity.org_service import (
    create_department,
    create_designation,
    create_office,
    create_team,
    list_departments,
    list_designations,
    list_eligible_team_leaders,
    list_offices,
    list_teams,
    load_team,
    rename_department,
    rename_designation,
    rename_office,
    rename_team,
    serialize_department,
    serialize_designation,
    serialize_office,
    serialize_team,
    set_department_status,
    set_designation_status,
    set_office_status,
    set_team_leader,
    set_team_status,
)
from nexa_bos_api.identity.permissions import (
    DEPARTMENTS_MANAGE,
    DESIGNATIONS_MANAGE,
    OFFICES_MANAGE,
    TEAMS_MANAGE,
    USERS_VIEW,
)
from nexa_bos_api.identity.schemas import (
    BusinessUnitCreateRequest,
    BusinessUnitUpdateRequest,
    DepartmentCreateRequest,
    MasterCreateRequest,
    MasterDeleteRequest,
    MasterNameUpdateRequest,
    TeamCreateRequest,
    TeamLeaderRequest,
    TeamUpdateRequest,
)

router = APIRouter(tags=["organization"])


def _include_inactive(actor, permission: str, requested: bool) -> bool:
    return requested and has_permission(actor, permission)


@router.get("/organization/hierarchy")
async def hierarchy(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_VIEW))],
    office_id: Annotated[UUID | None, Query(alias="officeId")] = None,
    department_id: Annotated[UUID | None, Query(alias="departmentId")] = None,
    business_unit_id: Annotated[UUID | None, Query(alias="businessUnitId")] = None,
    team_id: Annotated[UUID | None, Query(alias="teamId")] = None,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
    q: Annotated[str | None, Query(max_length=100)] = None,
    selected_user_id: Annotated[UUID | None, Query(alias="selectedUserId")] = None,
) -> dict[str, object]:
    return await organization_hierarchy(
        session,
        actor,
        office_id=office_id,
        department_id=department_id,
        business_unit_id=business_unit_id,
        team_id=team_id,
        include_inactive=include_inactive,
        query=q,
        selected_user_id=selected_user_id,
    )


@router.get("/offices")
async def offices_list(
    session: SessionDep,
    actor: CurrentUser,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
) -> dict[str, object]:
    rows = await list_offices(
        session, include_inactive=_include_inactive(actor, OFFICES_MANAGE, include_inactive)
    )
    return {"items": [serialize_office(row) for row in rows]}


@router.post("/offices")
async def offices_create(
    payload: MasterCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(OFFICES_MANAGE))],
) -> dict[str, object]:
    row = await create_office(session, actor, payload.name, payload.code)
    return serialize_office(row)


@router.patch("/offices/{office_id}")
async def offices_rename(
    office_id: UUID,
    payload: MasterNameUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(OFFICES_MANAGE))],
) -> dict[str, object]:
    office = await session.get(Office, office_id)
    if office is None:
        raise AppError(status_code=404, code="OFFICE_NOT_FOUND", message="Office not found")
    row = await rename_office(session, actor, office, payload.name)
    return serialize_office(row)


@router.post("/offices/{office_id}/deactivate")
async def offices_deactivate(
    office_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(OFFICES_MANAGE))],
) -> dict[str, object]:
    office = await session.get(Office, office_id)
    if office is None:
        raise AppError(status_code=404, code="OFFICE_NOT_FOUND", message="Office not found")
    return serialize_office(await set_office_status(session, actor, office, MasterStatus.INACTIVE))


@router.post("/offices/{office_id}/activate")
async def offices_activate(
    office_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(OFFICES_MANAGE))],
) -> dict[str, object]:
    office = await session.get(Office, office_id)
    if office is None:
        raise AppError(status_code=404, code="OFFICE_NOT_FOUND", message="Office not found")
    return serialize_office(await set_office_status(session, actor, office, MasterStatus.ACTIVE))


@router.delete("/offices/{office_id}")
async def offices_delete(
    office_id: UUID, payload: MasterDeleteRequest, session: SessionDep, actor: CurrentUser
):
    return await delete_unused_master(
        session, actor, "office", office_id, payload.reason, payload.confirmation
    )


@router.get("/offices/{office_id}/deletion-preview")
async def offices_delete_preview(office_id: UUID, session: SessionDep, actor: CurrentUser):
    return await deletion_preview(session, actor, "office", office_id)


@router.get("/departments")
async def departments_list(
    session: SessionDep,
    actor: CurrentUser,
    office_id: Annotated[UUID | None, Query(alias="officeId")] = None,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
) -> dict[str, object]:
    rows = await list_departments(
        session,
        office_id=office_id,
        include_inactive=_include_inactive(actor, DEPARTMENTS_MANAGE, include_inactive),
    )
    return {"items": [serialize_department(row) for row in rows]}


@router.post("/departments")
async def departments_create(
    payload: DepartmentCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DEPARTMENTS_MANAGE))],
) -> dict[str, object]:
    row = await create_department(session, actor, payload.office_id, payload.name, payload.code)
    return serialize_department(row)


@router.patch("/departments/{department_id}")
async def departments_rename(
    department_id: UUID,
    payload: MasterNameUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DEPARTMENTS_MANAGE))],
) -> dict[str, object]:
    department = await session.get(Department, department_id)
    if department is None:
        raise AppError(status_code=404, code="DEPARTMENT_NOT_FOUND", message="Department not found")
    return serialize_department(await rename_department(session, actor, department, payload.name))


@router.post("/departments/{department_id}/deactivate")
async def departments_deactivate(
    department_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DEPARTMENTS_MANAGE))],
) -> dict[str, object]:
    department = await session.get(Department, department_id)
    if department is None:
        raise AppError(status_code=404, code="DEPARTMENT_NOT_FOUND", message="Department not found")
    return serialize_department(
        await set_department_status(session, actor, department, MasterStatus.INACTIVE)
    )


@router.post("/departments/{department_id}/activate")
async def departments_activate(
    department_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DEPARTMENTS_MANAGE))],
) -> dict[str, object]:
    department = await session.get(Department, department_id)
    if department is None:
        raise AppError(status_code=404, code="DEPARTMENT_NOT_FOUND", message="Department not found")
    return serialize_department(
        await set_department_status(session, actor, department, MasterStatus.ACTIVE)
    )


@router.delete("/departments/{department_id}")
async def departments_delete(
    department_id: UUID, payload: MasterDeleteRequest, session: SessionDep, actor: CurrentUser
):
    return await delete_unused_master(
        session, actor, "department", department_id, payload.reason, payload.confirmation
    )


@router.get("/departments/{department_id}/deletion-preview")
async def departments_delete_preview(department_id: UUID, session: SessionDep, actor: CurrentUser):
    return await deletion_preview(session, actor, "department", department_id)


@router.get("/designations")
async def designations_list(
    session: SessionDep,
    actor: CurrentUser,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
) -> dict[str, object]:
    rows = await list_designations(
        session, include_inactive=_include_inactive(actor, DESIGNATIONS_MANAGE, include_inactive)
    )
    return {"items": [serialize_designation(row) for row in rows]}


@router.post("/designations")
async def designations_create(
    payload: MasterCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DESIGNATIONS_MANAGE))],
) -> dict[str, object]:
    row = await create_designation(session, actor, payload.name, payload.code)
    return serialize_designation(row)


@router.patch("/designations/{designation_id}")
async def designations_rename(
    designation_id: UUID,
    payload: MasterNameUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DESIGNATIONS_MANAGE))],
) -> dict[str, object]:
    designation = await session.get(Designation, designation_id)
    if designation is None:
        raise AppError(
            status_code=404, code="DESIGNATION_NOT_FOUND", message="Designation not found"
        )
    return serialize_designation(
        await rename_designation(session, actor, designation, payload.name)
    )


@router.post("/designations/{designation_id}/deactivate")
async def designations_deactivate(
    designation_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DESIGNATIONS_MANAGE))],
) -> dict[str, object]:
    designation = await session.get(Designation, designation_id)
    if designation is None:
        raise AppError(
            status_code=404, code="DESIGNATION_NOT_FOUND", message="Designation not found"
        )
    return serialize_designation(
        await set_designation_status(session, actor, designation, MasterStatus.INACTIVE)
    )


@router.post("/designations/{designation_id}/activate")
async def designations_activate(
    designation_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DESIGNATIONS_MANAGE))],
) -> dict[str, object]:
    designation = await session.get(Designation, designation_id)
    if designation is None:
        raise AppError(
            status_code=404, code="DESIGNATION_NOT_FOUND", message="Designation not found"
        )
    return serialize_designation(
        await set_designation_status(session, actor, designation, MasterStatus.ACTIVE)
    )


@router.delete("/designations/{designation_id}")
async def designations_delete(
    designation_id: UUID, payload: MasterDeleteRequest, session: SessionDep, actor: CurrentUser
):
    return await delete_unused_master(
        session, actor, "designation", designation_id, payload.reason, payload.confirmation
    )


@router.get("/designations/{designation_id}/deletion-preview")
async def designations_delete_preview(
    designation_id: UUID, session: SessionDep, actor: CurrentUser
):
    return await deletion_preview(session, actor, "designation", designation_id)


@router.get("/teams")
async def teams_list(
    session: SessionDep,
    actor: CurrentUser,
    office_id: Annotated[UUID | None, Query(alias="officeId")] = None,
    department_id: Annotated[UUID | None, Query(alias="departmentId")] = None,
    business_unit_id: Annotated[UUID | None, Query(alias="businessUnitId")] = None,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
) -> dict[str, object]:
    rows = await list_teams(
        session,
        office_id=office_id,
        department_id=department_id,
        business_unit_id=business_unit_id,
        include_inactive=_include_inactive(actor, TEAMS_MANAGE, include_inactive),
    )
    return {"items": [serialize_team(row) for row in rows]}


@router.post("/teams")
async def teams_create(
    payload: TeamCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TEAMS_MANAGE))],
) -> dict[str, object]:
    row = await create_team(
        session,
        actor,
        payload.office_id,
        payload.department_id,
        payload.name,
        payload.code,
        payload.business_unit_id,
    )
    return serialize_team(row)


@router.patch("/teams/{team_id}")
async def teams_rename(
    team_id: UUID,
    payload: TeamUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TEAMS_MANAGE))],
) -> dict[str, object]:
    team = await load_team(session, team_id)
    if (
        "business_unit_id" in payload.model_fields_set
        and payload.business_unit_id != team.business_unit_id
    ):
        if payload.business_unit_id is None:
            raise AppError(
                status_code=422, code="BUSINESS_UNIT_REQUIRED", message="Select a Business Unit"
            )
        await validate_business_unit(
            session, payload.business_unit_id, team.office_id, team.department_id
        )
        if team.business_unit_id is not None:
            try:
                await lock_master_references(session, "team", team.id)
            except DBAPIError as exc:
                await session.rollback()
                raise AppError(
                    status_code=409,
                    code="MASTER_CHANGE_CONFLICT",
                    message="Concurrent activity prevented this change",
                ) from exc
            used = team.team_leader_id is not None
            for _, query in _reference_queries("team", team.id):
                used = bool(await session.scalar(query)) or used
            if used:
                raise AppError(
                    status_code=409,
                    code="TEAM_BUSINESS_UNIT_LOCKED",
                    message="A used Team cannot be moved to another Business Unit",
                )
        from nexa_bos_api.identity.audit import record_audit

        await record_audit(
            session,
            action="team.business_unit",
            entity_type="team",
            entity_id=str(team.id),
            actor_id=actor.id,
            new_values={"businessUnitId": str(payload.business_unit_id)},
        )
        team.business_unit_id = payload.business_unit_id
    updated = await rename_team(session, actor, team, payload.name)
    await session.commit()
    return serialize_team(updated)


@router.get("/teams/{team_id}/eligible-leaders")
async def teams_eligible_leaders(
    team_id: UUID,
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(TEAMS_MANAGE))],
) -> dict[str, object]:
    team = await load_team(session, team_id)
    users = await list_eligible_team_leaders(session, team)
    return {
        "items": [
            {
                "id": str(user.id),
                "userCode": user.user_code,
                "fullName": user.full_name,
            }
            for user in users
        ]
    }


@router.put("/teams/{team_id}/leader")
async def teams_leader(
    team_id: UUID,
    payload: TeamLeaderRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TEAMS_MANAGE))],
) -> dict[str, object]:
    team = await load_team(session, team_id)
    return serialize_team(await set_team_leader(session, actor, team, payload.user_id))


@router.post("/teams/{team_id}/deactivate")
async def teams_deactivate(
    team_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TEAMS_MANAGE))],
) -> dict[str, object]:
    team = await load_team(session, team_id)
    return serialize_team(await set_team_status(session, actor, team, MasterStatus.INACTIVE))


@router.post("/teams/{team_id}/activate")
async def teams_activate(
    team_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TEAMS_MANAGE))],
) -> dict[str, object]:
    team = await load_team(session, team_id)
    return serialize_team(await set_team_status(session, actor, team, MasterStatus.ACTIVE))


@router.delete("/teams/{team_id}")
async def teams_delete(
    team_id: UUID, payload: MasterDeleteRequest, session: SessionDep, actor: CurrentUser
):
    return await delete_unused_master(
        session, actor, "team", team_id, payload.reason, payload.confirmation
    )


@router.get("/teams/{team_id}/deletion-preview")
async def teams_delete_preview(team_id: UUID, session: SessionDep, actor: CurrentUser):
    return await deletion_preview(session, actor, "team", team_id)


@router.get("/business-units")
async def business_units_list(
    session: SessionDep,
    actor: CurrentUser,
    office_id: Annotated[UUID | None, Query(alias="officeId")] = None,
    department_id: Annotated[UUID | None, Query(alias="departmentId")] = None,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
):
    query = select(BusinessUnit).order_by(BusinessUnit.code)
    if office_id:
        query = query.where(BusinessUnit.office_id == office_id)
    if department_id:
        query = query.where(BusinessUnit.department_id == department_id)
    if not _include_inactive(actor, DEPARTMENTS_MANAGE, include_inactive):
        query = query.where(BusinessUnit.status == MasterStatus.ACTIVE)
    return {"items": [serialize_business_unit(row) for row in await session.scalars(query)]}


@router.post("/business-units")
async def business_units_create(
    payload: BusinessUnitCreateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DEPARTMENTS_MANAGE))],
):
    return await save_business_unit(session, actor, **payload.model_dump())


@router.patch("/business-units/{unit_id}")
async def business_units_update(
    unit_id: UUID,
    payload: BusinessUnitUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DEPARTMENTS_MANAGE))],
):
    return await save_business_unit(session, actor, unit_id=unit_id, **payload.model_dump())


@router.post("/business-units/{unit_id}/activate")
async def business_units_activate(
    unit_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DEPARTMENTS_MANAGE))],
):
    return await business_unit_status(session, actor, unit_id, MasterStatus.ACTIVE)


@router.post("/business-units/{unit_id}/deactivate")
async def business_units_deactivate(
    unit_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(DEPARTMENTS_MANAGE))],
):
    return await business_unit_status(session, actor, unit_id, MasterStatus.INACTIVE)


@router.get("/business-units/{unit_id}/deletion-preview")
async def business_units_delete_preview(unit_id: UUID, session: SessionDep, actor: CurrentUser):
    return await deletion_preview(session, actor, "business_unit", unit_id)


@router.delete("/business-units/{unit_id}")
async def business_units_delete(
    unit_id: UUID, payload: MasterDeleteRequest, session: SessionDep, actor: CurrentUser
):
    return await delete_unused_master(
        session, actor, "business_unit", unit_id, payload.reason, payload.confirmation
    )
