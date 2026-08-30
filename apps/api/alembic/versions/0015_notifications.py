"""In-app notification center, rules, delivery, and acknowledgement.

Revision ID: 0015_notifications
Revises: 0014_finance_integrity
Create Date: 2026-08-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_notifications"
down_revision: str | Sequence[str] | None = "0014_finance_integrity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("acknowledgement_required", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("activated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "event_type IN ("
            "'operations.application_stage_changed', "
            "'performance.target_status_changed', "
            "'finance.period_status_changed', "
            "'attendance.record_corrected', "
            "'security.user_status_changed')",
            name="notification_rules_event_type_check",
        ),
        sa.CheckConstraint(
            "category IN ('operations', 'performance', 'finance', "
            "'attendance_holiday', 'security_admin', 'system')",
            name="notification_rules_category_check",
        ),
        sa.CheckConstraint(
            "severity IN ('info', 'warning', 'critical', 'urgent')",
            name="notification_rules_severity_check",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'inactive')",
            name="notification_rules_status_check",
        ),
        sa.CheckConstraint(
            "NOT acknowledgement_required OR severity IN ('critical', 'urgent')",
            name="notification_rules_acknowledgement_check",
        ),
    )
    op.create_index(
        "ix_notification_rules_event_status",
        "notification_rules",
        ["event_type", "status"],
    )

    op.create_table(
        "notification_rule_targets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rule_id", sa.Uuid(), sa.ForeignKey("notification_rules.id"), nullable=False),
        sa.Column("target_type", sa.String(length=30), nullable=False),
        sa.Column("user_type_id", sa.Uuid(), sa.ForeignKey("user_types.id"), nullable=True),
        sa.Column("office_id", sa.Uuid(), sa.ForeignKey("offices.id"), nullable=True),
        sa.Column("team_id", sa.Uuid(), sa.ForeignKey("teams.id"), nullable=True),
        sa.CheckConstraint(
            "target_type IN ('affected_user', 'reporting_manager', 'user_type', "
            "'office', 'team', 'company')",
            name="notification_rule_targets_type_check",
        ),
        sa.CheckConstraint(
            "(target_type IN ('affected_user', 'reporting_manager', 'company') "
            "AND user_type_id IS NULL AND office_id IS NULL AND team_id IS NULL) OR "
            "(target_type = 'user_type' AND user_type_id IS NOT NULL "
            "AND office_id IS NULL AND team_id IS NULL) OR "
            "(target_type = 'office' AND office_id IS NOT NULL "
            "AND user_type_id IS NULL AND team_id IS NULL) OR "
            "(target_type = 'team' AND team_id IS NOT NULL "
            "AND user_type_id IS NULL AND office_id IS NULL)",
            name="notification_rule_targets_reference_check",
        ),
    )
    op.create_index(
        "uq_notification_rule_targets_dynamic",
        "notification_rule_targets",
        ["rule_id", "target_type"],
        unique=True,
        postgresql_where=sa.text(
            "target_type IN ('affected_user', 'reporting_manager', 'company')"
        ),
    )
    op.create_index(
        "uq_notification_rule_targets_user_type",
        "notification_rule_targets",
        ["rule_id", "user_type_id"],
        unique=True,
        postgresql_where=sa.text("target_type = 'user_type'"),
    )
    op.create_index(
        "uq_notification_rule_targets_office",
        "notification_rule_targets",
        ["rule_id", "office_id"],
        unique=True,
        postgresql_where=sa.text("target_type = 'office'"),
    )
    op.create_index(
        "uq_notification_rule_targets_team",
        "notification_rule_targets",
        ["rule_id", "team_id"],
        unique=True,
        postgresql_where=sa.text("target_type = 'team'"),
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rule_id", sa.Uuid(), sa.ForeignKey("notification_rules.id"), nullable=True),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("acknowledgement_required", sa.Boolean(), nullable=False),
        sa.Column("source_event_type", sa.String(length=80), nullable=False),
        sa.Column("source_event_key", sa.String(length=300), nullable=False),
        sa.Column("deduplication_key", sa.String(length=700), nullable=False, unique=True),
        sa.Column("linked_entity_type", sa.String(length=60), nullable=True),
        sa.Column("linked_entity_id", sa.String(length=100), nullable=True),
        sa.Column("contextual_link", sa.String(length=300), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "category IN ('operations', 'performance', 'finance', "
            "'attendance_holiday', 'security_admin', 'system')",
            name="notifications_category_check",
        ),
        sa.CheckConstraint(
            "severity IN ('info', 'warning', 'critical', 'urgent')",
            name="notifications_severity_check",
        ),
        sa.CheckConstraint(
            "NOT acknowledgement_required OR severity IN ('critical', 'urgent')",
            name="notifications_acknowledgement_check",
        ),
    )
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])

    op.create_table(
        "notification_deliveries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("notification_id", sa.Uuid(), sa.ForeignKey("notifications.id"), nullable=False),
        sa.Column("recipient_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.UniqueConstraint(
            "notification_id", "recipient_id", name="uq_notification_deliveries_recipient"
        ),
        sa.CheckConstraint(
            "(acknowledged_at IS NULL AND acknowledged_by_id IS NULL) OR "
            "(acknowledged_at IS NOT NULL AND acknowledged_by_id IS NOT NULL)",
            name="notification_deliveries_acknowledgement_check",
        ),
    )
    op.create_index(
        "ix_notification_deliveries_recipient_read",
        "notification_deliveries",
        ["recipient_id", "read_at"],
    )

    permissions = sa.table(
        "permissions",
        sa.column("code", sa.String),
        sa.column("description", sa.String),
    )
    op.bulk_insert(
        permissions,
        [
            {
                "code": "Notifications.View",
                "description": "View and acknowledge own in-app notifications",
            },
            {
                "code": "Notifications.ManageRules",
                "description": "Create and maintain notification rules within visibility scope",
            },
            {
                "code": "Notifications.ViewAudit",
                "description": (
                    "View notification administration and acknowledgement audit in scope"
                ),
            },
        ],
    )


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
