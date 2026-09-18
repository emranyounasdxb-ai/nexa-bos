from __future__ import annotations

from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from nexa_bos_api.applications.models import Application
from nexa_bos_api.identity.access import (
    application_visibility_scope,
    customer_visibility_scope,
    descendant_ids,
    has_user_type,
    tl_team_owner_ids,
)
from nexa_bos_api.identity.enums import VisibilityScope
from nexa_bos_api.identity.models import User, UserType


async def tl_case_owner_ids(session: AsyncSession, actor: User) -> set[UUID]:
    """Existing SE team rules plus saved, same-office Admin Officer reports.

    Case-only scope: this does not expand the TL's employee/HR directory scope.
    """
    allowed = await tl_team_owner_ids(session, actor)
    if not has_user_type(actor, "TL") or not actor.office_id:
        return allowed
    admins = await session.scalars(
        select(User.id).join(UserType, User.user_type_id == UserType.id).where(
            User.reporting_manager_id == actor.id,
            User.office_id == actor.office_id,
            UserType.code == "ADMIN_OFFICER",
            UserType.can_be_case_owner.is_(True),
        )
    )
    return allowed | set(admins)


async def visible_case_owner_ids(session: AsyncSession, actor: User) -> set[UUID] | None:
    """None means company-wide. Empty set means fail-closed."""
    scope = application_visibility_scope(actor)
    if scope is None:
        return set()
    if has_user_type(actor, "TL"):
        return await tl_case_owner_ids(session, actor)
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


def apply_owner_filter(stmt: Select, allowed: set[UUID] | None) -> Select:
    if allowed is None:
        return stmt
    if not allowed:
        return stmt.where(Application.id.is_(None))
    return stmt.where(Application.case_owner_id.in_(allowed))


async def visible_customer_ids(session: AsyncSession, actor: User) -> set[UUID] | None:
    """None means all customers. Empty set means none."""
    scope = customer_visibility_scope(actor)
    if scope is None:
        return set()
    if scope is VisibilityScope.COMPANY and not has_user_type(actor, "TL"):
        return None
    owner = aliased(User)
    stmt = select(Application.customer_id).join(owner, Application.case_owner_id == owner.id)
    if has_user_type(actor, "TL"):
        stmt = stmt.where(Application.case_owner_id.in_(await tl_case_owner_ids(session, actor)))
    elif scope is VisibilityScope.OWN:
        stmt = stmt.where(Application.case_owner_id == actor.id)
    elif scope is VisibilityScope.OFFICE:
        if not actor.office_id:
            return set()
        stmt = stmt.where(owner.office_id == actor.office_id)
    else:
        team_ids = {actor.id, *(await descendant_ids(session, actor.id))}
        stmt = stmt.where(Application.case_owner_id.in_(team_ids))
    rows = (await session.execute(stmt.distinct())).all()
    return {row[0] for row in rows}
