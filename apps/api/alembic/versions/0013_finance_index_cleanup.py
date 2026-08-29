"""Remove redundant Finance foreign-key indexes.

Revision ID: 0013_finance_index_cleanup
Revises: 0012_finance_commission
Create Date: 2026-08-30
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0013_finance_index_cleanup"
down_revision: str | Sequence[str] | None = "0012_finance_commission"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Each column remains covered as the leading column of an existing unique
    # B-tree index, so retaining a second single-column index only adds write
    # and storage overhead without changing any Finance invariant.
    op.drop_index(
        "ix_commission_rule_recipients_rule_id",
        table_name="commission_rule_recipients",
    )
    op.drop_index(
        "ix_commission_rule_slabs_rule_id",
        table_name="commission_rule_slabs",
    )
    op.drop_index("ix_incentive_slabs_plan_id", table_name="incentive_slabs")
    op.drop_index("ix_finance_payouts_period_id", table_name="finance_payouts")


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
