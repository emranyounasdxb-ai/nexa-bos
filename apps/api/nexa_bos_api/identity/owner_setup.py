from __future__ import annotations

import hmac
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.core.config import get_settings
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.auth_service import get_settings_row
from nexa_bos_api.identity.bootstrap import owner_exists
from nexa_bos_api.identity.enums import (
    AUTO_DEACTIVATE_EMPLOYMENT,
    OWNER_FORBIDDEN_EMPLOYMENT,
    AccountStatus,
    VisibilityScope,
)
from nexa_bos_api.identity.models import (
    EmploymentPeriod,
    PasswordHistory,
    SecuritySettings,
    User,
    UserCodeCounter,
    UserType,
    new_uuid,
)
from nexa_bos_api.identity.org_service import create_designation
from nexa_bos_api.identity.passwords import hash_password, validate_password_policy
from nexa_bos_api.identity.schemas import OwnerBootstrapRequest
from nexa_bos_api.identity.users_service import (
    _initial_assignments,
    assert_unique_email,
    assert_unique_employee_code,
    next_user_code,
    reload_user,
)


async def bootstrap_status(session: AsyncSession) -> dict[str, bool]:
    settings_row = await get_settings_row(session)
    exists = await owner_exists(session)
    available = settings_row.bootstrap_completed_at is None and not exists
    return {"available": available, "ownerExists": exists}


async def complete_owner_bootstrap(session: AsyncSession, payload: OwnerBootstrapRequest) -> User:
    settings = get_settings()
    status = await bootstrap_status(session)
    if not status["available"]:
        raise AppError(
            status_code=409,
            code="BOOTSTRAP_DISABLED",
            message="Initial OWNER setup is no longer available",
        )
    if not settings.bootstrap_secret:
        raise AppError(
            status_code=503,
            code="BOOTSTRAP_SECRET_MISSING",
            message="Bootstrap secret is not configured",
        )
    if len(payload.secret) != len(settings.bootstrap_secret) or not hmac.compare_digest(
        payload.secret, settings.bootstrap_secret
    ):
        raise AppError(
            status_code=403,
            code="BOOTSTRAP_SECRET_INVALID",
            message="Bootstrap secret is invalid",
        )
    if (
        payload.employment_status in OWNER_FORBIDDEN_EMPLOYMENT
        or payload.employment_status in AUTO_DEACTIVATE_EMPLOYMENT
    ):
        raise AppError(
            status_code=422,
            code="OWNER_EMPLOYMENT_LOCKED",
            message="OWNER employment status cannot be Resigned, Terminated, or Inactive",
        )
    validate_password_policy(payload.password)
    await assert_unique_email(session, payload.email)
    await assert_unique_employee_code(session, payload.employee_code)
    owner_type = (
        await session.execute(
            select(UserType)
            .options(selectinload(UserType.permissions))
            .where(UserType.code == "OWNER")
        )
    ).scalar_one()
    owner_type.visibility_scope = VisibilityScope.COMPANY
    owner_type.mfa_required = False
    designation = await create_designation(
        session,
        None,
        payload.designation_name,
        payload.designation_code,
        commit=False,
    )
    now = datetime.now(UTC)
    counter = await session.get(UserCodeCounter, 1)
    if counter is None or counter.last_value != 0:
        user_code = await next_user_code(session)
    else:
        counter.last_value = 1
        user_code = "USR-000001"
    password_hash = hash_password(payload.password)
    user = User(
        id=new_uuid(),
        user_code=user_code,
        employee_code=payload.employee_code.strip(),
        full_name=payload.full_name.strip(),
        email=str(payload.email).lower(),
        mobile=payload.mobile.strip(),
        designation_id=designation.id,
        employment_status=payload.employment_status,
        joining_date=payload.joining_date,
        last_working_date=None,
        office_id=None,
        department_id=None,
        team_id=None,
        reporting_manager_id=None,
        user_type_id=owner_type.id,
        account_status=AccountStatus.ACTIVE,
        password_hash=password_hash,
        failed_login_count=0,
        mfa_enabled=False,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    await session.flush()
    session.add(
        EmploymentPeriod(
            id=new_uuid(),
            user_id=user.id,
            joining_date=payload.joining_date,
            last_working_date=None,
            employee_code=user.employee_code,
            is_current=True,
            created_at=now,
        )
    )
    session.add(
        PasswordHistory(
            id=new_uuid(),
            user_id=user.id,
            password_hash=password_hash,
            created_at=now,
        )
    )
    await _initial_assignments(session, user, None, None, None, designation)
    settings_row = await session.get(SecuritySettings, 1)
    assert settings_row is not None
    settings_row.bootstrap_completed_at = now
    await record_audit(
        session,
        action="user.bootstrap_owner",
        entity_type="user",
        entity_id=str(user.id),
        target_user_id=user.id,
        new_values={"userCode": user.user_code, "email": user.email},
    )
    await session.commit()
    return await reload_user(session, user.id)
