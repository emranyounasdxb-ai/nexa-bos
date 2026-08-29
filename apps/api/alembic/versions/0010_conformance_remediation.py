"""Conformance remediation: product measurement, KPI baseline, uniqueness, OWNER singleton.

Revision ID: 0010_conformance_remediation
Revises: 0009_targets_kpi
Create Date: 2026-08-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_conformance_remediation"
down_revision: str | Sequence[str] | None = "0009_targets_kpi"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "target_measurement",
            sa.String(length=20),
            nullable=False,
            server_default="count",
        ),
    )
    op.execute("UPDATE products SET target_measurement = 'amount' WHERE code = 'PF'")
    op.execute("UPDATE products SET target_measurement = 'count' WHERE code = 'CC'")
    op.alter_column("products", "target_measurement", server_default=None)
    op.add_column(
        "kpi_scorecard_metrics",
        sa.Column("baseline", sa.Numeric(18, 2), nullable=True),
    )
    op.create_table(
        "reserved_emails",
        sa.Column("email_normalized", sa.String(length=320), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
    )
    op.create_table(
        "reserved_employee_codes",
        sa.Column("employee_code", sa.String(length=64), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
    )
    op.execute(
        """
        INSERT INTO reserved_emails (email_normalized, user_id)
        SELECT lower(email), id FROM users
        UNION
        SELECT lower(email), user_id FROM user_email_history
        ON CONFLICT (email_normalized) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO reserved_employee_codes (employee_code, user_id)
        SELECT employee_code, id FROM users
        UNION
        SELECT value_label, user_id FROM user_assignment_history
        WHERE field = 'employee_code' AND value_label IS NOT NULL
        ON CONFLICT (employee_code) DO NOTHING
        """
    )
    op.create_table(
        "owner_singleton",
        sa.Column("slot", sa.SmallInteger(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False, unique=True),
    )
    op.execute(
        """
        INSERT INTO owner_singleton (slot, user_id)
        SELECT 1, u.id
        FROM users u
        JOIN user_types t ON t.id = u.user_type_id
        WHERE t.code = 'OWNER'
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
