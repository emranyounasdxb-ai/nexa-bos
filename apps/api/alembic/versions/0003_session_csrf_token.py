"""Persist session CSRF token for stable /auth/me.

Revision ID: 0003_session_csrf_token
Revises: 0002_user_management
Create Date: 2026-08-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_session_csrf_token"
down_revision: str | Sequence[str] | None = "0002_user_management"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("csrf_token", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("sessions", "csrf_token")
