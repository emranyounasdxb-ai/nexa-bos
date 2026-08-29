"""Deactivate ACTIVE KPI scorecards that lack a required baseline after 0010.

Revision ID: 0011_kpi_missing_baseline
Revises: 0010_conformance_remediation
Create Date: 2026-08-29
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from nexa_bos_api.targets.kpi_baseline_upgrade import DEACTIVATE_ACTIVE_MISSING_BASELINE_SQL

revision: str = "0011_kpi_missing_baseline"
down_revision: str | Sequence[str] | None = "0010_conformance_remediation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(DEACTIVATE_ACTIVE_MISSING_BASELINE_SQL)


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
