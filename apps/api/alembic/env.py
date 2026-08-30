"""Alembic async environment."""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from nexa_bos_api.applications import models as _application_models  # noqa: F401
from nexa_bos_api.attendance import models as _attendance_models  # noqa: F401
from nexa_bos_api.catalog import models as _catalog_models  # noqa: F401
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.customers import models as _customer_models  # noqa: F401
from nexa_bos_api.db.base import Base
from nexa_bos_api.finance import models as _finance_models  # noqa: F401
from nexa_bos_api.identity import models as _identity_models  # noqa: F401
from nexa_bos_api.notifications import models as _notification_models  # noqa: F401
from nexa_bos_api.targets import models as _target_models  # noqa: F401
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    return get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(get_url(), poolclass=pool.NullPool)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
