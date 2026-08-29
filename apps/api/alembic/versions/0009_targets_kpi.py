"""Targets, target history, period locks, and KPI scorecards.

Revision ID: 0009_targets_kpi
Revises: 0008_attendance_holidays
Create Date: 2026-08-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_targets_kpi"
down_revision: str | Sequence[str] | None = "0008_attendance_holidays"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PERMISSIONS = (
    ("Targets.View", "View targets, KPI scorecards, and target results in reporting scope"),
    ("Targets.Create", "Create targets and KPI scorecards"),
    ("Targets.Edit", "Edit targets and KPI scorecards, and lock target periods"),
    ("Targets.Activate", "Activate targets and KPI scorecards"),
    ("Targets.Deactivate", "Deactivate targets and KPI scorecards"),
    ("Targets.ReopenPeriod", "Reopen a locked target period with a mandatory reason"),
)


def upgrade() -> None:
    op.create_table(
        "performance_targets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("level", sa.String(length=20), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("period_month", sa.Date(), nullable=False),
        sa.Column("product_id", sa.Uuid(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("bank_id", sa.Uuid(), sa.ForeignKey("banks.id"), nullable=True),
        sa.Column("milestone", sa.String(length=20), nullable=False),
        sa.Column("measurement", sa.String(length=20), nullable=False),
        sa.Column("target_value", sa.Numeric(18, 2), nullable=False),
        sa.Column("prorate", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
    )
    op.create_index(
        "uq_targets_active_overall",
        "performance_targets",
        ["level", "entity_id", "period_month", "product_id", "milestone"],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND bank_id IS NULL"),
    )
    op.create_index(
        "uq_targets_active_bank",
        "performance_targets",
        ["level", "entity_id", "period_month", "product_id", "milestone", "bank_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND bank_id IS NOT NULL"),
    )
    op.create_table(
        "target_changes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "target_id",
            sa.Uuid(),
            sa.ForeignKey("performance_targets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("old_values", postgresql.JSONB(), nullable=False),
        sa.Column("new_values", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "target_period_locks",
        sa.Column("period_month", sa.Date(), primary_key=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
    )
    op.create_table(
        "target_period_reopens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("period_month", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "kpi_scorecards",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_kpi_scorecards_active "
        "ON kpi_scorecards ((true)) WHERE status = 'active'"
    )
    op.create_table(
        "kpi_scorecard_metrics",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "scorecard_id",
            sa.Uuid(),
            sa.ForeignKey("kpi_scorecards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("metric_code", sa.String(length=64), nullable=False),
        sa.Column("weight_percent", sa.Numeric(5, 2), nullable=False),
        sa.Column("direction", sa.String(length=32), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.UniqueConstraint("scorecard_id", "metric_code"),
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
