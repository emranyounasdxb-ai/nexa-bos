from __future__ import annotations

import hmac
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pyotp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import is_owner, load_user_with_type, permission_set
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus, TokenPurpose, UserTypeStatus
from nexa_bos_api.identity.models import (
    Department,
    Designation,
    Office,
    OneTimeToken,
    PasswordHistory,
    SecuritySettings,
    Session,
    Team,
    User,
    UserType,
    new_uuid,
)
from nexa_bos_api.identity.passwords import (
    hash_password,
    hash_token,
    new_token,
    validate_password_policy,
    verify_password,
)

FAILED_LOGIN_LIMIT = 5


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def get_settings_row(session: AsyncSession) -> SecuritySettings:
    row = await session.get(SecuritySettings, 1)
    if row is None:
        row = SecuritySettings(
            id=1,
            setup_link_expiry_hours=24,
            lockout_minutes=30,
            inactivity_timeout_minutes=30,
            absolute_session_hours=12,
        )
        session.add(row)
        await session.flush()
    return row


async def terminate_sessions(session: AsyncSession, user_id: UUID) -> None:
    rows = (await session.execute(select(Session).where(Session.user_id == user_id))).scalars()
    for row in rows:
        await session.delete(row)


async def create_session(session: AsyncSession, user: User) -> tuple[str, str]:
    await terminate_sessions(session, user.id)
    token = new_token()
    csrf = new_token()
    now = _utcnow()
    session.add(
        Session(
            id=new_uuid(),
            user_id=user.id,
            token_hash=hash_token(token),
            csrf_token_hash=hash_token(csrf),
            csrf_token=csrf,
            created_at=now,
            last_seen_at=now,
        )
    )
    return token, csrf


async def resolve_session(session: AsyncSession, token: str) -> tuple[User, Session] | None:
    token_hash = hash_token(token)
    row = (
        await session.execute(select(Session).where(Session.token_hash == token_hash))
    ).scalar_one_or_none()
    if row is None:
        return None
    now = _utcnow()
    settings = await get_settings_row(session)
    absolute_end = row.created_at + timedelta(hours=settings.absolute_session_hours)
    idle_end = row.last_seen_at + timedelta(minutes=settings.inactivity_timeout_minutes)
    if now >= absolute_end or now >= idle_end:
        await session.delete(row)
        await session.commit()
        return None
    user = await load_user_with_type(session, row.user_id)
    if user is None or user.account_status != AccountStatus.ACTIVE:
        return None
    if not is_owner(user) and (
        user.user_type is None or user.user_type.status != UserTypeStatus.ACTIVE
    ):
        await session.delete(row)
        await session.commit()
        return None
    row.last_seen_at = now
    await session.commit()
    return user, row


def csrf_matches(row: Session, csrf_token: str | None) -> bool:
    if not csrf_token:
        return False
    return hmac.compare_digest(hash_token(csrf_token), row.csrf_token_hash)


async def login(
    session: AsyncSession, email: str, password: str
) -> tuple[User, str | None, str | None, str | None]:
    user = (
        await session.execute(
            select(User)
            .options(selectinload(User.user_type).selectinload(UserType.permissions))
            .where(User.email == email.lower())
        )
    ).scalar_one_or_none()
    if user is None:
        raise AppError(status_code=401, code="AUTH_FAILED", message="Invalid email or password")

    now = _utcnow()
    if user.locked_until and user.locked_until > now:
        raise AppError(
            status_code=423,
            code="ACCOUNT_LOCKED",
            message="Account is temporarily locked",
        )
    if (
        user.account_status != AccountStatus.ACTIVE
        or not user.password_hash
        or not verify_password(password, user.password_hash)
    ):
        user.failed_login_count += 1
        sec = await get_settings_row(session)
        if user.failed_login_count >= FAILED_LOGIN_LIMIT:
            user.locked_until = now + timedelta(minutes=sec.lockout_minutes)
            user.failed_login_count = 0
            await terminate_sessions(session, user.id)
            await record_audit(
                session,
                action="auth.lock",
                entity_type="user",
                entity_id=str(user.id),
                target_user_id=user.id,
                new_values={"lockedUntil": user.locked_until.isoformat()},
            )
        await record_audit(
            session,
            action="auth.login_failed",
            entity_type="user",
            entity_id=str(user.id),
            target_user_id=user.id,
        )
        await session.commit()
        if user.locked_until and user.locked_until > now:
            raise AppError(
                status_code=423,
                code="ACCOUNT_LOCKED",
                message="Account is temporarily locked",
            )
        raise AppError(status_code=401, code="AUTH_FAILED", message="Invalid email or password")

    if not is_owner(user) and (
        user.user_type is None or user.user_type.status != UserTypeStatus.ACTIVE
    ):
        raise AppError(
            status_code=403,
            code="USER_TYPE_INACTIVE",
            message="This user type is inactive",
        )

    user.failed_login_count = 0
    user.locked_until = None
    if user.mfa_enabled:
        if not user.mfa_secret:
            raise AppError(
                status_code=403,
                code="MFA_NOT_CONFIGURED",
                message="MFA is enabled but no authenticator secret is configured",
            )
        challenge = new_token()
        session.add(
            OneTimeToken(
                id=new_uuid(),
                user_id=user.id,
                purpose=TokenPurpose.MFA_LOGIN,
                token_hash=hash_token(challenge),
                expires_at=_utcnow() + timedelta(minutes=10),
                created_at=_utcnow(),
            )
        )
        await record_audit(
            session,
            action="auth.mfa_challenge",
            entity_type="user",
            entity_id=str(user.id),
            actor_id=user.id,
            target_user_id=user.id,
        )
        await session.commit()
        user = await load_user_with_type(session, user.id)
        assert user is not None
        return user, None, None, challenge
    token, csrf = await create_session(session, user)
    await record_audit(
        session,
        action="auth.login",
        entity_type="user",
        entity_id=str(user.id),
        actor_id=user.id,
        target_user_id=user.id,
    )
    await session.commit()
    user = await load_user_with_type(session, user.id)
    assert user is not None
    return user, token, csrf, None


async def complete_mfa_login(
    session: AsyncSession, raw_token: str, code: str
) -> tuple[User, str, str]:
    token_hash = hash_token(raw_token)
    row = (
        await session.execute(select(OneTimeToken).where(OneTimeToken.token_hash == token_hash))
    ).scalar_one_or_none()
    now = _utcnow()
    if (
        row is None
        or row.used_at is not None
        or row.expires_at <= now
        or row.purpose != TokenPurpose.MFA_LOGIN
    ):
        raise AppError(
            status_code=400,
            code="TOKEN_INVALID",
            message="MFA challenge is invalid or expired",
        )
    user = await load_user_with_type(session, row.user_id)
    if user is None or not user.mfa_enabled or not user.mfa_secret:
        raise AppError(
            status_code=400,
            code="TOKEN_INVALID",
            message="MFA challenge is invalid or expired",
        )
    if user.locked_until and user.locked_until > now:
        raise AppError(
            status_code=423,
            code="ACCOUNT_LOCKED",
            message="Account is temporarily locked",
        )
    if user.account_status != AccountStatus.ACTIVE:
        raise AppError(
            status_code=401,
            code="AUTH_FAILED",
            message="Invalid email or password",
        )
    if not is_owner(user) and (
        user.user_type is None or user.user_type.status != UserTypeStatus.ACTIVE
    ):
        raise AppError(
            status_code=403,
            code="USER_TYPE_INACTIVE",
            message="This user type is inactive",
        )
    if not pyotp.TOTP(user.mfa_secret).verify(code, valid_window=1):
        raise AppError(status_code=422, code="MFA_INVALID", message="Invalid authenticator code")
    row.used_at = now
    token, csrf = await create_session(session, user)
    await record_audit(
        session,
        action="auth.login",
        entity_type="user",
        entity_id=str(user.id),
        actor_id=user.id,
        target_user_id=user.id,
    )
    await session.commit()
    user = await load_user_with_type(session, user.id)
    assert user is not None
    return user, token, csrf


async def logout(session: AsyncSession, user: User) -> None:
    await terminate_sessions(session, user.id)
    await record_audit(
        session,
        action="auth.logout",
        entity_type="user",
        entity_id=str(user.id),
        actor_id=user.id,
        target_user_id=user.id,
    )
    await session.commit()


async def issue_one_time_link(
    session: AsyncSession,
    *,
    actor: User,
    target: User,
    purpose: TokenPurpose,
    web_origin: str,
) -> dict[str, str]:
    sec = await get_settings_row(session)
    now = _utcnow()
    token = new_token()
    session.add(
        OneTimeToken(
            id=new_uuid(),
            user_id=target.id,
            purpose=purpose,
            token_hash=hash_token(token),
            expires_at=now + timedelta(hours=sec.setup_link_expiry_hours),
            created_at=now,
        )
    )
    path = "setup" if purpose is TokenPurpose.SETUP else "reset"
    url = f"{web_origin.rstrip('/')}/{path}?token={token}"
    await record_audit(
        session,
        action=f"auth.{purpose.value}_link",
        entity_type="user",
        entity_id=str(target.id),
        actor_id=actor.id,
        target_user_id=target.id,
    )
    await session.commit()
    return {
        "token": token,
        "url": url,
        "expiresAt": (now + timedelta(hours=sec.setup_link_expiry_hours)).isoformat(),
    }


async def consume_password_token(
    session: AsyncSession,
    *,
    raw_token: str,
    password: str,
    purpose: TokenPurpose,
) -> User:
    validate_password_policy(password)
    token_hash = hash_token(raw_token)
    row = (
        await session.execute(select(OneTimeToken).where(OneTimeToken.token_hash == token_hash))
    ).scalar_one_or_none()
    now = _utcnow()
    if row is None or row.used_at is not None or row.expires_at <= now or row.purpose != purpose:
        raise AppError(status_code=400, code="TOKEN_INVALID", message="Link is invalid or expired")
    user = await session.get(User, row.user_id)
    if user is None:
        raise AppError(status_code=400, code="TOKEN_INVALID", message="Link is invalid or expired")
    await _assert_password_not_reused(session, user.id, password)
    password_hash = hash_password(password)
    user.password_hash = password_hash
    user.failed_login_count = 0
    user.locked_until = None
    user.updated_at = now
    row.used_at = now
    session.add(
        PasswordHistory(
            id=new_uuid(),
            user_id=user.id,
            password_hash=password_hash,
            created_at=now,
        )
    )
    await terminate_sessions(session, user.id)
    await record_audit(
        session,
        action=f"auth.password_{purpose.value}",
        entity_type="user",
        entity_id=str(user.id),
        target_user_id=user.id,
        actor_id=user.id,
    )
    await session.commit()
    return user


async def _assert_password_not_reused(session: AsyncSession, user_id: UUID, password: str) -> None:
    rows = (
        await session.execute(
            select(PasswordHistory)
            .where(PasswordHistory.user_id == user_id)
            .order_by(PasswordHistory.created_at.desc())
            .limit(5)
        )
    ).scalars()
    hashes = [row.password_hash for row in rows]
    user = await session.get(User, user_id)
    if user and user.password_hash:
        hashes = [user.password_hash, *hashes]
    for previous in hashes[:5]:
        if verify_password(password, previous):
            raise AppError(
                status_code=422,
                code="PASSWORD_REUSED",
                message="The last 5 passwords cannot be reused",
            )


def _ref(entity: Office | Department | Designation | Team | None) -> dict[str, str] | None:
    if entity is None:
        return None
    return {"id": str(entity.id), "code": entity.code, "name": entity.name}


def public_user(user: User, *, csrf_token: str | None = None) -> dict[str, object]:
    user_type = None
    if user.user_type is not None:
        user_type = {
            "id": str(user.user_type.id),
            "code": user.user_type.code,
            "name": user.user_type.name,
            "isSystem": user.user_type.is_system,
            "status": user.user_type.status,
            "visibilityScope": user.user_type.visibility_scope,
            "customerVisibilityScope": user.user_type.customer_visibility_scope,
            "applicationVisibilityScope": user.user_type.application_visibility_scope,
            "reportingVisibilityScope": user.user_type.reporting_visibility_scope,
            "mfaRequired": user.user_type.mfa_required,
            "canBeReportingManager": user.user_type.can_be_reporting_manager,
            "canBeCaseOwner": user.user_type.can_be_case_owner,
        }
    payload: dict[str, object] = {
        "id": str(user.id),
        "userCode": user.user_code,
        "employeeCode": user.employee_code,
        "fullName": user.full_name,
        "email": user.email,
        "mobile": user.mobile,
        "designation": _ref(user.designation),
        "employmentStatus": user.employment_status,
        "joiningDate": user.joining_date.isoformat(),
        "lastWorkingDate": user.last_working_date.isoformat() if user.last_working_date else None,
        "office": _ref(user.office),
        "department": _ref(user.department),
        "team": _ref(user.team),
        "reportingManagerId": str(user.reporting_manager_id) if user.reporting_manager_id else None,
        "hasPhoto": bool(user.profile_photo_key),
        "userType": user_type,
        "accountStatus": user.account_status,
        "mfaEnabled": user.mfa_enabled,
        "lockedUntil": user.locked_until.isoformat() if user.locked_until else None,
        "permissions": sorted(permission_set(user)),
        "createdAt": user.created_at.isoformat(),
        "updatedAt": user.updated_at.isoformat(),
    }
    if csrf_token is not None:
        payload["csrfToken"] = csrf_token
    return payload
