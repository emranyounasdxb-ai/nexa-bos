from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.enums import MasterStatus
from nexa_bos_api.identity.models import Department, Designation, Office
from nexa_bos_api.identity.org_service import (
    create_department,
    create_designation,
    create_office,
    create_team,
    delete_master_forbidden,
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
)
from nexa_bos_api.identity.schemas import (
    DepartmentCreateRequest,
    MasterCreateRequest,
    MasterNameUpdateRequest,
    TeamCreateRequest,
    TeamLeaderRequest,
)

router = APIRouter(tags=["organization"])


def _include_inactive(actor, permission: str, requested: bool) -> bool:
    return requested and has_permission(actor, permission)


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
async def offices_delete(office_id: UUID) -> None:
    delete_master_forbidden()


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
async def departments_delete(department_id: UUID) -> None:
    delete_master_forbidden()


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
async def designations_delete(designation_id: UUID) -> None:
    delete_master_forbidden()


@router.get("/teams")
async def teams_list(
    session: SessionDep,
    actor: CurrentUser,
    office_id: Annotated[UUID | None, Query(alias="officeId")] = None,
    department_id: Annotated[UUID | None, Query(alias="departmentId")] = None,
    include_inactive: Annotated[bool, Query(alias="includeInactive")] = False,
) -> dict[str, object]:
    rows = await list_teams(
        session,
        office_id=office_id,
        department_id=department_id,
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
        session, actor, payload.office_id, payload.department_id, payload.name, payload.code
    )
    return serialize_team(row)


@router.patch("/teams/{team_id}")
async def teams_rename(
    team_id: UUID,
    payload: MasterNameUpdateRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(TEAMS_MANAGE))],
) -> dict[str, object]:
    team = await load_team(session, team_id)
    return serialize_team(await rename_team(session, actor, team, payload.name))


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
async def teams_delete(team_id: UUID) -> None:
    delete_master_forbidden()
