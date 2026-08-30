from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.core.config import get_settings
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import (
    can_view_user,
    descendant_ids,
    is_owner,
    user_load_options,
    visible_user_ids,
)
from nexa_bos_api.identity.assignments import record_assignment
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.auth_service import public_user, terminate_sessions
from nexa_bos_api.identity.enums import (
    AUTO_DEACTIVATE_EMPLOYMENT,
    OWNER_FORBIDDEN_EMPLOYMENT,
    REQUIRE_LAST_WORKING,
    AccountStatus,
    AssignmentField,
    EmploymentStatus,
    MasterStatus,
)
from nexa_bos_api.identity.models import (
    AuditEvent,
    Department,
    Designation,
    EmploymentPeriod,
    Office,
    ReservedEmail,
    ReservedEmployeeCode,
    Team,
    User,
    UserAssignmentHistory,
    UserCodeCounter,
    UserEmailHistory,
    UserType,
    new_uuid,
)
from nexa_bos_api.identity.org_service import clear_team_leadership_for_user
from nexa_bos_api.identity.schemas import RehireRequest, UserCreateRequest, UserUpdateRequest

REPORTING_HIERARCHY_LOCK_KEY = 0x4E45584148494552  # ASCII: NEXAHIER


def utcnow() -> datetime:
    return datetime.now(UTC)


def storage_dir() -> Path:
    path = Path(get_settings().file_storage_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


async def next_user_code(session: AsyncSession) -> str:
    counter = await session.get(UserCodeCounter, 1, with_for_update=True)
    if counter is None:
        counter = UserCodeCounter(id=1, last_value=0)
        session.add(counter)
        await session.flush()
        counter = await session.get(UserCodeCounter, 1, with_for_update=True)
        assert counter is not None
    counter.last_value += 1
    return f"USR-{counter.last_value:06d}"


def identity_unique_conflict(exc: IntegrityError) -> AppError:
    constraint = ""
    orig = getattr(exc, "orig", None)
    if orig is not None:
        diag = getattr(orig, "diag", None)
        if diag is not None:
            constraint = (getattr(diag, "constraint_name", None) or "").lower()
        blob = f"{constraint} {orig}".lower()
    else:
        blob = str(exc).lower()
    if "employee_code" in blob or "employee code" in blob:
        return AppError(
            status_code=409,
            code="EMPLOYEE_CODE_DUPLICATE",
            message="Employee code is already used, including historical values",
        )
    return AppError(
        status_code=409,
        code="EMAIL_DUPLICATE",
        message="Email is already used, including historical values",
    )


def _conflict_details(user: User) -> list[object]:
    return [
        {
            "userCode": user.user_code,
            "fullName": user.full_name,
            "email": user.email,
            "employeeCode": user.employee_code,
            "id": str(user.id),
        }
    ]


async def find_email_owner(
    session: AsyncSession, email: str, *, ignore_user_id: UUID | None = None
) -> User | None:
    normalized = email.lower()
    stmt = select(User).where(func.lower(User.email) == normalized)
    if ignore_user_id:
        stmt = stmt.where(User.id != ignore_user_id)
    current = (await session.execute(stmt)).scalar_one_or_none()
    if current:
        return current
    history_stmt = (
        select(User)
        .join(UserEmailHistory, UserEmailHistory.user_id == User.id)
        .where(func.lower(UserEmailHistory.email) == normalized)
    )
    if ignore_user_id:
        history_stmt = history_stmt.where(User.id != ignore_user_id)
    return (await session.execute(history_stmt)).scalar_one_or_none()


async def find_employee_code_owner(
    session: AsyncSession, employee_code: str, *, ignore_user_id: UUID | None = None
) -> User | None:
    stmt = select(User).where(User.employee_code == employee_code)
    if ignore_user_id:
        stmt = stmt.where(User.id != ignore_user_id)
    current = (await session.execute(stmt)).scalar_one_or_none()
    if current:
        return current
    history_stmt = (
        select(User)
        .join(UserAssignmentHistory, UserAssignmentHistory.user_id == User.id)
        .where(
            UserAssignmentHistory.field == AssignmentField.EMPLOYEE_CODE,
            UserAssignmentHistory.value_label == employee_code,
        )
    )
    if ignore_user_id:
        history_stmt = history_stmt.where(User.id != ignore_user_id)
    return (await session.execute(history_stmt)).scalar_one_or_none()


async def assert_unique_email(
    session: AsyncSession, email: str, *, ignore_user_id: UUID | None = None
) -> None:
    owner = await find_email_owner(session, email, ignore_user_id=ignore_user_id)
    if owner and owner.id != ignore_user_id:
        raise AppError(
            status_code=409,
            code="EMAIL_DUPLICATE",
            message="Email is already used, including historical values",
            details=_conflict_details(owner),
        )
    reserved = await session.get(ReservedEmail, email.lower())
    if reserved is not None and reserved.user_id != ignore_user_id:
        holder = await session.get(User, reserved.user_id)
        if holder:
            raise AppError(
                status_code=409,
                code="EMAIL_DUPLICATE",
                message="Email is already used, including historical values",
                details=_conflict_details(holder),
            )
        raise AppError(
            status_code=409,
            code="EMAIL_DUPLICATE",
            message="Email is already used, including historical values",
        )


async def assert_unique_employee_code(
    session: AsyncSession, employee_code: str, *, ignore_user_id: UUID | None = None
) -> None:
    owner = await find_employee_code_owner(session, employee_code, ignore_user_id=ignore_user_id)
    if owner and owner.id != ignore_user_id:
        raise AppError(
            status_code=409,
            code="EMPLOYEE_CODE_DUPLICATE",
            message="Employee code is already used, including historical values",
            details=_conflict_details(owner),
        )
    reserved = await session.get(ReservedEmployeeCode, employee_code)
    if reserved is not None and reserved.user_id != ignore_user_id:
        holder = await session.get(User, reserved.user_id)
        if holder:
            raise AppError(
                status_code=409,
                code="EMPLOYEE_CODE_DUPLICATE",
                message="Employee code is already used, including historical values",
                details=_conflict_details(holder),
            )
        raise AppError(
            status_code=409,
            code="EMPLOYEE_CODE_DUPLICATE",
            message="Employee code is already used, including historical values",
        )


async def reserve_email(session: AsyncSession, email: str, user_id: UUID) -> None:
    normalized = email.lower()
    existing = await session.get(ReservedEmail, normalized)
    if existing is not None:
        if existing.user_id != user_id:
            raise AppError(
                status_code=409,
                code="EMAIL_DUPLICATE",
                message="Email is already used, including historical values",
            )
        return
    session.add(ReservedEmail(email_normalized=normalized, user_id=user_id))
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise identity_unique_conflict(exc) from exc


async def reserve_employee_code(session: AsyncSession, employee_code: str, user_id: UUID) -> None:
    existing = await session.get(ReservedEmployeeCode, employee_code)
    if existing is not None:
        if existing.user_id != user_id:
            raise AppError(
                status_code=409,
                code="EMPLOYEE_CODE_DUPLICATE",
                message="Employee code is already used, including historical values",
            )
        return
    session.add(ReservedEmployeeCode(employee_code=employee_code, user_id=user_id))
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise identity_unique_conflict(exc) from exc


async def assert_manager_ok(
    session: AsyncSession,
    user_id: UUID | None,
    manager_id: UUID | None,
    *,
    actor: User,
) -> User | None:
    if manager_id is None:
        return None
    if user_id is not None and manager_id == user_id:
        raise AppError(
            status_code=422,
            code="HIERARCHY_SELF",
            message="A user cannot report to themselves",
        )
    manager = (
        await session.execute(
            select(User)
            .options(*user_load_options())
            .where(User.id == manager_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if manager is None:
        raise AppError(
            status_code=404, code="MANAGER_NOT_FOUND", message="Reporting manager not found"
        )
    if not await can_view_user(session, actor, manager):
        raise AppError(
            status_code=404, code="MANAGER_NOT_FOUND", message="Reporting manager not found"
        )
    if manager.account_status != AccountStatus.ACTIVE:
        raise AppError(
            status_code=422,
            code="MANAGER_INACTIVE",
            message="Reporting manager must be active",
        )
    if manager.user_type is None or not manager.user_type.can_be_reporting_manager:
        raise AppError(
            status_code=422,
            code="MANAGER_TYPE_INELIGIBLE",
            message="Reporting manager user type is not eligible",
        )
    if user_id is not None:
        reports = await descendant_ids(session, user_id)
        if manager_id in reports:
            raise AppError(
                status_code=422,
                code="HIERARCHY_CYCLE",
                message="Reporting manager would create a circular hierarchy",
            )
    return manager


async def prepare_reporting_manager_change(
    session: AsyncSession,
    actor: User,
    *,
    user_id: UUID | None,
    manager_id: UUID | None,
) -> tuple[User | None, User | None]:
    """Serialize and validate one authoritative reporting-graph mutation.

    PostgreSQL holds this advisory lock until the surrounding service transaction
    commits or rolls back, so every API process observes the preceding graph write
    before validating its own proposed edge.
    """
    await session.execute(select(func.pg_advisory_xact_lock(REPORTING_HIERARCHY_LOCK_KEY)))

    target = await reload_user(session, user_id) if user_id is not None else None
    if target is not None and not await can_view_user(session, actor, target):
        raise AppError(
            status_code=403,
            code="OUT_OF_SCOPE",
            message="User is outside your visibility scope",
        )
    if target is not None and is_owner(target) and manager_id is not None:
        raise AppError(
            status_code=422,
            code="OWNER_NO_MANAGER",
            message="OWNER cannot have a reporting manager",
        )

    manager = await assert_manager_ok(
        session,
        user_id,
        manager_id,
        actor=actor,
    )
    return target, manager


async def resolve_org(
    session: AsyncSession,
    *,
    office_id: UUID | None,
    department_id: UUID | None,
    team_id: UUID | None,
) -> tuple[Office | None, Department | None, Team | None]:
    if department_id and not office_id:
        raise AppError(
            status_code=422,
            code="OFFICE_REQUIRED",
            message="Department requires an office",
        )
    if team_id and (not office_id or not department_id):
        raise AppError(
            status_code=422,
            code="TEAM_REQUIRES_ORG",
            message="Team requires matching office and department",
        )
    office = await session.get(Office, office_id) if office_id else None
    if office_id and office is None:
        raise AppError(status_code=404, code="OFFICE_NOT_FOUND", message="Office not found")
    department = await session.get(Department, department_id) if department_id else None
    if department_id and department is None:
        raise AppError(status_code=404, code="DEPARTMENT_NOT_FOUND", message="Department not found")
    if department and office and department.office_id != office.id:
        raise AppError(
            status_code=422,
            code="DEPARTMENT_OFFICE_MISMATCH",
            message="Department must belong to the selected office",
        )
    team = await session.get(Team, team_id) if team_id else None
    if team_id and team is None:
        raise AppError(status_code=404, code="TEAM_NOT_FOUND", message="Team not found")
    if team and (team.office_id != office_id or team.department_id != department_id):
        raise AppError(
            status_code=422,
            code="TEAM_ORG_MISMATCH",
            message="Team must match the selected office and department",
        )
    return office, department, team


def _apply_employment_side_effects(
    user: User,
    status: EmploymentStatus,
    last_working_date: date | None,
    *,
    period: EmploymentPeriod | None,
) -> None:
    if is_owner(user) and status in OWNER_FORBIDDEN_EMPLOYMENT:
        raise AppError(
            status_code=422,
            code="OWNER_EMPLOYMENT_LOCKED",
            message="OWNER cannot be Resigned, Terminated, or Inactive",
        )
    if status in REQUIRE_LAST_WORKING and last_working_date is None:
        raise AppError(
            status_code=422,
            code="LAST_WORKING_DATE_REQUIRED",
            message="Resigned and Terminated require a last working date",
        )
    user.employment_status = status
    if status in REQUIRE_LAST_WORKING:
        user.last_working_date = last_working_date
        if period is not None:
            period.last_working_date = last_working_date
    if status in AUTO_DEACTIVATE_EMPLOYMENT:
        user.account_status = AccountStatus.DEACTIVATED


async def _initial_assignments(
    session: AsyncSession,
    user: User,
    office: Office | None,
    department: Department | None,
    team: Team | None,
    designation: Designation,
) -> None:
    now = utcnow()
    await record_assignment(
        session,
        user_id=user.id,
        field=AssignmentField.EMPLOYEE_CODE,
        value_id=None,
        value_label=user.employee_code,
        at=now,
    )
    await record_assignment(
        session,
        user_id=user.id,
        field=AssignmentField.EMPLOYMENT_STATUS,
        value_id=None,
        value_label=user.employment_status,
        at=now,
    )
    await record_assignment(
        session,
        user_id=user.id,
        field=AssignmentField.DESIGNATION,
        value_id=str(designation.id),
        value_label=designation.name,
        at=now,
    )
    await record_assignment(
        session,
        user_id=user.id,
        field=AssignmentField.OFFICE,
        value_id=str(office.id) if office else None,
        value_label=office.name if office else None,
        at=now,
    )
    await record_assignment(
        session,
        user_id=user.id,
        field=AssignmentField.DEPARTMENT,
        value_id=str(department.id) if department else None,
        value_label=department.name if department else None,
        at=now,
    )
    await record_assignment(
        session,
        user_id=user.id,
        field=AssignmentField.TEAM,
        value_id=str(team.id) if team else None,
        value_label=team.name if team else None,
        at=now,
    )
    manager_label = None
    if user.reporting_manager_id:
        manager = await session.get(User, user.reporting_manager_id)
        manager_label = manager.full_name if manager else None
    await record_assignment(
        session,
        user_id=user.id,
        field=AssignmentField.REPORTING_MANAGER,
        value_id=str(user.reporting_manager_id) if user.reporting_manager_id else None,
        value_label=manager_label,
        at=now,
    )


async def create_user(session: AsyncSession, actor: User, payload: UserCreateRequest) -> User:
    await assert_unique_email(session, payload.email)
    await assert_unique_employee_code(session, payload.employee_code)
    if payload.reporting_manager_id is not None:
        await prepare_reporting_manager_change(
            session,
            actor,
            user_id=None,
            manager_id=payload.reporting_manager_id,
        )
    designation = await session.get(Designation, payload.designation_id)
    if designation is None or designation.status != MasterStatus.ACTIVE:
        raise AppError(
            status_code=404, code="DESIGNATION_NOT_FOUND", message="Designation not found"
        )
    office, department, team = await resolve_org(
        session,
        office_id=payload.office_id,
        department_id=payload.department_id,
        team_id=payload.team_id,
    )
    user_type = None
    if payload.user_type_id:
        user_type = await session.get(UserType, payload.user_type_id)
        if user_type is None:
            raise AppError(
                status_code=404, code="USER_TYPE_NOT_FOUND", message="User type not found"
            )
        if user_type.code == "OWNER":
            raise AppError(
                status_code=403,
                code="OWNER_ASSIGN_FORBIDDEN",
                message="OWNER cannot be assigned through user management",
            )
    now = utcnow()
    account_status = AccountStatus.PENDING
    if payload.employment_status in AUTO_DEACTIVATE_EMPLOYMENT:
        account_status = AccountStatus.DEACTIVATED
    user = User(
        id=new_uuid(),
        user_code=await next_user_code(session),
        employee_code=payload.employee_code.strip(),
        full_name=payload.full_name.strip(),
        email=str(payload.email).lower(),
        mobile=payload.mobile.strip(),
        designation_id=designation.id,
        employment_status=payload.employment_status,
        joining_date=payload.joining_date,
        last_working_date=payload.last_working_date,
        office_id=office.id if office else None,
        department_id=department.id if department else None,
        team_id=team.id if team else None,
        reporting_manager_id=payload.reporting_manager_id,
        user_type_id=user_type.id if user_type else None,
        account_status=account_status,
        failed_login_count=0,
        mfa_enabled=False,
        created_at=now,
        updated_at=now,
    )
    _apply_employment_side_effects(
        user, payload.employment_status, payload.last_working_date, period=None
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise identity_unique_conflict(exc) from exc
    await reserve_email(session, user.email, user.id)
    await reserve_employee_code(session, user.employee_code, user.id)
    period = EmploymentPeriod(
        id=new_uuid(),
        user_id=user.id,
        joining_date=payload.joining_date,
        last_working_date=user.last_working_date,
        employee_code=user.employee_code,
        is_current=True,
        created_at=now,
    )
    session.add(period)
    await _initial_assignments(session, user, office, department, team, designation)
    await record_audit(
        session,
        action="user.create",
        entity_type="user",
        entity_id=str(user.id),
        actor_id=actor.id,
        target_user_id=user.id,
        new_values={
            "userCode": user.user_code,
            "email": user.email,
            "employeeCode": user.employee_code,
        },
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise identity_unique_conflict(exc) from exc
    return await reload_user(session, user.id)


async def reload_user(session: AsyncSession, user_id: UUID) -> User:
    user = (
        await session.execute(
            select(User)
            .options(*user_load_options())
            .where(User.id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if user is None:
        raise AppError(status_code=404, code="USER_NOT_FOUND", message="User not found")
    return user


async def list_users(
    session: AsyncSession,
    actor: User,
    *,
    q: str | None,
    employment_status: str | None,
    account_status: str | None,
    office_id: UUID | None,
    department_id: UUID | None,
    user_type_id: UUID | None,
) -> list[User]:
    stmt = (
        select(User)
        .options(*user_load_options())
        .outerjoin(Office, User.office_id == Office.id)
        .outerjoin(Department, User.department_id == Department.id)
        .outerjoin(Team, User.team_id == Team.id)
        .outerjoin(Designation, User.designation_id == Designation.id)
    )
    allowed = await visible_user_ids(session, actor)
    if allowed is not None:
        stmt = stmt.where(User.id.in_(allowed))
    if employment_status:
        stmt = stmt.where(User.employment_status == employment_status)
    if account_status:
        stmt = stmt.where(User.account_status == account_status)
    if office_id:
        stmt = stmt.where(User.office_id == office_id)
    if department_id:
        stmt = stmt.where(User.department_id == department_id)
    if user_type_id:
        stmt = stmt.where(User.user_type_id == user_type_id)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(User.full_name).like(like),
                func.lower(User.email).like(like),
                func.lower(User.user_code).like(like),
                func.lower(User.employee_code).like(like),
                func.lower(User.mobile).like(like),
                func.lower(func.coalesce(Office.name, "")).like(like),
                func.lower(func.coalesce(Office.code, "")).like(like),
                func.lower(func.coalesce(Department.name, "")).like(like),
                func.lower(func.coalesce(Team.name, "")).like(like),
                func.lower(func.coalesce(Designation.name, "")).like(like),
            )
        )
    stmt = stmt.order_by(User.user_code)
    return list((await session.execute(stmt)).scalars().unique().all())


async def list_reporting_managers(
    session: AsyncSession,
    actor: User,
    *,
    exclude_user_id: UUID | None = None,
) -> list[User]:
    stmt = (
        select(User)
        .options(*user_load_options())
        .join(UserType, User.user_type_id == UserType.id)
        .where(
            User.account_status == AccountStatus.ACTIVE,
            UserType.can_be_reporting_manager.is_(True),
        )
        .order_by(User.user_code)
    )
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    allowed = await visible_user_ids(session, actor)
    if allowed is not None:
        stmt = stmt.where(User.id.in_(allowed))
    return list((await session.execute(stmt)).scalars().unique().all())


async def list_case_owners(
    session: AsyncSession, *, exclude_user_id: UUID | None = None
) -> list[User]:
    stmt = (
        select(User)
        .options(*user_load_options())
        .join(UserType, User.user_type_id == UserType.id)
        .where(
            User.account_status == AccountStatus.ACTIVE,
            UserType.can_be_case_owner.is_(True),
        )
        .order_by(User.user_code)
    )
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    return list((await session.execute(stmt)).scalars().unique().all())


async def get_visible_user(session: AsyncSession, actor: User, user_id: UUID) -> User:
    user = await reload_user(session, user_id)
    if not await can_view_user(session, actor, user):
        raise AppError(
            status_code=403, code="OUT_OF_SCOPE", message="User is outside your visibility scope"
        )
    return user


async def _current_period(session: AsyncSession, user_id: UUID) -> EmploymentPeriod | None:
    return (
        await session.execute(
            select(EmploymentPeriod).where(
                EmploymentPeriod.user_id == user_id, EmploymentPeriod.is_current.is_(True)
            )
        )
    ).scalar_one_or_none()


async def update_user(
    session: AsyncSession, actor: User, target: User, payload: UserUpdateRequest
) -> User:
    manager_touched = "reporting_manager_id" in payload.model_fields_set
    validated_manager = None
    if manager_touched:
        refreshed_target, validated_manager = await prepare_reporting_manager_change(
            session,
            actor,
            user_id=target.id,
            manager_id=payload.reporting_manager_id,
        )
        assert refreshed_target is not None
        target = refreshed_target

    old = public_user(target)
    now = utcnow()
    if payload.email and payload.email.lower() != target.email:
        await assert_unique_email(session, payload.email, ignore_user_id=target.id)
        session.add(UserEmailHistory(user_id=target.id, email=target.email, changed_at=now))
        target.email = payload.email.lower()
        await reserve_email(session, target.email, target.id)
        await terminate_sessions(session, target.id)
    if payload.employee_code and payload.employee_code != target.employee_code:
        await assert_unique_employee_code(session, payload.employee_code, ignore_user_id=target.id)
        await record_assignment(
            session,
            user_id=target.id,
            field=AssignmentField.EMPLOYEE_CODE,
            value_id=None,
            value_label=payload.employee_code.strip(),
            at=now,
        )
        target.employee_code = payload.employee_code.strip()
        await reserve_employee_code(session, target.employee_code, target.id)
    org_touched = any(
        name in payload.model_fields_set for name in ("office_id", "department_id", "team_id")
    )
    if org_touched:
        office_id = (
            payload.office_id if "office_id" in payload.model_fields_set else target.office_id
        )
        department_id = (
            payload.department_id
            if "department_id" in payload.model_fields_set
            else target.department_id
        )
        team_id = payload.team_id if "team_id" in payload.model_fields_set else target.team_id
        office, department, team = await resolve_org(
            session, office_id=office_id, department_id=department_id, team_id=team_id
        )
        if target.office_id != (office.id if office else None):
            await record_assignment(
                session,
                user_id=target.id,
                field=AssignmentField.OFFICE,
                value_id=str(office.id) if office else None,
                value_label=office.name if office else None,
                at=now,
            )
        if target.department_id != (department.id if department else None):
            await record_assignment(
                session,
                user_id=target.id,
                field=AssignmentField.DEPARTMENT,
                value_id=str(department.id) if department else None,
                value_label=department.name if department else None,
                at=now,
            )
        if target.team_id != (team.id if team else None):
            await record_assignment(
                session,
                user_id=target.id,
                field=AssignmentField.TEAM,
                value_id=str(team.id) if team else None,
                value_label=team.name if team else None,
                at=now,
            )
        target.office_id = office.id if office else None
        target.department_id = department.id if department else None
        target.team_id = team.id if team else None
        await _maybe_clear_tl(session, target)
    if manager_touched:
        if target.reporting_manager_id != payload.reporting_manager_id:
            await record_assignment(
                session,
                user_id=target.id,
                field=AssignmentField.REPORTING_MANAGER,
                value_id=str(payload.reporting_manager_id)
                if payload.reporting_manager_id
                else None,
                value_label=validated_manager.full_name if validated_manager else None,
                at=now,
            )
        target.reporting_manager_id = payload.reporting_manager_id
    if payload.full_name is not None:
        target.full_name = payload.full_name.strip()
    if payload.mobile is not None:
        target.mobile = payload.mobile.strip()
    if payload.designation_id is not None and payload.designation_id != target.designation_id:
        designation = await session.get(Designation, payload.designation_id)
        if designation is None:
            raise AppError(
                status_code=404, code="DESIGNATION_NOT_FOUND", message="Designation not found"
            )
        await record_assignment(
            session,
            user_id=target.id,
            field=AssignmentField.DESIGNATION,
            value_id=str(designation.id),
            value_label=designation.name,
            at=now,
        )
        target.designation_id = designation.id
    if payload.joining_date is not None:
        target.joining_date = payload.joining_date
    if payload.employment_status is not None:
        period = await _current_period(session, target.id)
        previous = target.employment_status
        _apply_employment_side_effects(
            target, payload.employment_status, payload.last_working_date, period=period
        )
        if previous != target.employment_status:
            await record_assignment(
                session,
                user_id=target.id,
                field=AssignmentField.EMPLOYMENT_STATUS,
                value_id=None,
                value_label=target.employment_status,
                at=now,
            )
        if target.account_status == AccountStatus.DEACTIVATED:
            await terminate_sessions(session, target.id)
            await clear_team_leadership_for_user(session, target.id)
    elif payload.last_working_date is not None:
        target.last_working_date = payload.last_working_date
    target.updated_at = now
    await record_audit(
        session,
        action="user.update",
        entity_type="user",
        entity_id=str(target.id),
        actor_id=actor.id,
        target_user_id=target.id,
        old_values=old,
        new_values=public_user(target),
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise identity_unique_conflict(exc) from exc
    return await reload_user(session, target.id)


async def _maybe_clear_tl(session: AsyncSession, user: User) -> None:
    teams = list(
        (await session.execute(select(Team).where(Team.team_leader_id == user.id))).scalars()
    )
    for team in teams:
        if (
            user.office_id != team.office_id
            or user.department_id != team.department_id
            or user.team_id != team.id
        ):
            from nexa_bos_api.identity.org_service import set_team_leader

            await set_team_leader(session, None, team, None, commit=False)


async def update_self_mobile(session: AsyncSession, user: User, mobile: str) -> User:
    old = {"mobile": user.mobile}
    user.mobile = mobile.strip()
    user.updated_at = utcnow()
    await record_audit(
        session,
        action="user.self_update",
        entity_type="user",
        entity_id=str(user.id),
        actor_id=user.id,
        target_user_id=user.id,
        old_values=old,
        new_values={"mobile": user.mobile},
    )
    await session.commit()
    return await reload_user(session, user.id)


async def assign_user_type(
    session: AsyncSession, actor: User, target: User, user_type_id: UUID
) -> User:
    if is_owner(target):
        raise AppError(
            status_code=403,
            code="OWNER_PROTECTED",
            message="OWNER account user type cannot be changed",
        )
    user_type = await session.get(UserType, user_type_id)
    if user_type is None:
        raise AppError(
            status_code=404,
            code="USER_TYPE_NOT_FOUND",
            message="User type not found",
        )
    if user_type.code == "OWNER":
        raise AppError(
            status_code=403,
            code="OWNER_ASSIGN_FORBIDDEN",
            message="Users.AssignUserType cannot assign OWNER",
        )
    old_code = target.user_type.code if target.user_type else None
    old = {"userTypeId": str(target.user_type_id) if target.user_type_id else None}
    target.user_type_id = user_type.id
    target.updated_at = utcnow()
    await terminate_sessions(session, target.id)
    if old_code == "TL" and user_type.code != "TL":
        await clear_team_leadership_for_user(session, target.id)
    await record_audit(
        session,
        action="user.assign_type",
        entity_type="user",
        entity_id=str(target.id),
        actor_id=actor.id,
        target_user_id=target.id,
        old_values=old,
        new_values={"userTypeId": str(user_type.id), "userTypeCode": user_type.code},
    )
    await session.commit()
    return await reload_user(session, target.id)


async def set_account_status(
    session: AsyncSession, actor: User, target: User, status: AccountStatus
) -> User:
    if is_owner(target) and status == AccountStatus.DEACTIVATED:
        raise AppError(
            status_code=403,
            code="OWNER_PROTECTED",
            message="OWNER account cannot be deactivated",
        )
    if status == AccountStatus.ACTIVE and target.user_type_id is None:
        raise AppError(
            status_code=422,
            code="USER_TYPE_REQUIRED",
            message="Assign a user type before activating",
        )
    old = {"accountStatus": target.account_status}
    target.account_status = status
    target.updated_at = utcnow()
    if status == AccountStatus.DEACTIVATED:
        await terminate_sessions(session, target.id)
        await clear_team_leadership_for_user(session, target.id)
    await record_audit(
        session,
        action="user.activate" if status == AccountStatus.ACTIVE else "user.deactivate",
        entity_type="user",
        entity_id=str(target.id),
        actor_id=actor.id,
        target_user_id=target.id,
        old_values=old,
        new_values={"accountStatus": status},
    )
    from nexa_bos_api.notifications.enums import NotificationEventType
    from nexa_bos_api.notifications.service import dispatch_source_event

    await dispatch_source_event(
        session,
        event_type=NotificationEventType.SECURITY_USER_STATUS_CHANGED,
        source_event_key=f"{target.id}:{status}:{target.updated_at.isoformat()}",
        affected_user_id=target.id,
        linked_entity_type="user",
        linked_entity_id=str(target.id),
        contextual_link=f"/users/{target.id}",
        actor_id=actor.id,
    )
    await session.commit()
    return await reload_user(session, target.id)


async def rehire_user(
    session: AsyncSession, actor: User, target: User, payload: RehireRequest
) -> User:
    if is_owner(target):
        raise AppError(status_code=422, code="OWNER_PROTECTED", message="OWNER cannot be rehired")
    if "reporting_manager_id" in payload.model_fields_set:
        refreshed_target, _ = await prepare_reporting_manager_change(
            session,
            actor,
            user_id=target.id,
            manager_id=payload.reporting_manager_id,
        )
        assert refreshed_target is not None
        target = refreshed_target
    if payload.employment_status in AUTO_DEACTIVATE_EMPLOYMENT:
        raise AppError(
            status_code=422,
            code="REHIRE_STATUS_INVALID",
            message="Rehire employment status must be Active, Probation, or Notice Period",
        )
    now = utcnow()
    current = await _current_period(session, target.id)
    if current:
        current.is_current = False
        if current.last_working_date is None:
            current.last_working_date = target.last_working_date
    employee_code = payload.employee_code.strip() if payload.employee_code else target.employee_code
    if employee_code != target.employee_code:
        await assert_unique_employee_code(session, employee_code, ignore_user_id=target.id)
        await record_assignment(
            session,
            user_id=target.id,
            field=AssignmentField.EMPLOYEE_CODE,
            value_id=None,
            value_label=employee_code,
            at=now,
        )
        target.employee_code = employee_code
    office, department, team = await resolve_org(
        session,
        office_id=payload.office_id if payload.office_id is not None else target.office_id,
        department_id=payload.department_id
        if payload.department_id is not None
        else target.department_id,
        team_id=payload.team_id if payload.team_id is not None else target.team_id,
    )
    if (
        payload.office_id is not None
        or payload.department_id is not None
        or payload.team_id is not None
    ):
        target.office_id = office.id if office else None
        target.department_id = department.id if department else None
        target.team_id = team.id if team else None
    if payload.designation_id:
        designation = await session.get(Designation, payload.designation_id)
        if designation is None:
            raise AppError(
                status_code=404, code="DESIGNATION_NOT_FOUND", message="Designation not found"
            )
        target.designation_id = designation.id
        await record_assignment(
            session,
            user_id=target.id,
            field=AssignmentField.DESIGNATION,
            value_id=str(designation.id),
            value_label=designation.name,
            at=now,
        )
    if "reporting_manager_id" in payload.model_fields_set:
        target.reporting_manager_id = payload.reporting_manager_id
    target.joining_date = payload.joining_date
    target.last_working_date = None
    target.employment_status = payload.employment_status
    target.updated_at = now
    session.add(
        EmploymentPeriod(
            id=new_uuid(),
            user_id=target.id,
            joining_date=payload.joining_date,
            last_working_date=None,
            employee_code=target.employee_code,
            is_current=True,
            created_at=now,
        )
    )
    await record_assignment(
        session,
        user_id=target.id,
        field=AssignmentField.EMPLOYMENT_STATUS,
        value_id=None,
        value_label=target.employment_status,
        at=now,
    )
    await record_audit(
        session,
        action="user.rehire",
        entity_type="user",
        entity_id=str(target.id),
        actor_id=actor.id,
        target_user_id=target.id,
        new_values={
            "joiningDate": payload.joining_date.isoformat(),
            "employeeCode": target.employee_code,
            "accountStatus": target.account_status,
        },
    )
    await session.commit()
    return await reload_user(session, target.id)


async def unlock_user(session: AsyncSession, actor: User, target: User) -> User:
    old = {
        "lockedUntil": target.locked_until.isoformat() if target.locked_until else None,
        "failedLoginCount": target.failed_login_count,
    }
    target.locked_until = None
    target.failed_login_count = 0
    target.updated_at = utcnow()
    await record_audit(
        session,
        action="user.unlock",
        entity_type="user",
        entity_id=str(target.id),
        actor_id=actor.id,
        target_user_id=target.id,
        old_values=old,
        new_values={"lockedUntil": None, "failedLoginCount": 0},
    )
    await session.commit()
    return await reload_user(session, target.id)


async def save_photo(
    session: AsyncSession,
    actor: User,
    target: User,
    data: bytes,
    suffix: str,
    content_type: str,
    original_name: str,
) -> User:
    filename = f"{target.id}{suffix}"
    path = storage_dir() / filename
    path.write_bytes(data)
    target.profile_photo_key = filename
    target.profile_photo_content_type = content_type
    target.profile_photo_original_name = original_name
    target.updated_at = utcnow()
    await record_audit(
        session,
        action="user.photo",
        entity_type="user",
        entity_id=str(target.id),
        actor_id=actor.id,
        target_user_id=target.id,
        new_values={"key": filename, "contentType": content_type},
    )
    await session.commit()
    return await reload_user(session, target.id)


def photo_path(user: User) -> Path | None:
    if not user.profile_photo_key:
        return None
    path = storage_dir() / user.profile_photo_key
    if not path.is_file():
        return None
    return path


async def profile_history(session: AsyncSession, user_id: UUID) -> dict[str, object]:
    emails = list(
        (
            await session.execute(
                select(UserEmailHistory)
                .where(UserEmailHistory.user_id == user_id)
                .order_by(UserEmailHistory.changed_at.desc())
            )
        ).scalars()
    )
    assignments = list(
        (
            await session.execute(
                select(UserAssignmentHistory)
                .where(UserAssignmentHistory.user_id == user_id)
                .order_by(UserAssignmentHistory.effective_from.desc())
            )
        ).scalars()
    )
    periods = list(
        (
            await session.execute(
                select(EmploymentPeriod)
                .where(EmploymentPeriod.user_id == user_id)
                .order_by(EmploymentPeriod.created_at.desc())
            )
        ).scalars()
    )
    events = list(
        (
            await session.execute(
                select(AuditEvent)
                .where(AuditEvent.target_user_id == user_id)
                .order_by(AuditEvent.created_at.desc())
                .limit(100)
            )
        ).scalars()
    )
    employee_codes = [
        {
            "employeeCode": row.value_label,
            "effectiveFrom": row.effective_from.isoformat(),
            "effectiveTo": row.effective_to.isoformat() if row.effective_to else None,
        }
        for row in assignments
        if row.field == AssignmentField.EMPLOYEE_CODE
    ]
    return {
        "emails": [{"email": row.email, "changedAt": row.changed_at.isoformat()} for row in emails],
        "employeeCodes": employee_codes,
        "assignments": [
            {
                "field": row.field,
                "valueId": row.value_id,
                "valueLabel": row.value_label,
                "effectiveFrom": row.effective_from.isoformat(),
                "effectiveTo": row.effective_to.isoformat() if row.effective_to else None,
            }
            for row in assignments
        ],
        "employmentPeriods": [
            {
                "joiningDate": row.joining_date.isoformat(),
                "lastWorkingDate": row.last_working_date.isoformat()
                if row.last_working_date
                else None,
                "employeeCode": row.employee_code,
                "isCurrent": row.is_current,
            }
            for row in periods
        ],
        "events": [
            {
                "id": str(row.id),
                "action": row.action,
                "actorId": str(row.actor_id) if row.actor_id else None,
                "oldValues": row.old_values,
                "newValues": row.new_values,
                "createdAt": row.created_at.isoformat(),
            }
            for row in events
        ],
    }
