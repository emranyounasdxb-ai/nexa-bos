"""Audited server-reserved codes and minimal Pending Setup creation."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus, EmploymentStatus
from nexa_bos_api.identity.models import User, UserCodeReservation, new_uuid
from nexa_bos_api.identity.schemas import BasicUserCreateRequest
from nexa_bos_api.identity.users_service import (
    assert_unique_email,
    identity_unique_conflict,
    next_user_code,
    reload_user,
    reserve_email,
    utcnow,
)


async def reserve_user_code(session: AsyncSession, actor: User) -> str:
    code = await next_user_code(session)
    session.add(UserCodeReservation(user_code=code, issued_by_id=actor.id, issued_at=utcnow()))
    await record_audit(
        session,
        action="user.code.reserve",
        entity_type="user_code",
        entity_id=code,
        actor_id=actor.id,
        new_values={"userCode": code},
    )
    await session.commit()
    return code


async def create_basic_user(
    session: AsyncSession, actor: User, payload: BasicUserCreateRequest
) -> User:
    reservation = await session.scalar(
        select(UserCodeReservation)
        .where(
            UserCodeReservation.user_code == payload.user_code,
            UserCodeReservation.issued_by_id == actor.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if reservation is None or reservation.user_id is not None:
        raise AppError(
            status_code=409,
            code="USER_CODE_UNAVAILABLE",
            message="User Code is not available. Reopen Create User for a new code.",
        )
    await assert_unique_email(session, payload.personal_email)
    now = utcnow()
    user = User(
        id=new_uuid(),
        user_code=reservation.user_code,
        full_name=payload.full_name,
        email=payload.personal_email.lower(),
        personal_email=payload.personal_email.lower(),
        mobile=payload.personal_mobile,
        personal_mobile=payload.personal_mobile,
        employment_status=EmploymentStatus.INACTIVE,
        account_status=AccountStatus.PENDING,
        user_type_id=None,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    try:
        await session.flush()
        reservation.user_id = user.id
        await reserve_email(session, user.email, user.id)
        await record_audit(
            session,
            action="user.create",
            entity_type="user",
            entity_id=str(user.id),
            actor_id=actor.id,
            target_user_id=user.id,
            new_values={"userCode": user.user_code, "accountStatus": user.account_status},
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if getattr(exc.orig, "sqlstate", None) != "23505":
            raise
        raise identity_unique_conflict(exc) from exc
    return await reload_user(session, user.id)
