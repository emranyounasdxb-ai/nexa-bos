from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.auth_service import get_settings_row
from nexa_bos_api.identity.permissions import SECURITY_MANAGE_SETTINGS
from nexa_bos_api.identity.schemas import SecuritySettingsUpdate

router = APIRouter(prefix="/security-settings", tags=["security"])


def _serialize(row) -> dict[str, int]:
    return {
        "setupLinkExpiryHours": row.setup_link_expiry_hours,
        "lockoutMinutes": row.lockout_minutes,
        "inactivityTimeoutMinutes": row.inactivity_timeout_minutes,
        "absoluteSessionHours": row.absolute_session_hours,
        "failedLoginLimit": 5,
    }


@router.get("")
async def get_security_settings(
    session: SessionDep,
    _actor: Annotated[CurrentUser, Depends(require_permission(SECURITY_MANAGE_SETTINGS))],
) -> dict[str, int]:
    return _serialize(await get_settings_row(session))


@router.put("")
async def update_security_settings(
    payload: SecuritySettingsUpdate,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(SECURITY_MANAGE_SETTINGS))],
) -> dict[str, int]:
    row = await get_settings_row(session)
    old = _serialize(row)
    if payload.setup_link_expiry_hours is not None:
        row.setup_link_expiry_hours = payload.setup_link_expiry_hours
    if payload.lockout_minutes is not None:
        row.lockout_minutes = payload.lockout_minutes
    if payload.inactivity_timeout_minutes is not None:
        row.inactivity_timeout_minutes = payload.inactivity_timeout_minutes
    if payload.absolute_session_hours is not None:
        row.absolute_session_hours = payload.absolute_session_hours
    await record_audit(
        session,
        action="security.settings",
        entity_type="security_settings",
        entity_id="1",
        actor_id=actor.id,
        old_values=old,
        new_values=_serialize(row),
    )
    await session.commit()
    return _serialize(row)
