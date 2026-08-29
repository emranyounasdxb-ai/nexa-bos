"""Add database-level Finance domain and sign integrity.

Revision ID: 0014_finance_integrity
Revises: 0013_finance_index_cleanup
Create Date: 2026-08-30
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0014_finance_integrity"
down_revision: str | Sequence[str] | None = "0013_finance_index_cleanup"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_check_constraint(
        "commission_rules_eligibility_milestone_check",
        "commission_rules",
        "eligibility_milestone IN ('booked', 'funded')",
    )
    op.create_check_constraint(
        "commission_rules_status_check",
        "commission_rules",
        "status IN ('draft', 'active', 'inactive')",
    )
    op.create_check_constraint(
        "commission_rules_payout_mode_check",
        "commission_rules",
        "payout_mode IN ('percentage_split', 'independent_role_rate')",
    )
    op.create_check_constraint(
        "commission_rules_calculation_method_check",
        "commission_rules",
        "calculation_method IS NULL OR calculation_method IN "
        "('fixed', 'percentage', 'slab', 'flat_percentage')",
    )
    op.create_check_constraint(
        "commission_rule_recipients_source_check",
        "commission_rule_recipients",
        "recipient_source IN ('case_owner', 'reporting_manager')",
    )
    op.create_check_constraint(
        "commission_rule_recipients_calculation_method_check",
        "commission_rule_recipients",
        "calculation_method IS NULL OR calculation_method IN "
        "('fixed', 'percentage', 'slab', 'flat_percentage')",
    )
    op.create_check_constraint(
        "incentive_plans_status_check",
        "incentive_plans",
        "status IN ('draft', 'active', 'inactive')",
    )
    op.create_check_constraint(
        "finance_payout_periods_status_check",
        "finance_payout_periods",
        "status IN ('draft', 'review', 'finalized')",
    )
    op.create_check_constraint(
        "finance_payout_periods_month_start_check",
        "finance_payout_periods",
        "EXTRACT(DAY FROM period_month) = 1",
    )
    op.create_check_constraint(
        "finance_components_type_check",
        "finance_components",
        "component_type IN ('commission', 'incentive', 'clawback', 'adjustment')",
    )
    op.create_check_constraint(
        "finance_components_non_negative_earned_check",
        "finance_components",
        "component_type NOT IN ('commission', 'incentive') OR amount >= 0",
    )
    op.create_check_constraint(
        "finance_components_eligibility_milestone_check",
        "finance_components",
        "eligibility_milestone IS NULL OR eligibility_milestone IN ('booked', 'funded')",
    )
    op.create_check_constraint(
        "finance_components_calculation_method_check",
        "finance_components",
        "calculation_method IS NULL OR calculation_method IN "
        "('fixed', 'percentage', 'slab', 'flat_percentage')",
    )
    op.create_check_constraint(
        "finance_period_transitions_from_status_check",
        "finance_period_transitions",
        "from_status IS NULL OR from_status IN ('draft', 'review', 'finalized')",
    )
    op.create_check_constraint(
        "finance_period_transitions_to_status_check",
        "finance_period_transitions",
        "to_status IN ('draft', 'review', 'finalized')",
    )


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
