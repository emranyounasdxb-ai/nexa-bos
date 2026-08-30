from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import visibility_scope, visible_user_ids
from nexa_bos_api.identity.enums import EmploymentStatus, MasterStatus, VisibilityScope
from nexa_bos_api.identity.models import Department, Office, Team, User

CURRENT_EMPLOYMENT_STATUSES = {
    EmploymentStatus.ACTIVE.value,
    EmploymentStatus.PROBATION.value,
    EmploymentStatus.NOTICE_PERIOD.value,
}


def _ref(row: Office | Department | Team | None) -> dict[str, str] | None:
    if row is None:
        return None
    return {"id": str(row.id), "code": row.code, "name": row.name}


def _master_ref(row: Office | Department | Team) -> dict[str, str]:
    result = {"id": str(row.id), "code": row.code, "name": row.name}
    if isinstance(row, Department):
        result["officeId"] = str(row.office_id)
    if isinstance(row, Team):
        result["officeId"] = str(row.office_id)
        result["departmentId"] = str(row.department_id)
    return result


def _filter_not_found() -> AppError:
    return AppError(
        status_code=404,
        code="HIERARCHY_FILTER_NOT_FOUND",
        message="Hierarchy filter is not available",
    )


def _employee_not_found() -> AppError:
    return AppError(
        status_code=404,
        code="HIERARCHY_EMPLOYEE_NOT_FOUND",
        message="Hierarchy employee was not found",
    )


def _safe_parent_map(users: dict[UUID, User], included: set[UUID]) -> dict[UUID, UUID | None]:
    parents = {
        user_id: user.reporting_manager_id if user.reporting_manager_id in included else None
        for user_id, user in users.items()
        if user_id in included
    }
    while True:
        broken = False
        for start in sorted(parents, key=str):
            path: list[UUID] = []
            positions: dict[UUID, int] = {}
            current: UUID | None = start
            while current is not None and current in parents:
                if current in positions:
                    cycle = path[positions[current] :]
                    parents[min(cycle, key=str)] = None
                    broken = True
                    break
                positions[current] = len(path)
                path.append(current)
                current = parents[current]
            if broken:
                break
        if not broken:
            return parents


async def _filter_options(
    session: AsyncSession,
    actor: User,
    visible_users: list[User],
    *,
    office_id: UUID | None,
    department_id: UUID | None,
) -> tuple[list[Office], list[Department], list[Team]]:
    scope = visibility_scope(actor)
    visible_office_ids = {user.office_id for user in visible_users if user.office_id is not None}
    visible_department_ids = {
        user.department_id for user in visible_users if user.department_id is not None
    }
    visible_team_ids = {user.team_id for user in visible_users if user.team_id is not None}

    office_stmt = select(Office).where(Office.status == MasterStatus.ACTIVE).order_by(Office.name)
    if scope is not VisibilityScope.COMPANY:
        office_stmt = office_stmt.where(Office.id.in_(visible_office_ids))
    offices = list((await session.execute(office_stmt)).scalars())
    office_options = {row.id for row in offices}
    if office_id is not None and office_id not in office_options:
        raise _filter_not_found()

    department_stmt = (
        select(Department).where(Department.status == MasterStatus.ACTIVE).order_by(Department.name)
    )
    if scope is not VisibilityScope.COMPANY:
        department_stmt = department_stmt.where(Department.id.in_(visible_department_ids))
    if office_id is not None:
        department_stmt = department_stmt.where(Department.office_id == office_id)
    departments = list((await session.execute(department_stmt)).scalars())
    department_options = {row.id for row in departments}
    if department_id is not None and department_id not in department_options:
        raise _filter_not_found()

    team_stmt = select(Team).where(Team.status == MasterStatus.ACTIVE).order_by(Team.name)
    if scope is not VisibilityScope.COMPANY:
        team_stmt = team_stmt.where(Team.id.in_(visible_team_ids))
    if office_id is not None:
        team_stmt = team_stmt.where(Team.office_id == office_id)
    if department_id is not None:
        team_stmt = team_stmt.where(Team.department_id == department_id)
    teams = list((await session.execute(team_stmt)).scalars())
    return offices, departments, teams


def _node_payload(
    user: User,
    *,
    parent_id: UUID | None,
    direct_report_ids: list[UUID],
    context_only: bool,
) -> dict[str, Any]:
    user_type = None
    if user.user_type is not None:
        user_type = {
            "id": str(user.user_type.id),
            "code": user.user_type.code,
            "name": user.user_type.name,
        }
    return {
        "id": str(user.id),
        "employeeCode": user.employee_code,
        "fullName": user.full_name,
        "designation": _ref(user.designation),
        "userType": user_type,
        "office": _ref(user.office),
        "department": _ref(user.department),
        "team": _ref(user.team),
        "reportingManagerId": str(parent_id) if parent_id else None,
        "employmentStatus": user.employment_status,
        "directReportIds": [str(row) for row in direct_report_ids],
        "contextOnly": context_only,
    }


async def organization_hierarchy(
    session: AsyncSession,
    actor: User,
    *,
    office_id: UUID | None,
    department_id: UUID | None,
    team_id: UUID | None,
    include_inactive: bool,
    query: str | None,
    selected_user_id: UUID | None,
) -> dict[str, Any]:
    stmt = select(User).options(
        selectinload(User.user_type),
        selectinload(User.office),
        selectinload(User.department),
        selectinload(User.team),
        selectinload(User.designation),
    )
    allowed = await visible_user_ids(session, actor)
    if allowed is not None:
        stmt = stmt.where(User.id.in_(allowed))
    visible_users = list((await session.execute(stmt.order_by(User.employee_code))).scalars())
    users = {user.id: user for user in visible_users}

    offices, departments, teams = await _filter_options(
        session,
        actor,
        visible_users,
        office_id=office_id,
        department_id=department_id,
    )
    team_options = {row.id for row in teams}
    if team_id is not None and team_id not in team_options:
        raise _filter_not_found()

    candidates = [
        user
        for user in visible_users
        if (include_inactive or user.employment_status in CURRENT_EMPLOYMENT_STATUSES)
        and (office_id is None or user.office_id == office_id)
        and (department_id is None or user.department_id == department_id)
        and (team_id is None or user.team_id == team_id)
    ]
    base_ids = {user.id for user in candidates}

    included = set(base_ids)
    for user in candidates:
        current = user.reporting_manager_id
        visited = {user.id}
        while current is not None and current in users and current not in visited:
            included.add(current)
            visited.add(current)
            current = users[current].reporting_manager_id
    if selected_user_id is not None and selected_user_id not in included:
        raise _employee_not_found()

    parents = _safe_parent_map(users, included)
    children: dict[UUID, list[UUID]] = defaultdict(list)
    for child_id, parent_id in parents.items():
        if parent_id is not None:
            children[parent_id].append(child_id)
    for rows in children.values():
        rows.sort(key=lambda row: (users[row].employee_code, users[row].full_name.lower()))

    roots = sorted(
        (row for row, parent in parents.items() if parent is None),
        key=lambda row: (users[row].employee_code, users[row].full_name.lower()),
    )
    nodes = [
        _node_payload(
            users[user_id],
            parent_id=parents[user_id],
            direct_report_ids=children[user_id],
            context_only=user_id not in base_ids,
        )
        for user_id in sorted(
            included,
            key=lambda row: (users[row].employee_code, users[row].full_name.lower()),
        )
    ]

    upward_chain: list[str] = []
    direct_reports: list[str] = []
    if selected_user_id is not None:
        current: UUID | None = selected_user_id
        visited: set[UUID] = set()
        while current is not None and current not in visited:
            upward_chain.append(str(current))
            visited.add(current)
            current = parents.get(current)
        direct_reports = [str(row) for row in children[selected_user_id]]

    normalized_query = (query or "").strip().lower()
    search_results = []
    if normalized_query:
        matching = [
            user
            for user in candidates
            if normalized_query in user.employee_code.lower()
            or normalized_query in user.full_name.lower()
        ][:20]
        search_results = [
            {
                "id": str(user.id),
                "employeeCode": user.employee_code,
                "fullName": user.full_name,
            }
            for user in matching
        ]

    return {
        "scope": visibility_scope(actor).value,
        "includeInactive": include_inactive,
        "filters": {
            "offices": [_master_ref(row) for row in offices],
            "departments": [_master_ref(row) for row in departments],
            "teams": [_master_ref(row) for row in teams],
        },
        "nodes": nodes,
        "rootIds": [str(row) for row in roots],
        "searchResults": search_results,
        "selectedUserId": str(selected_user_id) if selected_user_id else None,
        "upwardChainIds": upward_chain,
        "directReportIds": direct_reports,
    }
