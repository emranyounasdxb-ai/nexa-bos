"""Finance commission, incentive, clawback, and monthly payouts.

Revision ID: 0012_finance_commission
Revises: 0011_kpi_missing_baseline
Create Date: 2026-08-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_finance_commission"
down_revision: str | Sequence[str] | None = "0011_kpi_missing_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PERMISSIONS = (
    ("Finance.View", "View Finance payout periods, statements, and drill-down in reporting scope"),
    ("Finance.GeneratePayout", "Generate monthly Finance payout periods"),
    ("Finance.EditAdjustment", "Create audited Finance adjustments and clawbacks"),
    ("Finance.Review", "Move a Finance payout period to Review"),
    ("Finance.Finalize", "Finalize and lock a reviewed Finance payout period"),
    ("Finance.ReopenPeriod", "Reopen a finalized Finance payout period with a reason"),
    (
        "Finance.ViewCommissionRules",
        "View commission and incentive configuration versions",
    ),
    (
        "Finance.ManageCommissionRules",
        "Create and activate Finance configuration versions",
    ),
)


def upgrade() -> None:
    op.create_table(
        "commission_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("bank_id", sa.Uuid(), sa.ForeignKey("banks.id"), nullable=False),
        sa.Column("product_id", sa.Uuid(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("eligibility_milestone", sa.String(length=20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("payout_mode", sa.String(length=32), nullable=False),
        sa.Column("calculation_method", sa.String(length=32), nullable=True),
        sa.Column("fixed_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("percentage_rate", sa.Numeric(12, 6), nullable=True),
        sa.Column("flat_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("activated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.CheckConstraint("effective_to IS NULL OR effective_to >= effective_from"),
        sa.UniqueConstraint("bank_id", "product_id", "eligibility_milestone", "version"),
    )
    op.create_index(
        "ix_commission_rules_resolution",
        "commission_rules",
        ["bank_id", "product_id", "eligibility_milestone", "status", "effective_from"],
    )
    op.create_table(
        "commission_rule_recipients",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rule_id", sa.Uuid(), sa.ForeignKey("commission_rules.id"), nullable=False),
        sa.Column("role_code", sa.String(length=64), nullable=False),
        sa.Column("role_name", sa.String(length=120), nullable=False),
        sa.Column("recipient_source", sa.String(length=32), nullable=False),
        sa.Column("hierarchy_level", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("split_percent", sa.Numeric(7, 4), nullable=True),
        sa.Column("calculation_method", sa.String(length=32), nullable=True),
        sa.Column("fixed_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("percentage_rate", sa.Numeric(12, 6), nullable=True),
        sa.Column("flat_amount", sa.Numeric(18, 2), nullable=True),
        sa.CheckConstraint("split_percent IS NULL OR (split_percent > 0 AND split_percent <= 100)"),
        sa.CheckConstraint(
            "(recipient_source = 'case_owner' AND hierarchy_level IS NULL) OR "
            "(recipient_source = 'reporting_manager' AND hierarchy_level >= 1)"
        ),
        sa.UniqueConstraint("rule_id", "role_code"),
        sa.UniqueConstraint("rule_id", "sort_order"),
    )
    op.create_index(
        "ix_commission_rule_recipients_rule_id",
        "commission_rule_recipients",
        ["rule_id"],
    )
    op.create_table(
        "commission_rule_slabs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rule_id", sa.Uuid(), sa.ForeignKey("commission_rules.id"), nullable=False),
        sa.Column(
            "recipient_id",
            sa.Uuid(),
            sa.ForeignKey("commission_rule_recipients.id"),
            nullable=True,
        ),
        sa.Column("minimum_eligible", sa.Numeric(18, 2), nullable=False),
        sa.Column("maximum_eligible", sa.Numeric(18, 2), nullable=True),
        sa.Column("payout_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("minimum_eligible >= 0"),
        sa.CheckConstraint("maximum_eligible IS NULL OR maximum_eligible >= minimum_eligible"),
        sa.CheckConstraint("payout_amount >= 0"),
        sa.UniqueConstraint("rule_id", "recipient_id", "sort_order"),
    )
    op.create_index("ix_commission_rule_slabs_rule_id", "commission_rule_slabs", ["rule_id"])
    op.create_table(
        "incentive_plans",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("activated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.CheckConstraint("effective_to IS NULL OR effective_to >= effective_from"),
        sa.UniqueConstraint("name", "version"),
    )
    op.create_table(
        "incentive_slabs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("plan_id", sa.Uuid(), sa.ForeignKey("incentive_plans.id"), nullable=False),
        sa.Column("minimum_production", sa.Numeric(18, 2), nullable=False),
        sa.Column("maximum_production", sa.Numeric(18, 2), nullable=True),
        sa.Column("payout_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("minimum_production >= 0"),
        sa.CheckConstraint(
            "maximum_production IS NULL OR maximum_production >= minimum_production"
        ),
        sa.CheckConstraint("payout_amount >= 0"),
        sa.UniqueConstraint("plan_id", "sort_order"),
    )
    op.create_index("ix_incentive_slabs_plan_id", "incentive_slabs", ["plan_id"])
    op.create_table(
        "finance_payout_periods",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("period_month", sa.Date(), nullable=False, unique=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("generated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finalized_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_table(
        "finance_components",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "period_id", sa.Uuid(), sa.ForeignKey("finance_payout_periods.id"), nullable=False
        ),
        sa.Column("application_id", sa.Uuid(), sa.ForeignKey("applications.id"), nullable=True),
        sa.Column("recipient_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("component_type", sa.String(length=20), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("eligible_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("eligibility_milestone", sa.String(length=20), nullable=True),
        sa.Column("eligibility_event_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("commission_rule_id", sa.Uuid(), sa.ForeignKey("commission_rules.id")),
        sa.Column("incentive_plan_id", sa.Uuid(), sa.ForeignKey("incentive_plans.id")),
        sa.Column(
            "original_component_id",
            sa.Uuid(),
            sa.ForeignKey("finance_components.id"),
            nullable=True,
        ),
        sa.Column("role_code", sa.String(length=64), nullable=True),
        sa.Column("role_name", sa.String(length=120), nullable=True),
        sa.Column("attribution_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("calculation_method", sa.String(length=32), nullable=True),
        sa.Column("calculation_evidence", postgresql.JSONB(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount = round(amount, 2)"),
        sa.CheckConstraint("component_type <> 'clawback' OR amount < 0"),
    )
    op.create_index(
        "ix_finance_components_period_recipient",
        "finance_components",
        ["period_id", "recipient_id"],
    )
    op.create_index(
        "uq_finance_commission_component",
        "finance_components",
        [
            "period_id",
            "application_id",
            "recipient_id",
            "role_code",
            "eligibility_milestone",
        ],
        unique=True,
        postgresql_where=sa.text("component_type = 'commission'"),
    )
    op.create_index(
        "uq_finance_incentive_component",
        "finance_components",
        ["period_id", "recipient_id"],
        unique=True,
        postgresql_where=sa.text("component_type = 'incentive'"),
    )
    op.create_table(
        "finance_payouts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "period_id", sa.Uuid(), sa.ForeignKey("finance_payout_periods.id"), nullable=False
        ),
        sa.Column("recipient_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "previous_payout_id", sa.Uuid(), sa.ForeignKey("finance_payouts.id"), nullable=True
        ),
        sa.Column("previous_carry", sa.Numeric(18, 2), nullable=False),
        sa.Column("commission_total", sa.Numeric(18, 2), nullable=False),
        sa.Column("incentive_total", sa.Numeric(18, 2), nullable=False),
        sa.Column("adjustment_total", sa.Numeric(18, 2), nullable=False),
        sa.Column("clawback_total", sa.Numeric(18, 2), nullable=False),
        sa.Column("gross_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("payable_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("carry_forward", sa.Numeric(18, 2), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("payable_amount >= 0"),
        sa.CheckConstraint("carry_forward <= 0"),
        sa.UniqueConstraint("period_id", "recipient_id"),
    )
    op.create_index("ix_finance_payouts_period_id", "finance_payouts", ["period_id"])
    op.create_table(
        "finance_period_transitions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "period_id", sa.Uuid(), sa.ForeignKey("finance_payout_periods.id"), nullable=False
        ),
        sa.Column("from_status", sa.String(length=20), nullable=True),
        sa.Column("to_status", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_finance_period_transitions_period_id",
        "finance_period_transitions",
        ["period_id"],
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
