from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import is_owner, load_user_with_type, user_load_options
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus, MasterStatus
from nexa_bos_api.identity.models import (
    Department,
    DepartmentNameHistory,
    Designation,
    DesignationNameHistory,
    Office,
    OfficeNameHistory,
    Team,
    TeamLeaderHistory,
    TeamNameHistory,
    User,
    UserType,
    new_uuid,
)


def utcnow() -> datetime:
    return datetime.now(UTC)


def serialize_office(office: Office) -> dict[str, object]:
    return {
        "id": str(office.id),
        "code": office.code,
        "name": office.name,
        "status": office.status,
        "createdAt": office.created_at.isoformat(),
        "updatedAt": office.updated_at.isoformat(),
    }


def serialize_department(department: Department) -> dict[str, object]:
    return {
        "id": str(department.id),
        "code": department.code,
        "name": department.name,
        "status": department.status,
        "officeId": str(department.office_id),
        "office": serialize_office(department.office) if department.office else None,
        "createdAt": department.created_at.isoformat(),
        "updatedAt": department.updated_at.isoformat(),
    }


def serialize_designation(designation: Designation) -> dict[str, object]:
    return {
        "id": str(designation.id),
        "code": designation.code,
        "name": designation.name,
        "status": designation.status,
        "createdAt": designation.created_at.isoformat(),
        "updatedAt": designation.updated_at.isoformat(),
    }


def serialize_team(team: Team) -> dict[str, object]:
    return {
        "id": str(team.id),
        "code": team.code,
        "name": team.name,
        "status": team.status,
        "officeId": str(team.office_id),
        "departmentId": str(team.department_id),
        "office": serialize_office(team.office) if team.office else None,
        "department": serialize_department(team.department) if team.department else None,
        "teamLeaderId": str(team.team_leader_id) if team.team_leader_id else None,
        "createdAt": team.created_at.isoformat(),
        "updatedAt": team.updated_at.isoformat(),
    }


async def _unique_code(session: AsyncSession, model, code: str, entity: str) -> str:
    normalized = code.strip().upper()
    existing = (
        await session.execute(select(model).where(model.code == normalized))
    ).scalar_one_or_none()
    if existing:
        raise AppError(
            status_code=409,
            code=f"{entity.upper()}_CODE_DUPLICATE",
            message=f"{entity} code must be unique and is immutable",
        )
    return normalized


async def list_offices(session: AsyncSession, *, include_inactive: bool) -> list[Office]:
    stmt = select(Office).order_by(Office.code)
    if not include_inactive:
        stmt = stmt.where(Office.status == MasterStatus.ACTIVE)
    return list((await session.execute(stmt)).scalars().all())


async def create_office(session: AsyncSession, actor: User, name: str, code: str) -> Office:
    now = utcnow()
    office = Office(
        id=new_uuid(),
        code=await _unique_code(session, Office, code, "office"),
        name=name.strip(),
        status=MasterStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    session.add(office)
    await session.flush()
    session.add(
        OfficeNameHistory(
            office_id=office.id, name=office.name, effective_from=now, effective_to=None
        )
    )
    await record_audit(
        session,
        action="office.create",
        entity_type="office",
        entity_id=str(office.id),
        actor_id=actor.id,
        new_values={"code": office.code, "name": office.name},
    )
    await session.commit()
    return (await session.get(Office, office.id)) or office


async def rename_office(session: AsyncSession, actor: User, office: Office, name: str) -> Office:
    now = utcnow()
    old = office.name
    new_name = name.strip()
    if new_name != old:
        current = (
            await session.execute(
                select(OfficeNameHistory).where(
                    OfficeNameHistory.office_id == office.id,
                    OfficeNameHistory.effective_to.is_(None),
                )
            )
        ).scalar_one_or_none()
        if current:
            current.effective_to = now
        session.add(
            OfficeNameHistory(
                office_id=office.id, name=new_name, effective_from=now, effective_to=None
            )
        )
        office.name = new_name
        office.updated_at = now
        await record_audit(
            session,
            action="office.rename",
            entity_type="office",
            entity_id=str(office.id),
            actor_id=actor.id,
            old_values={"name": old},
            new_values={"name": new_name},
        )
        await session.commit()
    return office


async def list_departments(
    session: AsyncSession, *, office_id: UUID | None, include_inactive: bool
) -> list[Department]:
    stmt = select(Department).options(selectinload(Department.office)).order_by(Department.code)
    if office_id:
        stmt = stmt.where(Department.office_id == office_id)
    if not include_inactive:
        stmt = stmt.where(Department.status == MasterStatus.ACTIVE)
    return list((await session.execute(stmt)).scalars().unique().all())


async def create_department(
    session: AsyncSession, actor: User, office_id: UUID, name: str, code: str
) -> Department:
    office = await session.get(Office, office_id)
    if office is None:
        raise AppError(status_code=404, code="OFFICE_NOT_FOUND", message="Office not found")
    now = utcnow()
    department = Department(
        id=new_uuid(),
        office_id=office.id,
        code=await _unique_code(session, Department, code, "department"),
        name=name.strip(),
        status=MasterStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    session.add(department)
    await session.flush()
    session.add(
        DepartmentNameHistory(
            department_id=department.id, name=department.name, effective_from=now, effective_to=None
        )
    )
    await record_audit(
        session,
        action="department.create",
        entity_type="department",
        entity_id=str(department.id),
        actor_id=actor.id,
        new_values={"code": department.code, "name": department.name, "officeId": str(office.id)},
    )
    await session.commit()
    return (
        await session.execute(
            select(Department)
            .options(selectinload(Department.office))
            .where(Department.id == department.id)
        )
    ).scalar_one()


async def rename_department(
    session: AsyncSession, actor: User, department: Department, name: str
) -> Department:
    now = utcnow()
    old = department.name
    new_name = name.strip()
    if new_name != old:
        current = (
            await session.execute(
                select(DepartmentNameHistory).where(
                    DepartmentNameHistory.department_id == department.id,
                    DepartmentNameHistory.effective_to.is_(None),
                )
            )
        ).scalar_one_or_none()
        if current:
            current.effective_to = now
        session.add(
            DepartmentNameHistory(
                department_id=department.id, name=new_name, effective_from=now, effective_to=None
            )
        )
        department.name = new_name
        department.updated_at = now
        await record_audit(
            session,
            action="department.rename",
            entity_type="department",
            entity_id=str(department.id),
            actor_id=actor.id,
            old_values={"name": old},
            new_values={"name": new_name},
        )
        await session.commit()
    return (
        await session.execute(
            select(Department)
            .options(selectinload(Department.office))
            .where(Department.id == department.id)
        )
    ).scalar_one()


async def list_designations(session: AsyncSession, *, include_inactive: bool) -> list[Designation]:
    stmt = select(Designation).order_by(Designation.code)
    if not include_inactive:
        stmt = stmt.where(Designation.status == MasterStatus.ACTIVE)
    return list((await session.execute(stmt)).scalars().all())


async def create_designation(
    session: AsyncSession, actor: User | None, name: str, code: str, *, commit: bool = True
) -> Designation:
    now = utcnow()
    designation = Designation(
        id=new_uuid(),
        code=await _unique_code(session, Designation, code, "designation"),
        name=name.strip(),
        status=MasterStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    session.add(designation)
    await session.flush()
    session.add(
        DesignationNameHistory(
            designation_id=designation.id,
            name=designation.name,
            effective_from=now,
            effective_to=None,
        )
    )
    await record_audit(
        session,
        action="designation.create",
        entity_type="designation",
        entity_id=str(designation.id),
        actor_id=actor.id if actor else None,
        new_values={"code": designation.code, "name": designation.name},
    )
    if commit:
        await session.commit()
    return designation


async def rename_designation(
    session: AsyncSession, actor: User, designation: Designation, name: str
) -> Designation:
    now = utcnow()
    old = designation.name
    new_name = name.strip()
    if new_name != old:
        current = (
            await session.execute(
                select(DesignationNameHistory).where(
                    DesignationNameHistory.designation_id == designation.id,
                    DesignationNameHistory.effective_to.is_(None),
                )
            )
        ).scalar_one_or_none()
        if current:
            current.effective_to = now
        session.add(
            DesignationNameHistory(
                designation_id=designation.id, name=new_name, effective_from=now, effective_to=None
            )
        )
        designation.name = new_name
        designation.updated_at = now
        await record_audit(
            session,
            action="designation.rename",
            entity_type="designation",
            entity_id=str(designation.id),
            actor_id=actor.id,
            old_values={"name": old},
            new_values={"name": new_name},
        )
        await session.commit()
    return designation


async def list_teams(
    session: AsyncSession,
    *,
    office_id: UUID | None,
    department_id: UUID | None,
    include_inactive: bool,
) -> list[Team]:
    stmt = (
        select(Team)
        .options(
            selectinload(Team.office),
            selectinload(Team.department).selectinload(Department.office),
        )
        .order_by(Team.code)
    )
    if office_id:
        stmt = stmt.where(Team.office_id == office_id)
    if department_id:
        stmt = stmt.where(Team.department_id == department_id)
    if not include_inactive:
        stmt = stmt.where(Team.status == MasterStatus.ACTIVE)
    return list((await session.execute(stmt)).scalars().unique().all())


async def load_team(session: AsyncSession, team_id: UUID) -> Team:
    row = (
        await session.execute(
            select(Team)
            .options(
                selectinload(Team.office),
                selectinload(Team.department).selectinload(Department.office),
            )
            .where(Team.id == team_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError(status_code=404, code="TEAM_NOT_FOUND", message="Team not found")
    return row


async def create_team(
    session: AsyncSession, actor: User, office_id: UUID, department_id: UUID, name: str, code: str
) -> Team:
    office = await session.get(Office, office_id)
    department = await session.get(Department, department_id)
    if office is None:
        raise AppError(status_code=404, code="OFFICE_NOT_FOUND", message="Office not found")
    if department is None:
        raise AppError(status_code=404, code="DEPARTMENT_NOT_FOUND", message="Department not found")
    if department.office_id != office.id:
        raise AppError(
            status_code=422,
            code="TEAM_ORG_MISMATCH",
            message="Team department must belong to the selected office",
        )
    now = utcnow()
    team = Team(
        id=new_uuid(),
        office_id=office.id,
        department_id=department.id,
        code=await _unique_code(session, Team, code, "team"),
        name=name.strip(),
        status=MasterStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    session.add(team)
    await session.flush()
    session.add(
        TeamNameHistory(team_id=team.id, name=team.name, effective_from=now, effective_to=None)
    )
    await record_audit(
        session,
        action="team.create",
        entity_type="team",
        entity_id=str(team.id),
        actor_id=actor.id,
        new_values={"code": team.code, "name": team.name},
    )
    await session.commit()
    return await load_team(session, team.id)


async def rename_team(session: AsyncSession, actor: User, team: Team, name: str) -> Team:
    now = utcnow()
    old = team.name
    new_name = name.strip()
    if new_name != old:
        current = (
            await session.execute(
                select(TeamNameHistory).where(
                    TeamNameHistory.team_id == team.id,
                    TeamNameHistory.effective_to.is_(None),
                )
            )
        ).scalar_one_or_none()
        if current:
            current.effective_to = now
        session.add(
            TeamNameHistory(team_id=team.id, name=new_name, effective_from=now, effective_to=None)
        )
        team.name = new_name
        team.updated_at = now
        await record_audit(
            session,
            action="team.rename",
            entity_type="team",
            entity_id=str(team.id),
            actor_id=actor.id,
            old_values={"name": old},
            new_values={"name": new_name},
        )
        await session.commit()
    return await load_team(session, team.id)


async def assert_tl_eligible(session: AsyncSession, team: Team, user: User) -> None:
    loaded = await load_user_with_type(session, user.id)
    if loaded is None:
        raise AppError(status_code=404, code="USER_NOT_FOUND", message="User not found")
    if loaded.account_status != AccountStatus.ACTIVE:
        raise AppError(status_code=422, code="TL_INACTIVE", message="Team leader must be active")
    if loaded.user_type is None or loaded.user_type.code != "TL":
        raise AppError(
            status_code=422,
            code="TL_TYPE_REQUIRED",
            message="Team leader must have User Type TL",
        )
    if (
        loaded.office_id != team.office_id
        or loaded.department_id != team.department_id
        or loaded.team_id != team.id
    ):
        raise AppError(
            status_code=422,
            code="TL_ORG_MISMATCH",
            message="Team leader must belong to the same office, department, and team",
        )


async def list_eligible_team_leaders(session: AsyncSession, team: Team) -> list[User]:
    stmt = (
        select(User)
        .options(*user_load_options())
        .join(UserType, User.user_type_id == UserType.id)
        .where(
            User.account_status == AccountStatus.ACTIVE,
            UserType.code == "TL",
            User.office_id == team.office_id,
            User.department_id == team.department_id,
            User.team_id == team.id,
        )
        .order_by(User.user_code)
    )
    return list((await session.execute(stmt)).scalars().unique().all())


async def set_team_leader(
    session: AsyncSession,
    actor: User | None,
    team: Team,
    user_id: UUID | None,
    *,
    commit: bool = True,
) -> Team:
    now = utcnow()
    old = str(team.team_leader_id) if team.team_leader_id else None
    if user_id is not None:
        user = await session.get(User, user_id)
        if user is None:
            raise AppError(status_code=404, code="USER_NOT_FOUND", message="User not found")
        await assert_tl_eligible(session, team, user)
    current = (
        await session.execute(
            select(TeamLeaderHistory).where(
                TeamLeaderHistory.team_id == team.id,
                TeamLeaderHistory.effective_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if current:
        current.effective_to = now
    if user_id is not None:
        session.add(
            TeamLeaderHistory(
                team_id=team.id,
                user_id=user_id,
                effective_from=now,
                effective_to=None,
            )
        )
    team.team_leader_id = user_id
    team.updated_at = now
    await record_audit(
        session,
        action="team.leader",
        entity_type="team",
        entity_id=str(team.id),
        actor_id=actor.id if actor else None,
        old_values={"teamLeaderId": old},
        new_values={"teamLeaderId": str(user_id) if user_id else None},
    )
    if commit:
        await session.commit()
    return await load_team(session, team.id)


async def clear_team_leadership_for_user(
    session: AsyncSession, user_id: UUID, *, commit: bool = False
) -> None:
    teams = list(
        (await session.execute(select(Team).where(Team.team_leader_id == user_id))).scalars()
    )
    for team in teams:
        await set_team_leader(session, None, team, None, commit=False)
    if commit:
        await session.commit()


async def _active_user_count(session: AsyncSession, **filters: object) -> int:
    stmt = select(func.count()).select_from(User).where(User.account_status == AccountStatus.ACTIVE)
    for column, value in filters.items():
        stmt = stmt.where(getattr(User, column) == value)
    return int((await session.execute(stmt)).scalar_one())


async def set_office_status(
    session: AsyncSession, actor: User, office: Office, status: MasterStatus
) -> Office:
    if status == MasterStatus.INACTIVE:
        users = await _active_user_count(session, office_id=office.id)
        departments = int(
            (
                await session.execute(
                    select(func.count())
                    .select_from(Department)
                    .where(
                        Department.office_id == office.id,
                        Department.status == MasterStatus.ACTIVE,
                    )
                )
            ).scalar_one()
        )
        teams = int(
            (
                await session.execute(
                    select(func.count())
                    .select_from(Team)
                    .where(Team.office_id == office.id, Team.status == MasterStatus.ACTIVE)
                )
            ).scalar_one()
        )
        if users or departments or teams:
            raise AppError(
                status_code=422,
                code="MASTER_IN_USE",
                message=(
                    "Office cannot be deactivated while active departments, teams, or users exist"
                ),
            )
    office.status = status
    office.updated_at = utcnow()
    await record_audit(
        session,
        action="office.status",
        entity_type="office",
        entity_id=str(office.id),
        actor_id=actor.id,
        new_values={"status": status},
    )
    await session.commit()
    return office


async def set_department_status(
    session: AsyncSession, actor: User, department: Department, status: MasterStatus
) -> Department:
    if status == MasterStatus.INACTIVE:
        users = await _active_user_count(session, department_id=department.id)
        teams = int(
            (
                await session.execute(
                    select(func.count())
                    .select_from(Team)
                    .where(
                        Team.department_id == department.id,
                        Team.status == MasterStatus.ACTIVE,
                    )
                )
            ).scalar_one()
        )
        if users or teams:
            raise AppError(
                status_code=422,
                code="MASTER_IN_USE",
                message="Department cannot be deactivated while active users or teams exist",
            )
    department.status = status
    department.updated_at = utcnow()
    await record_audit(
        session,
        action="department.status",
        entity_type="department",
        entity_id=str(department.id),
        actor_id=actor.id,
        new_values={"status": status},
    )
    await session.commit()
    return (
        await session.execute(
            select(Department)
            .options(selectinload(Department.office))
            .where(Department.id == department.id)
        )
    ).scalar_one()


async def set_designation_status(
    session: AsyncSession, actor: User, designation: Designation, status: MasterStatus
) -> Designation:
    if status == MasterStatus.INACTIVE:
        users = await _active_user_count(session, designation_id=designation.id)
        if users:
            raise AppError(
                status_code=422,
                code="MASTER_IN_USE",
                message="Designation cannot be deactivated while active users exist",
            )
    designation.status = status
    designation.updated_at = utcnow()
    await record_audit(
        session,
        action="designation.status",
        entity_type="designation",
        entity_id=str(designation.id),
        actor_id=actor.id,
        new_values={"status": status},
    )
    await session.commit()
    return designation


async def set_team_status(
    session: AsyncSession, actor: User, team: Team, status: MasterStatus
) -> Team:
    if status == MasterStatus.INACTIVE:
        users = await _active_user_count(session, team_id=team.id)
        if users or team.team_leader_id is not None:
            raise AppError(
                status_code=422,
                code="MASTER_IN_USE",
                message=(
                    "Team cannot be deactivated while active users or a team leader are assigned"
                ),
            )
    team.status = status
    team.updated_at = utcnow()
    await record_audit(
        session,
        action="team.status",
        entity_type="team",
        entity_id=str(team.id),
        actor_id=actor.id,
        new_values={"status": status},
    )
    await session.commit()
    return await load_team(session, team.id)


def delete_master_forbidden() -> None:
    raise AppError(
        status_code=405,
        code="MASTER_DELETE_FORBIDDEN",
        message="Organization masters cannot be deleted",
    )


async def require_not_owner_manager(user: User) -> None:
    if is_owner(user):
        raise AppError(
            status_code=422,
            code="OWNER_NO_MANAGER",
            message="OWNER cannot have a reporting manager",
        )
