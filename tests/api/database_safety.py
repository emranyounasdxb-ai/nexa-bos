from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy.engine import make_url

CANONICAL_DATABASE_NAME = "nexa_bos"
CANONICAL_HOST_PORT = 15432
_TEST_DATABASE_PATTERN = re.compile(r"(?:^|_)test(?:_|$)", re.IGNORECASE)


@dataclass(frozen=True)
class SafeTestDatabase:
    database: str
    host: str
    port: int


def validate_test_database_url(database_url: str | None) -> SafeTestDatabase:
    """Fail closed unless DATABASE_URL names an isolated PostgreSQL test database."""
    if database_url is None or not database_url.strip():
        raise RuntimeError("DATABASE_URL must be explicitly set for database-backed tests")

    try:
        url = make_url(database_url)
    except Exception as exc:
        raise RuntimeError("DATABASE_URL is not a valid SQLAlchemy URL") from exc

    if not url.drivername.startswith("postgresql"):
        raise RuntimeError("DATABASE_URL must use PostgreSQL for database-backed tests")

    database = (url.database or "").strip()
    host = (url.host or "").strip()
    port = url.port or 5432
    if not host:
        raise RuntimeError("DATABASE_URL must include an explicit host")
    if port == CANONICAL_HOST_PORT:
        raise RuntimeError(f"DATABASE_URL must not use canonical host port {CANONICAL_HOST_PORT}")
    if database.casefold() == CANONICAL_DATABASE_NAME.casefold():
        raise RuntimeError(
            f"DATABASE_URL must not use canonical database {CANONICAL_DATABASE_NAME!r}"
        )
    if not _TEST_DATABASE_PATTERN.search(database):
        raise RuntimeError("DATABASE_URL database name must contain a distinct 'test' segment")

    return SafeTestDatabase(database=database, host=host, port=port)
