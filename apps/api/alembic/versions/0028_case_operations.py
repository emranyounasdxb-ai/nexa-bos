"""Configurable case operations, routing, earnings, and clawbacks.

Revision ID: 0028_case_operations
Revises: 0027_org_business_units
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0028_case_operations"
down_revision = "0027_org_business_units"
branch_labels = None
depends_on = None

PERMISSIONS = (
    ("CaseOperations.ViewRules", "View effective-dated card point and PF commission rules"),
    ("CaseOperations.ManageRules", "Manage effective-dated card point and PF commission rules"),
    ("CaseOperations.ViewRouting", "View Office and Product Lane routing assignments"),
    ("CaseOperations.ManageRouting", "Manage Office and Product Lane routing assignments"),
    ("CaseOperations.SubmitClawback", "Submit case earning clawbacks"),
    ("CaseOperations.ApproveClawback", "Approve or reject case earning clawbacks"),
    ("CaseOperations.StageCsv", "Validate and import scoped case stage CSV files"),
    ("CaseOperations.ViewReports", "View operational case and employee performance reports"),
    ("CaseOperations.ExportReports", "Export authorized operational case reports"),
)

ROLE_GRANTS = {
    "GM": (
        "CaseOperations.ViewRules",
        "CaseOperations.ManageRules",
        "CaseOperations.ViewRouting",
        "CaseOperations.ManageRouting",
        "CaseOperations.ApproveClawback",
        "CaseOperations.ViewReports",
        "CaseOperations.ExportReports",
    ),
    "BDM": (
        "CaseOperations.ViewRules",
        "CaseOperations.ViewRouting",
        "CaseOperations.ViewReports",
        "CaseOperations.ExportReports",
    ),
    "SM": (
        "CaseOperations.ViewRules",
        "CaseOperations.ViewRouting",
        "CaseOperations.ApproveClawback",
        "CaseOperations.ViewReports",
        "CaseOperations.ExportReports",
    ),
    "COD": (
        "CaseOperations.ViewRules",
        "CaseOperations.ViewRouting",
        "CaseOperations.SubmitClawback",
        "CaseOperations.StageCsv",
        "CaseOperations.ViewReports",
        "CaseOperations.ExportReports",
    ),
    "TL": ("CaseOperations.ViewRouting", "CaseOperations.ViewReports"),
    "SE": ("CaseOperations.ViewReports",),
}


def upgrade():
    op.add_column("workflow_stages", sa.Column("timeframe_seconds", sa.Integer(), nullable=True))
    op.add_column(
        "workflow_stages",
        sa.Column("is_successful", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_check_constraint(
        "workflow_stages_timeframe_check",
        "workflow_stages",
        "timeframe_seconds IS NULL OR timeframe_seconds > 0",
    )
    op.execute("UPDATE workflow_stages SET is_successful = true WHERE system_key = 'fund_released'")

    op.add_column("applications", sa.Column("processing_office_id", sa.Uuid(), nullable=True))
    op.add_column("applications", sa.Column("routed_sales_manager_id", sa.Uuid(), nullable=True))
    op.add_column("applications", sa.Column("routed_coordinator_id", sa.Uuid(), nullable=True))
    op.add_column("applications", sa.Column("booked_by_tl_id", sa.Uuid(), nullable=True))
    op.add_column("applications", sa.Column("routing_status", sa.String(32), nullable=True))
    op.add_column(
        "applications", sa.Column("sales_manager_approved_at", sa.DateTime(timezone=True))
    )
    op.add_column("applications", sa.Column("sales_manager_approved_by_id", sa.Uuid()))
    for column, target in (
        ("processing_office_id", "offices"),
        ("routed_sales_manager_id", "users"),
        ("routed_coordinator_id", "users"),
        ("booked_by_tl_id", "users"),
        ("sales_manager_approved_by_id", "users"),
    ):
        op.create_foreign_key(f"fk_applications_{column}", "applications", target, [column], ["id"])

    op.add_column("commission_rules", sa.Column("product_variant_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_commission_rules_product_variant_id",
        "commission_rules",
        "product_variants",
        ["product_variant_id"],
        ["id"],
    )
    op.drop_constraint(
        "commission_rules_bank_id_product_id_eligibility_milestone_v_key",
        "commission_rules",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_commission_rules_lane_variant_milestone_version",
        "commission_rules",
        ["bank_id", "product_id", "product_variant_id", "eligibility_milestone", "version"],
        postgresql_nulls_not_distinct=True,
    )
    op.drop_index("ix_commission_rules_resolution", table_name="commission_rules")
    op.create_index(
        "ix_commission_rules_resolution",
        "commission_rules",
        [
            "bank_id",
            "product_id",
            "product_variant_id",
            "eligibility_milestone",
            "status",
            "effective_from",
        ],
    )

    op.create_table(
        "card_point_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("bank_id", sa.Uuid(), sa.ForeignKey("banks.id"), nullable=False),
        sa.Column(
            "product_variant_id",
            sa.Uuid(),
            sa.ForeignKey("product_variants.id"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("points", sa.Numeric(12, 2), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date()),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True)),
        sa.Column("activated_by_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.UniqueConstraint("bank_id", "product_variant_id", "version"),
        sa.CheckConstraint("points >= 0", name="card_point_rules_points_check"),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from",
            name="card_point_rules_effective_dates_check",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'inactive')", name="card_point_rules_status_check"
        ),
    )
    op.create_index(
        "ix_card_point_rules_resolution",
        "card_point_rules",
        ["bank_id", "product_variant_id", "status", "effective_from"],
    )
    op.create_table(
        "lane_routing_assignments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("office_id", sa.Uuid(), sa.ForeignKey("offices.id"), nullable=False),
        sa.Column("product_id", sa.Uuid(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("sales_manager_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("coordinator_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.UniqueConstraint("office_id", "product_id"),
        sa.CheckConstraint(
            "status IN ('active', 'inactive')", name="lane_routing_assignments_status_check"
        ),
    )
    op.create_table(
        "case_earnings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("application_id", sa.Uuid(), sa.ForeignKey("applications.id"), nullable=False),
        sa.Column("case_owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("earning_type", sa.String(24), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("card_point_rule_id", sa.Uuid(), sa.ForeignKey("card_point_rules.id")),
        sa.Column("commission_rule_id", sa.Uuid(), sa.ForeignKey("commission_rules.id")),
        sa.Column(
            "source_event_id", sa.Uuid(), sa.ForeignKey("application_events.id"), nullable=False
        ),
        sa.Column("rule_snapshot", JSONB(), nullable=False),
        sa.Column("earned_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("application_id", "earning_type"),
        sa.CheckConstraint("amount >= 0", name="case_earnings_amount_check"),
        sa.CheckConstraint(
            "earning_type IN ('card_points', 'pf_commission')", name="case_earnings_type_check"
        ),
    )
    op.create_index("ix_case_earnings_application_id", "case_earnings", ["application_id"])
    op.create_table(
        "case_clawback_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("earning_id", sa.Uuid(), sa.ForeignKey("case_earnings.id"), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("submitted_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_by_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("decision_reason", sa.Text()),
        sa.CheckConstraint("amount > 0", name="case_clawback_requests_amount_check"),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="case_clawback_requests_status_check",
        ),
    )
    op.create_index(
        "ix_case_clawback_requests_earning_id", "case_clawback_requests", ["earning_id"]
    )
    op.create_index(
        "uq_case_clawback_active_request",
        "case_clawback_requests",
        ["earning_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_table(
        "case_earning_reversals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("earning_id", sa.Uuid(), sa.ForeignKey("case_earnings.id"), nullable=False),
        sa.Column(
            "clawback_request_id",
            sa.Uuid(),
            sa.ForeignKey("case_clawback_requests.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("approved_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="case_earning_reversals_amount_check"),
    )
    op.create_index(
        "ix_case_earning_reversals_earning_id", "case_earning_reversals", ["earning_id"]
    )
    op.create_table(
        "case_overdue_notification_dispatches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("application_id", sa.Uuid(), sa.ForeignKey("applications.id"), nullable=False),
        sa.Column(
            "occupancy_id",
            sa.Uuid(),
            sa.ForeignKey("application_stage_occupancies.id"),
            nullable=False,
        ),
        sa.Column("recipient_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reminder_date", sa.Date(), nullable=False),
        sa.Column("notification_id", sa.Uuid(), sa.ForeignKey("notifications.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("occupancy_id", "recipient_id", "reminder_date"),
    )
    op.create_index(
        "ix_case_overdue_dispatch_application_id",
        "case_overdue_notification_dispatches",
        ["application_id"],
    )

    permission_table = sa.table(
        "permissions", sa.column("code", sa.String()), sa.column("description", sa.String())
    )
    op.bulk_insert(
        permission_table,
        [{"code": code, "description": description} for code, description in PERMISSIONS],
    )
    for role, permissions in ROLE_GRANTS.items():
        for permission in permissions:
            op.execute(
                sa.text(
                    "INSERT INTO user_type_permissions (id, user_type_id, permission_code) "
                    "SELECT gen_random_uuid(), id, :permission FROM user_types WHERE code = :role "
                    "ON CONFLICT DO NOTHING"
                ).bindparams(permission=permission, role=role)
            )
    for code, _ in PERMISSIONS:
        op.execute(
            sa.text(
                "INSERT INTO user_type_permissions (id, user_type_id, permission_code) "
                "SELECT gen_random_uuid(), id, :permission FROM user_types WHERE code = 'OWNER' "
                "ON CONFLICT DO NOTHING"
            ).bindparams(permission=code)
        )


def downgrade():
    for code, _ in PERMISSIONS:
        op.execute(
            sa.text(
                "DELETE FROM user_type_permissions WHERE permission_code = :permission"
            ).bindparams(permission=code)
        )
    op.execute(
        sa.text("DELETE FROM permissions WHERE code IN :codes").bindparams(
            sa.bindparam("codes", expanding=True), codes=[code for code, _ in PERMISSIONS]
        )
    )
    op.drop_table("case_overdue_notification_dispatches")
    op.drop_table("case_earning_reversals")
    op.drop_table("case_clawback_requests")
    op.drop_table("case_earnings")
    op.drop_table("lane_routing_assignments")
    op.drop_table("card_point_rules")
    op.drop_index("ix_commission_rules_resolution", table_name="commission_rules")
    op.drop_constraint(
        "uq_commission_rules_lane_variant_milestone_version",
        "commission_rules",
        type_="unique",
    )
    op.create_unique_constraint(
        "commission_rules_bank_id_product_id_eligibility_milestone_v_key",
        "commission_rules",
        ["bank_id", "product_id", "eligibility_milestone", "version"],
    )
    op.create_index(
        "ix_commission_rules_resolution",
        "commission_rules",
        ["bank_id", "product_id", "eligibility_milestone", "status", "effective_from"],
    )
    op.drop_constraint(
        "fk_commission_rules_product_variant_id", "commission_rules", type_="foreignkey"
    )
    op.drop_column("commission_rules", "product_variant_id")
    for column in (
        "sales_manager_approved_by_id",
        "booked_by_tl_id",
        "routed_coordinator_id",
        "routed_sales_manager_id",
        "processing_office_id",
    ):
        op.drop_constraint(f"fk_applications_{column}", "applications", type_="foreignkey")
    for column in (
        "sales_manager_approved_by_id",
        "sales_manager_approved_at",
        "routing_status",
        "booked_by_tl_id",
        "routed_coordinator_id",
        "routed_sales_manager_id",
        "processing_office_id",
    ):
        op.drop_column("applications", column)
    op.drop_constraint("workflow_stages_timeframe_check", "workflow_stages", type_="check")
    op.drop_column("workflow_stages", "is_successful")
    op.drop_column("workflow_stages", "timeframe_seconds")
