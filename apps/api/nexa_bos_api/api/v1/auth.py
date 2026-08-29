from __future__ import annotations

from typing import Annotated
from uuid import UUID

import pyotp
from fastapi import APIRouter, Depends, Response

from nexa_bos_api.api.v1.deps import CurrentUser, get_optional_session, require_permission
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.auth_service import (
    complete_mfa_login,
    consume_password_token,
    get_settings_row,
    issue_one_time_link,
    login,
    logout,
    public_user,
)
from nexa_bos_api.identity.cookies import clear_session_cookie, set_session_cookie
from nexa_bos_api.identity.enums import AccountStatus, TokenPurpose
from nexa_bos_api.identity.models import Session, User
from nexa_bos_api.identity.owner_setup import bootstrap_status, complete_owner_bootstrap
from nexa_bos_api.identity.permissions import USERS_GENERATE_RESET_LINK, USERS_GENERATE_SETUP_LINK
from nexa_bos_api.identity.schemas import (
    LoginRequest,
    MfaConfirmRequest,
    MfaLoginRequest,
    OwnerBootstrapRequest,
    PasswordSetRequest,
)
from nexa_bos_api.identity.users_service import get_visible_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/bootstrap-status")
async def bootstrap_status_route(session: SessionDep) -> dict[str, bool]:
    return await bootstrap_status(session)


@router.post("/bootstrap")
async def bootstrap_owner(payload: OwnerBootstrapRequest, session: SessionDep) -> dict[str, object]:
    user = await complete_owner_bootstrap(session, payload)
    return public_user(user)


@router.post("/login")
async def login_route(
    payload: LoginRequest, session: SessionDep, response: Response
) -> dict[str, object]:
    user, token, csrf, mfa_token = await login(session, str(payload.email), payload.password)
    if mfa_token:
        return {"mfaRequired": True, "mfaToken": mfa_token, "userId": str(user.id)}
    settings = get_settings()
    sec = await get_settings_row(session)
    set_session_cookie(response, token, settings, max_age=sec.absolute_session_hours * 3600)
    return {"user": public_user(user), "csrfToken": csrf, "mfaRequired": False}


@router.post("/mfa/login")
async def mfa_login_route(
    payload: MfaLoginRequest, session: SessionDep, response: Response
) -> dict[str, object]:
    user, token, csrf = await complete_mfa_login(session, payload.token, payload.code)
    settings = get_settings()
    sec = await get_settings_row(session)
    set_session_cookie(response, token, settings, max_age=sec.absolute_session_hours * 3600)
    return {"user": public_user(user), "csrfToken": csrf, "mfaRequired": False}


@router.post("/logout")
async def logout_route(
    user: CurrentUser, session: SessionDep, response: Response
) -> dict[str, str]:
    await logout(session, user)
    clear_session_cookie(response, get_settings())
    return {"status": "ok"}


@router.get("/me")
async def me_route(
    user: CurrentUser,
    resolved: Annotated[tuple[User, Session] | None, Depends(get_optional_session)],
) -> dict[str, object]:
    if resolved is None:
        raise AppError(status_code=401, code="UNAUTHENTICATED", message="Authentication required")
    _user, row = resolved
    return public_user(user, csrf_token=row.csrf_token)


@router.post("/setup")
async def setup_password(payload: PasswordSetRequest, session: SessionDep) -> dict[str, str]:
    await consume_password_token(
        session, raw_token=payload.token, password=payload.password, purpose=TokenPurpose.SETUP
    )
    return {"status": "ok"}


@router.post("/reset")
async def reset_password(payload: PasswordSetRequest, session: SessionDep) -> dict[str, str]:
    await consume_password_token(
        session, raw_token=payload.token, password=payload.password, purpose=TokenPurpose.RESET
    )
    return {"status": "ok"}


@router.post("/users/{user_id}/setup-link")
async def setup_link(
    user_id: str,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_GENERATE_SETUP_LINK))],
) -> dict[str, str]:
    target = await get_visible_user(session, actor, UUID(user_id))
    if target.account_status != AccountStatus.ACTIVE:
        raise AppError(
            status_code=422,
            code="USER_NOT_ACTIVE",
            message="Activate the user before generating a setup link",
        )
    return await issue_one_time_link(
        session,
        actor=actor,
        target=target,
        purpose=TokenPurpose.SETUP,
        web_origin=get_settings().web_origin,
    )


@router.post("/users/{user_id}/reset-link")
async def reset_link(
    user_id: str,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(USERS_GENERATE_RESET_LINK))],
) -> dict[str, str]:
    target = await get_visible_user(session, actor, UUID(user_id))
    return await issue_one_time_link(
        session,
        actor=actor,
        target=target,
        purpose=TokenPurpose.RESET,
        web_origin=get_settings().web_origin,
    )


@router.post("/mfa/setup")
async def mfa_setup(user: CurrentUser, session: SessionDep) -> dict[str, str]:
    secret = pyotp.random_base32()
    user.mfa_secret = secret
    user.mfa_enabled = False
    await record_audit(
        session,
        action="auth.mfa_setup",
        entity_type="user",
        entity_id=str(user.id),
        actor_id=user.id,
        target_user_id=user.id,
    )
    await session.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="NEXA BOS")
    return {"secret": secret, "otpauthUrl": uri}


@router.post("/mfa/confirm")
async def mfa_confirm(
    payload: MfaConfirmRequest, user: CurrentUser, session: SessionDep
) -> dict[str, str]:
    if not user.mfa_secret:
        raise AppError(status_code=422, code="MFA_NOT_STARTED", message="Start MFA setup first")
    if not pyotp.TOTP(user.mfa_secret).verify(payload.code, valid_window=1):
        raise AppError(status_code=422, code="MFA_INVALID", message="Invalid authenticator code")
    user.mfa_enabled = True
    await record_audit(
        session,
        action="auth.mfa_enable",
        entity_type="user",
        entity_id=str(user.id),
        actor_id=user.id,
        target_user_id=user.id,
    )
    await session.commit()
    return {"status": "ok"}


@router.post("/mfa/disable")
async def mfa_disable(user: CurrentUser, session: SessionDep) -> dict[str, str]:
    user.mfa_enabled = False
    user.mfa_secret = None
    await record_audit(
        session,
        action="auth.mfa_disable",
        entity_type="user",
        entity_id=str(user.id),
        actor_id=user.id,
        target_user_id=user.id,
    )
    await session.commit()
    return {"status": "ok"}
