from __future__ import annotations

from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.identity.enums import VisibilityScope
from nexa_bos_api.identity.models import User, UserType
from nexa_bos_api.identity.permissions import ALL_PERMISSION_CODES


def user_load_options():
    return (
        selectinload(User.user_type).selectinload(UserType.permissions),
        selectinload(User.office),
        selectinload(User.department),
        selectinload(User.team),
        selectinload(User.designation),
    )


async def load_user_with_type(session: AsyncSession, user_id: UUID) -> User | None:
    result = await session.execute(
        select(User).options(*user_load_options()).where(User.id == user_id)
    )
    return result.scalar_one_or_none()


def is_owner(user: User) -> bool:
    return user.user_type is not None and user.user_type.code == "OWNER"


def permission_set(user: User) -> set[str]:
    if is_owner(user):
        return set(ALL_PERMISSION_CODES)
    if user.user_type is None:
        return set()
    return {row.permission_code for row in user.user_type.permissions}


def has_permission(user: User, code: str) -> bool:
    return code in permission_set(user)


def visibility_scope(user: User) -> VisibilityScope:
    if is_owner(user):
        return VisibilityScope.COMPANY
    raw = user.user_type.visibility_scope if user.user_type else None
    try:
        return VisibilityScope(raw) if raw else VisibilityScope.OWN
    except ValueError:
        return VisibilityScope.OWN


def customer_visibility_scope(user: User) -> VisibilityScope | None:
    """Customer directory scope. Independent of user-directory visibility_scope."""
    if is_owner(user):
        return VisibilityScope.COMPANY
    raw = user.user_type.customer_visibility_scope if user.user_type else None
    if not raw:
        return None
    try:
        return VisibilityScope(raw)
    except ValueError:
        return None


def application_visibility_scope(user: User) -> VisibilityScope | None:
    """Application visibility. Independent of user-directory and customer scopes."""
    if is_owner(user):
        return VisibilityScope.COMPANY
    raw = user.user_type.application_visibility_scope if user.user_type else None
    if not raw:
        return None
    try:
        return VisibilityScope(raw)
    except ValueError:
        return None


def has_company_customer_visibility(user: User) -> bool:
    return customer_visibility_scope(user) is VisibilityScope.COMPANY


async def descendant_ids(session: AsyncSession, manager_id: UUID) -> set[UUID]:
    result = await session.execute(
        text(
            """
            WITH RECURSIVE reports AS (
                SELECT id FROM users WHERE reporting_manager_id = :manager_id
                UNION ALL
                SELECT u.id
                FROM users u
                INNER JOIN reports r ON u.reporting_manager_id = r.id
            )
            SELECT id FROM reports
            """
        ),
        {"manager_id": manager_id},
    )
    return {row[0] for row in result.all()}


async def visible_user_ids(session: AsyncSession, actor: User) -> set[UUID] | None:
    """None means company-wide (no id filter). Always includes the actor."""
    scope = visibility_scope(actor)
    if scope is VisibilityScope.COMPANY:
        return None
    allowed = {actor.id}
    if scope is VisibilityScope.OWN:
        return allowed
    if scope is VisibilityScope.OFFICE:
        if not actor.office_id:
            return allowed
        result = await session.execute(select(User.id).where(User.office_id == actor.office_id))
        allowed.update(row[0] for row in result.all())
        return allowed
    allowed.update(await descendant_ids(session, actor.id))
    return allowed


async def can_view_user(session: AsyncSession, actor: User, target: User) -> bool:
    if actor.id == target.id:
        return True
    allowed = await visible_user_ids(session, actor)
    if allowed is None:
        return True
    return target.id in allowed
