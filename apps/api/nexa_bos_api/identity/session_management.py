"""Granular, scoped session revocation; no account or profile mutation."""

from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import has_permission, is_owner
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.models import Session, User
from nexa_bos_api.identity.permissions import USERS_TERMINATE_SESSIONS
from nexa_bos_api.identity.users_service import get_visible_user


async def terminate_user_sessions(
    session: AsyncSession, actor: User, user_id: UUID, reason: str
) -> int:
    if not has_permission(actor, USERS_TERMINATE_SESSIONS):
        raise AppError(
            status_code=403, code="FORBIDDEN", message="Session termination is not permitted"
        )
    target = await get_visible_user(session, actor, user_id)
    if is_owner(target) and not is_owner(actor):
        raise AppError(
            status_code=403, code="OWNER_PROTECTED", message="OWNER sessions are protected"
        )
    reason = reason.strip()
    if not reason or len(reason) > 1000:
        raise AppError(
            status_code=422,
            code="REASON_REQUIRED",
            message="Provide a reason of 1 to 1000 characters",
        )
    # One statement revokes every currently existing session. No raw session identifiers
    # or authentication material are returned or written into the audit record.
    revoked = len(
        (
            await session.scalars(
                delete(Session).where(Session.user_id == target.id).returning(Session.id)
            )
        ).all()
    )
    await record_audit(
        session,
        action="user.sessions.terminate",
        entity_type="user",
        entity_id=str(target.id),
        actor_id=actor.id,
        target_user_id=target.id,
        new_values={"reason": reason, "sessionsRevoked": revoked},
    )
    await session.commit()
    return revoked
