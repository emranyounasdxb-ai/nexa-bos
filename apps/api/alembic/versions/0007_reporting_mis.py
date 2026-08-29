"""Performance / MIS reporting scope and permissions.

Revision ID: 0007_reporting_mis
Revises: 0006_tat_delay_engine
Create Date: 2026-08-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_reporting_mis"
down_revision: str | Sequence[str] | None = "0006_tat_delay_engine"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PERMISSIONS = (
    ("Dashboard.View", "View the Performance / MIS dashboard within assigned reporting scope"),
    ("Reports.View", "View reports, rankings, comparisons, and employee performance profiles"),
    ("Reports.ExportExcel", "Export reports to Excel"),
    ("Reports.ExportPDF", "Export reports to PDF"),
    ("Reports.Print", "Print reports"),
)


def upgrade() -> None:
    op.add_column(
        "user_types",
        sa.Column("reporting_visibility_scope", sa.String(length=20), nullable=True),
    )
    op.execute(
        sa.text("UPDATE user_types SET reporting_visibility_scope = 'company' WHERE code = 'OWNER'")
    )
    permissions = sa.table(
        "permissions",
        sa.column("code", sa.String),
        sa.column("description", sa.String),
    )
    op.bulk_insert(
        permissions,
        [{"code": code, "description": description} for code, description in _PERMISSIONS],
    )


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
