from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from nexa_bos_api.core.config import CSRF_HEADER_NAME, SESSION_COOKIE_NAME
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.auth_service import csrf_matches, resolve_session
from nexa_bos_api.identity.models import Session, User

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_EXEMPT_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/setup",
    "/api/v1/auth/reset",
    "/api/v1/auth/bootstrap",
}


async def get_optional_session(
    request: Request, session: SessionDep
) -> tuple[User, Session] | None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    resolved = await resolve_session(session, token)
    if resolved is None:
        return None
    return resolved


async def get_current_user(
    request: Request,
    resolved: Annotated[tuple[User, Session] | None, Depends(get_optional_session)],
) -> User:
    if resolved is None:
        raise AppError(status_code=401, code="UNAUTHENTICATED", message="Authentication required")
    user, row = resolved
    if request.method.upper() not in SAFE_METHODS and request.url.path not in CSRF_EXEMPT_PATHS:
        csrf = request.headers.get(CSRF_HEADER_NAME)
        if not csrf_matches(row, csrf):
            raise AppError(
                status_code=403,
                code="CSRF_INVALID",
                message="CSRF token is missing or invalid",
            )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_permission(code: str):
    async def checker(user: CurrentUser) -> User:
        if not has_permission(user, code):
            raise AppError(
                status_code=403,
                code="FORBIDDEN",
                message="You do not have permission to perform this action",
                details=[{"permission": code}],
            )
        return user

    return checker
