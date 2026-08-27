from __future__ import annotations

import hashlib
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from nexa_bos_api.core.exceptions import AppError

_HASHER = PasswordHasher()
_SPECIAL = re.compile(r"[^A-Za-z0-9]")


def validate_password_policy(password: str) -> None:
    if (
        not re.search(r"[a-z]", password)
        or not re.search(r"[A-Z]", password)
        or not re.search(r"[0-9]", password)
        or not _SPECIAL.search(password)
    ):
        raise AppError(
            status_code=422,
            code="PASSWORD_POLICY",
            message=("Password must contain lowercase, uppercase, number, and special character"),
        )


def hash_password(password: str) -> str:
    return _HASHER.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _HASHER.verify(password_hash, password)
    except VerifyMismatchError, InvalidHashError:
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
