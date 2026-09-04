from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.auth_service import terminate_sessions
from nexa_bos_api.identity.enums import UserTypeStatus, VisibilityScope
from nexa_bos_api.identity.models import User, UserType, UserTypePermission, new_uuid
from nexa_bos_api.identity.permissions import ALL_PERMISSION_CODES
from nexa_bos_api.identity.schemas import UserTypeCreateRequest, UserTypeUpdateRequest


def utcnow() -> datetime:
    return datetime.now(UTC)


def serialize_user_type(user_type: UserType) -> dict[str, object]:
    return {
        "id": str(user_type.id),
        "code": user_type.code,
        "name": user_type.name,
        "description": user_type.description,
        "isSystem": user_type.is_system,
        "status": user_type.status,
        "visibilityScope": user_type.visibility_scope,
        "customerVisibilityScope": user_type.customer_visibility_scope,
        "applicationVisibilityScope": user_type.application_visibility_scope,
        "reportingVisibilityScope": user_type.reporting_visibility_scope,
        "mfaRequired": user_type.mfa_required,
        "canBeReportingManager": user_type.can_be_reporting_manager,
        "canBeCaseOwner": user_type.can_be_case_owner,
        "permissions": sorted(row.permission_code for row in user_type.permissions),
        "createdAt": user_type.created_at.isoformat(),
        "updatedAt": user_type.updated_at.isoformat(),
    }


async def load_user_type(session: AsyncSession, user_type_id: UUID) -> UserType:
    row = (
        await session.execute(
            select(UserType)
            .options(selectinload(UserType.permissions))
            .where(UserType.id == user_type_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError(status_code=404, code="USER_TYPE_NOT_FOUND", message="User type not found")
    return row


async def list_user_types(session: AsyncSession) -> list[UserType]:
    result = await session.execute(
        select(UserType).options(selectinload(UserType.permissions)).order_by(UserType.code)
    )
    return list(result.scalars().unique().all())


async def create_custom_type(
    session: AsyncSession, actor: User, payload: UserTypeCreateRequest
) -> UserType:
    code = payload.code.strip().upper()
    existing = (
        await session.execute(select(UserType).where(UserType.code == code))
    ).scalar_one_or_none()
    if existing:
        raise AppError(
            status_code=409,
            code="USER_TYPE_CODE_DUPLICATE",
            message="User type code must be unique",
        )
    now = utcnow()
    user_type = UserType(
        id=new_uuid(),
        code=code,
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else None,
        is_system=False,
        status=UserTypeStatus.INACTIVE,
        visibility_scope=None,
        customer_visibility_scope=None,
        application_visibility_scope=None,
        reporting_visibility_scope=None,
        mfa_required=False,
        can_be_reporting_manager=payload.can_be_reporting_manager,
        can_be_case_owner=payload.can_be_case_owner,
        created_at=now,
        updated_at=now,
    )
    session.add(user_type)
    await session.flush()
    await record_audit(
        session,
        action="user_type.create",
        entity_type="user_type",
        entity_id=str(user_type.id),
        actor_id=actor.id,
        new_values={
            "code": user_type.code,
            "name": user_type.name,
            "status": user_type.status,
            "canBeReportingManager": user_type.can_be_reporting_manager,
            "canBeCaseOwner": user_type.can_be_case_owner,
        },
    )
    await session.commit()
    return await load_user_type(session, user_type.id)


async def update_custom_type(
    session: AsyncSession, actor: User, user_type: UserType, payload: UserTypeUpdateRequest
) -> UserType:
    if user_type.is_system:
        raise AppError(
            status_code=403,
            code="SYSTEM_USER_TYPE_LOCKED",
            message="Default user types cannot be renamed",
        )
    old = {
        "name": user_type.name,
        "description": user_type.description,
        "canBeReportingManager": user_type.can_be_reporting_manager,
        "canBeCaseOwner": user_type.can_be_case_owner,
    }
    if payload.name is not None:
        user_type.name = payload.name.strip()
    if "description" in payload.model_fields_set:
        user_type.description = payload.description.strip() if payload.description else None
    if payload.can_be_reporting_manager is not None:
        user_type.can_be_reporting_manager = payload.can_be_reporting_manager
    if payload.can_be_case_owner is not None:
        user_type.can_be_case_owner = payload.can_be_case_owner
    user_type.updated_at = utcnow()
    await record_audit(
        session,
        action="user_type.update",
        entity_type="user_type",
        entity_id=str(user_type.id),
        actor_id=actor.id,
        old_values=old,
        new_values={
            "name": user_type.name,
            "description": user_type.description,
            "canBeReportingManager": user_type.can_be_reporting_manager,
            "canBeCaseOwner": user_type.can_be_case_owner,
        },
    )
    await session.commit()
    return await load_user_type(session, user_type.id)


async def set_user_type_status(
    session: AsyncSession, actor: User, user_type: UserType, status: UserTypeStatus
) -> UserType:
    if user_type.code == "OWNER":
        raise AppError(
            status_code=403,
            code="OWNER_PROTECTED",
            message="OWNER user type cannot be deactivated",
        )
    if user_type.code == "PENDING" and status is not UserTypeStatus.ACTIVE:
        raise AppError(
            status_code=403,
            code="PENDING_USER_TYPE_PROTECTED",
            message="PENDING user type must remain active",
        )
    old = {"status": user_type.status}
    user_type.status = status
    user_type.updated_at = utcnow()
    assigned_users = (
        await session.execute(select(User.id).where(User.user_type_id == user_type.id))
    ).all()
    for row in assigned_users:
        await terminate_sessions(session, row[0])
    await record_audit(
        session,
        action="user_type.activate" if status == UserTypeStatus.ACTIVE else "user_type.deactivate",
        entity_type="user_type",
        entity_id=str(user_type.id),
        actor_id=actor.id,
        old_values=old,
        new_values={"status": status},
    )
    await session.commit()
    return await load_user_type(session, user_type.id)


async def assign_permissions(
    session: AsyncSession, actor: User, user_type: UserType, permissions: list[str]
) -> UserType:
    unknown = [code for code in permissions if code not in ALL_PERMISSION_CODES]
    if unknown:
        raise AppError(
            status_code=422,
            code="PERMISSION_UNKNOWN",
            message="Permissions are system-defined and cannot be created",
            details=unknown,
        )
    if user_type.code == "PENDING" and permissions:
        raise AppError(
            status_code=403,
            code="PENDING_USER_TYPE_PROTECTED",
            message="PENDING must remain a zero-permission user type",
        )
    if user_type.code == "OWNER":
        raise AppError(
            status_code=403,
            code="OWNER_PROTECTED",
            message="OWNER always has full access",
        )
    old = sorted(row.permission_code for row in user_type.permissions)
    for row in list(user_type.permissions):
        await session.delete(row)
    await session.flush()
    for code in sorted(set(permissions)):
        session.add(UserTypePermission(user_type_id=user_type.id, permission_code=code))
    user_type.updated_at = utcnow()
    assigned_users = (
        await session.execute(select(User.id).where(User.user_type_id == user_type.id))
    ).all()
    for row in assigned_users:
        await terminate_sessions(session, row[0])
    await record_audit(
        session,
        action="user_type.permissions",
        entity_type="user_type",
        entity_id=str(user_type.id),
        actor_id=actor.id,
        old_values={"permissions": old},
        new_values={"permissions": sorted(set(permissions))},
    )
    await session.commit()
    return await load_user_type(session, user_type.id)


async def assign_scope(
    session: AsyncSession,
    actor: User,
    user_type: UserType,
    scope: VisibilityScope | None,
) -> UserType:
    if user_type.code == "PENDING" and scope is not None:
        raise AppError(
            status_code=403,
            code="PENDING_USER_TYPE_PROTECTED",
            message="PENDING cannot be assigned a visibility scope",
        )
    if user_type.code == "OWNER":
        raise AppError(
            status_code=403,
            code="OWNER_PROTECTED",
            message="OWNER always has company-wide access",
        )
    old = {"visibilityScope": user_type.visibility_scope}
    user_type.visibility_scope = scope.value if scope else None
    user_type.updated_at = utcnow()
    assigned_users = (
        await session.execute(select(User.id).where(User.user_type_id == user_type.id))
    ).all()
    for row in assigned_users:
        await terminate_sessions(session, row[0])
    await record_audit(
        session,
        action="user_type.scope",
        entity_type="user_type",
        entity_id=str(user_type.id),
        actor_id=actor.id,
        old_values=old,
        new_values={"visibilityScope": user_type.visibility_scope},
    )
    await session.commit()
    return await load_user_type(session, user_type.id)


async def assign_customer_scope(
    session: AsyncSession,
    actor: User,
    user_type: UserType,
    scope: VisibilityScope | None,
) -> UserType:
    if user_type.code == "PENDING" and scope is not None:
        raise AppError(
            status_code=403,
            code="PENDING_USER_TYPE_PROTECTED",
            message="PENDING cannot be assigned a customer visibility scope",
        )
    if user_type.code == "OWNER":
        raise AppError(
            status_code=403,
            code="OWNER_PROTECTED",
            message="OWNER always has company-wide customer visibility",
        )
    old = {"customerVisibilityScope": user_type.customer_visibility_scope}
    user_type.customer_visibility_scope = scope.value if scope else None
    user_type.updated_at = utcnow()
    assigned_users = (
        await session.execute(select(User.id).where(User.user_type_id == user_type.id))
    ).all()
    for row in assigned_users:
        await terminate_sessions(session, row[0])
    await record_audit(
        session,
        action="user_type.customer_scope",
        entity_type="user_type",
        entity_id=str(user_type.id),
        actor_id=actor.id,
        old_values=old,
        new_values={"customerVisibilityScope": user_type.customer_visibility_scope},
    )
    await session.commit()
    return await load_user_type(session, user_type.id)


async def assign_application_scope(
    session: AsyncSession,
    actor: User,
    user_type: UserType,
    scope: VisibilityScope | None,
) -> UserType:
    if user_type.code == "PENDING" and scope is not None:
        raise AppError(
            status_code=403,
            code="PENDING_USER_TYPE_PROTECTED",
            message="PENDING cannot be assigned an application visibility scope",
        )
    if user_type.code == "OWNER":
        raise AppError(
            status_code=403,
            code="OWNER_PROTECTED",
            message="OWNER always has company-wide application visibility",
        )
    old = {"applicationVisibilityScope": user_type.application_visibility_scope}
    user_type.application_visibility_scope = scope.value if scope else None
    user_type.updated_at = utcnow()
    assigned_users = (
        await session.execute(select(User.id).where(User.user_type_id == user_type.id))
    ).all()
    for row in assigned_users:
        await terminate_sessions(session, row[0])
    await record_audit(
        session,
        action="user_type.application_scope",
        entity_type="user_type",
        entity_id=str(user_type.id),
        actor_id=actor.id,
        old_values=old,
        new_values={"applicationVisibilityScope": user_type.application_visibility_scope},
    )
    await session.commit()
    return await load_user_type(session, user_type.id)


async def assign_reporting_scope(
    session: AsyncSession,
    actor: User,
    user_type: UserType,
    scope: VisibilityScope | None,
) -> UserType:
    if user_type.code == "PENDING" and scope is not None:
        raise AppError(
            status_code=403,
            code="PENDING_USER_TYPE_PROTECTED",
            message="PENDING cannot be assigned a reporting visibility scope",
        )
    if user_type.code == "OWNER":
        raise AppError(
            status_code=403,
            code="OWNER_PROTECTED",
            message="OWNER always has company-wide reporting visibility",
        )
    old = {"reportingVisibilityScope": user_type.reporting_visibility_scope}
    user_type.reporting_visibility_scope = scope.value if scope else None
    user_type.updated_at = utcnow()
    assigned_users = (
        await session.execute(select(User.id).where(User.user_type_id == user_type.id))
    ).all()
    for row in assigned_users:
        await terminate_sessions(session, row[0])
    await record_audit(
        session,
        action="user_type.reporting_scope",
        entity_type="user_type",
        entity_id=str(user_type.id),
        actor_id=actor.id,
        old_values=old,
        new_values={"reportingVisibilityScope": user_type.reporting_visibility_scope},
    )
    await session.commit()
    return await load_user_type(session, user_type.id)


async def assign_case_owner_eligibility(
    session: AsyncSession, actor: User, user_type: UserType, enabled: bool
) -> UserType:
    if user_type.code == "PENDING" and enabled:
        raise AppError(
            status_code=403,
            code="PENDING_USER_TYPE_PROTECTED",
            message="PENDING cannot be eligible for Case ownership",
        )
    old = {"canBeCaseOwner": user_type.can_be_case_owner}
    user_type.can_be_case_owner = enabled
    user_type.updated_at = utcnow()
    await record_audit(
        session,
        action="user_type.case_owner",
        entity_type="user_type",
        entity_id=str(user_type.id),
        actor_id=actor.id,
        old_values=old,
        new_values={"canBeCaseOwner": user_type.can_be_case_owner},
    )
    await session.commit()
    return await load_user_type(session, user_type.id)
