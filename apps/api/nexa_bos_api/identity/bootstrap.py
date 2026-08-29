from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.catalog.service import seed_catalog
from nexa_bos_api.customers.models import CustomerCodeCounter
from nexa_bos_api.identity.enums import (
    DEFAULT_REPORTING_MANAGER_CODES,
    INITIAL_OFFICES,
    SYSTEM_USER_TYPE_CODES,
    SYSTEM_USER_TYPE_NAMES,
    MasterStatus,
    UserTypeStatus,
    VisibilityScope,
)
from nexa_bos_api.identity.models import (
    Office,
    OfficeNameHistory,
    Permission,
    SecuritySettings,
    User,
    UserCodeCounter,
    UserType,
    UserTypePermission,
    new_uuid,
)
from nexa_bos_api.identity.permissions import ALL_PERMISSION_CODES, PERMISSION_CATALOG


async def bootstrap_identity(session: AsyncSession) -> None:
    await _seed_permissions(session)
    await _seed_user_types(session)
    await _seed_settings(session)
    await _seed_offices(session)
    await seed_catalog(session)
    await session.commit()


async def _seed_permissions(session: AsyncSession) -> None:
    existing = {row[0] for row in (await session.execute(select(Permission.code))).all()}
    for code, description in PERMISSION_CATALOG:
        if code not in existing:
            session.add(Permission(code=code, description=description))
        else:
            row = await session.get(Permission, code)
            if row is not None:
                row.description = description


async def _seed_user_types(session: AsyncSession) -> None:
    now = datetime.now(UTC)
    existing_types = (await session.execute(select(UserType))).scalars().all()
    by_code = {row.code: row for row in existing_types}
    for code in SYSTEM_USER_TYPE_CODES:
        can_manage = code in DEFAULT_REPORTING_MANAGER_CODES
        if code in by_code:
            row = by_code[code]
            row.can_be_reporting_manager = can_manage
            row.mfa_required = False
            if code == "OWNER":
                row.visibility_scope = VisibilityScope.COMPANY
                row.customer_visibility_scope = VisibilityScope.COMPANY
                row.application_visibility_scope = VisibilityScope.COMPANY
                row.reporting_visibility_scope = VisibilityScope.COMPANY
            continue
        user_type = UserType(
            id=new_uuid(),
            code=code,
            name=SYSTEM_USER_TYPE_NAMES[code],
            description=None,
            is_system=True,
            status=UserTypeStatus.ACTIVE,
            visibility_scope=VisibilityScope.COMPANY if code == "OWNER" else None,
            customer_visibility_scope=VisibilityScope.COMPANY if code == "OWNER" else None,
            application_visibility_scope=VisibilityScope.COMPANY if code == "OWNER" else None,
            reporting_visibility_scope=VisibilityScope.COMPANY if code == "OWNER" else None,
            mfa_required=False,
            can_be_reporting_manager=can_manage,
            can_be_case_owner=False,
            created_at=now,
            updated_at=now,
        )
        session.add(user_type)
        await session.flush()
        by_code[code] = user_type
        if code == "OWNER":
            for permission in ALL_PERMISSION_CODES:
                session.add(
                    UserTypePermission(
                        user_type_id=user_type.id,
                        permission_code=permission,
                    )
                )
    owner = by_code.get("OWNER")
    if owner is not None:
        existing_perms = {
            row[0]
            for row in (
                await session.execute(
                    select(UserTypePermission.permission_code).where(
                        UserTypePermission.user_type_id == owner.id
                    )
                )
            ).all()
        }
        for permission in ALL_PERMISSION_CODES:
            if permission not in existing_perms:
                session.add(UserTypePermission(user_type_id=owner.id, permission_code=permission))


async def _seed_settings(session: AsyncSession) -> None:
    current = await session.get(SecuritySettings, 1)
    if current is None:
        session.add(
            SecuritySettings(
                id=1,
                setup_link_expiry_hours=24,
                lockout_minutes=30,
                inactivity_timeout_minutes=30,
                absolute_session_hours=12,
            )
        )
    counter = await session.get(UserCodeCounter, 1)
    if counter is None:
        session.add(UserCodeCounter(id=1, last_value=0))
    customer_counter = await session.get(CustomerCodeCounter, 1)
    if customer_counter is None:
        session.add(CustomerCodeCounter(id=1, last_value=0))


async def _seed_offices(session: AsyncSession) -> None:
    now = datetime.now(UTC)
    existing = {row[0] for row in (await session.execute(select(Office.code))).all()}
    for code, name in INITIAL_OFFICES:
        if code in existing:
            continue
        office = Office(
            id=new_uuid(),
            code=code,
            name=name,
            status=MasterStatus.ACTIVE,
            created_at=now,
            updated_at=now,
        )
        session.add(office)
        await session.flush()
        session.add(
            OfficeNameHistory(
                id=new_uuid(),
                office_id=office.id,
                name=name,
                effective_from=now,
                effective_to=None,
            )
        )


async def owner_exists(session: AsyncSession) -> bool:
    owner_type = (
        await session.execute(select(UserType).where(UserType.code == "OWNER"))
    ).scalar_one_or_none()
    if owner_type is None:
        return False
    existing = (
        await session.execute(select(User.id).where(User.user_type_id == owner_type.id))
    ).first()
    return existing is not None
