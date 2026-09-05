"""Container startup with explicit, opt-out initialization controls."""

from __future__ import annotations

import subprocess

import uvicorn

from nexa_bos_api.core.config import get_settings


def main() -> None:
    settings = get_settings()
    if settings.run_migrations_on_startup:
        subprocess.run(["alembic", "upgrade", "head"], check=True)
    uvicorn.run("nexa_bos_api.main:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
