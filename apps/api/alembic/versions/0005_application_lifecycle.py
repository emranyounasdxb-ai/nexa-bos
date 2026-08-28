"""Application master, workflow, and Case Owner visibility.

Revision ID: 0005_application_lifecycle
Revises: 0004_customer_masters
Create Date: 2026-08-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_application_lifecycle"
down_revision: str | Sequence[str] | None = "0004_customer_masters"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_types",
        sa.Column("application_visibility_scope", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "user_types",
        sa.Column("can_be_case_owner", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "products",
        sa.Column(
            "requested_amount_required", sa.Boolean(), nullable=False, server_default="false"
        ),
    )
    op.add_column(
        "products",
        sa.Column("approved_amount_required", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "products",
        sa.Column("booked_amount_required", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "products",
        sa.Column("funded_amount_required", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_table(
        "application_code_counters",
        sa.Column("product_code", sa.String(length=32), nullable=False),
        sa.Column("bank_code", sa.String(length=32), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("last_value", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("product_code", "bank_code", "year"),
    )
    op.create_table(
        "workflows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("bank_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["bank_id"], ["banks.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bank_id", "product_id", "version"),
    )
    op.create_table(
        "workflow_stages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workflow_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("system_key", sa.String(length=64), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_stages_workflow_id", "workflow_stages", ["workflow_id"])
    op.create_table(
        "workflow_transitions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workflow_id", sa.Uuid(), nullable=False),
        sa.Column("from_stage_id", sa.Uuid(), nullable=False),
        sa.Column("to_stage_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["from_stage_id"], ["workflow_stages.id"]),
        sa.ForeignKeyConstraint(["to_stage_id"], ["workflow_stages.id"]),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workflow_id", "from_stage_id", "to_stage_id"),
    )
    op.create_index("ix_workflow_transitions_workflow_id", "workflow_transitions", ["workflow_id"])
    op.create_table(
        "applications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("application_code", sa.String(length=48), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("bank_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("workflow_id", sa.Uuid(), nullable=False),
        sa.Column("current_stage_id", sa.Uuid(), nullable=False),
        sa.Column("terminal_outcome", sa.String(length=32), nullable=True),
        sa.Column("terminal_reason", sa.Text(), nullable=True),
        sa.Column("case_owner_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("requested_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("approved_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("booked_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("funded_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("bank_case_number", sa.String(length=64), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_by_id", sa.Uuid(), nullable=True),
        sa.Column("submitted_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("booked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fund_released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["bank_id"], ["banks.id"]),
        sa.ForeignKeyConstraint(["case_owner_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["current_stage_id"], ["workflow_stages.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["submitted_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("application_code"),
    )
    op.create_index("ix_applications_customer_id", "applications", ["customer_id"])
    op.create_index("ix_applications_case_owner_id", "applications", ["case_owner_id"])
    op.create_index(
        "uq_applications_active_customer_bank_product",
        "applications",
        ["customer_id", "bank_id", "product_id"],
        unique=True,
        postgresql_where=sa.text("terminal_outcome IS NULL"),
    )
    op.create_index(
        "uq_applications_bank_case_number",
        "applications",
        ["bank_id", "bank_case_number"],
        unique=True,
        postgresql_where=sa.text("bank_case_number IS NOT NULL"),
    )
    op.create_table(
        "application_owner_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("office_id", sa.Uuid(), nullable=True),
        sa.Column("department_id", sa.Uuid(), nullable=True),
        sa.Column("team_id", sa.Uuid(), nullable=True),
        sa.Column("office_name", sa.String(length=120), nullable=True),
        sa.Column("department_name", sa.String(length=120), nullable=True),
        sa.Column("team_name", sa.String(length=120), nullable=True),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"]),
        sa.ForeignKeyConstraint(["office_id"], ["offices.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_application_owner_history_application_id",
        "application_owner_history",
        ["application_id"],
    )
    op.create_table(
        "application_case_number_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=False),
        sa.Column("value", sa.String(length=64), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("changed_by_id", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["changed_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_application_case_number_history_application_id",
        "application_case_number_history",
        ["application_id"],
    )
    op.create_table(
        "application_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("previous_stage_id", sa.Uuid(), nullable=True),
        sa.Column("new_stage_id", sa.Uuid(), nullable=True),
        sa.Column("bank_stage_date", sa.Date(), nullable=True),
        sa.Column("stage_note", sa.Text(), nullable=True),
        sa.Column("bos_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("correction_of_event_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["correction_of_event_id"], ["application_events.id"]),
        sa.ForeignKeyConstraint(["new_stage_id"], ["workflow_stages.id"]),
        sa.ForeignKeyConstraint(["previous_stage_id"], ["workflow_stages.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_application_events_application_id", "application_events", ["application_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_application_events_application_id", table_name="application_events")
    op.drop_table("application_events")
    op.drop_index(
        "ix_application_case_number_history_application_id",
        table_name="application_case_number_history",
    )
    op.drop_table("application_case_number_history")
    op.drop_index(
        "ix_application_owner_history_application_id", table_name="application_owner_history"
    )
    op.drop_table("application_owner_history")
    op.drop_index("uq_applications_bank_case_number", table_name="applications")
    op.drop_index("uq_applications_active_customer_bank_product", table_name="applications")
    op.drop_index("ix_applications_case_owner_id", table_name="applications")
    op.drop_index("ix_applications_customer_id", table_name="applications")
    op.drop_table("applications")
    op.drop_index("ix_workflow_transitions_workflow_id", table_name="workflow_transitions")
    op.drop_table("workflow_transitions")
    op.drop_index("ix_workflow_stages_workflow_id", table_name="workflow_stages")
    op.drop_table("workflow_stages")
    op.drop_table("workflows")
    op.drop_table("application_code_counters")
    op.drop_column("products", "funded_amount_required")
    op.drop_column("products", "booked_amount_required")
    op.drop_column("products", "approved_amount_required")
    op.drop_column("products", "requested_amount_required")
    op.drop_column("user_types", "can_be_case_owner")
    op.drop_column("user_types", "application_visibility_scope")
