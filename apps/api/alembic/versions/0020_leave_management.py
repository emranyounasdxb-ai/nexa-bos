"""Phase 2 employee leave management.

Revision ID: 0020_leave_management
Revises: 0019_employee_profiles
Create Date: 2026-09-10
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020_leave_management"
down_revision: str | Sequence[str] | None = "0019_employee_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


PERMISSIONS = {
    "Leave.View": "View leave records within approved own or reporting-manager scope",
    "Leave.Request": "Create and edit own draft or returned leave requests",
    "Leave.CreateForEmployee": "Create leave requests for an employee in User scope",
    "Leave.Edit": "Edit employee draft or returned leave requests in User scope",
    "Leave.ApproveManager": "Approve assigned direct-report leave as reporting manager",
    "Leave.ApproveHR": "Complete HR approval for leave requests",
    "Leave.ReturnReject": "Return or reject leave requests with a reason",
    "Leave.Cancel": "Request or approve leave cancellation",
    "Leave.History": "View immutable leave history within approved scope",
    "Leave.Settings": "Configure leave types, entitlements, and balance adjustments",
    "Leave.Override": "Override leave controls with an audited mandatory reason",
}

BASE_EMPLOYEE = ("Leave.View", "Leave.Request", "Leave.Cancel", "Leave.History")
MANAGER = BASE_EMPLOYEE + ("Leave.ApproveManager", "Leave.ReturnReject")
HR = (
    "Leave.View",
    "Leave.CreateForEmployee",
    "Leave.Edit",
    "Leave.ApproveHR",
    "Leave.ReturnReject",
    "Leave.Cancel",
    "Leave.History",
    "Leave.Settings",
)


def _grant(role_code: str, permission_codes: tuple[str, ...]) -> None:
    for permission_code in permission_codes:
        op.execute(
            sa.text(
                "INSERT INTO user_type_permissions (id, user_type_id, permission_code) "
                "SELECT :id, id, :permission_code FROM user_types WHERE code = :role_code "
                "ON CONFLICT (user_type_id, permission_code) DO NOTHING"
            ).bindparams(id=uuid.uuid4(), role_code=role_code, permission_code=permission_code)
        )


def upgrade() -> None:
    op.add_column(
        "leave_types",
        sa.Column("is_paid", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.add_column("leave_types", sa.Column("eligibility", sa.Text(), nullable=True))
    op.add_column(
        "leave_types",
        sa.Column("yearly_entitlement", sa.Numeric(8, 2), server_default="0", nullable=False),
    )
    op.add_column(
        "leave_types",
        sa.Column("accrual_method", sa.String(20), server_default="none", nullable=False),
    )
    op.add_column(
        "leave_types",
        sa.Column("monthly_accrual", sa.Numeric(8, 2), server_default="0", nullable=False),
    )
    op.add_column(
        "leave_types",
        sa.Column("carry_forward_limit", sa.Numeric(8, 2), server_default="0", nullable=False),
    )
    op.add_column(
        "leave_types",
        sa.Column("carry_forward_expiry_months", sa.Integer(), nullable=True),
    )
    op.add_column(
        "leave_types",
        sa.Column("half_day_allowed", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "leave_types",
        sa.Column("attachment_required", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_check_constraint(
        "ck_leave_types_entitlement_nonnegative", "leave_types", "yearly_entitlement >= 0"
    )
    op.create_check_constraint(
        "ck_leave_types_accrual_nonnegative", "leave_types", "monthly_accrual >= 0"
    )
    op.create_check_constraint(
        "ck_leave_types_carry_nonnegative", "leave_types", "carry_forward_limit >= 0"
    )
    op.create_check_constraint(
        "ck_leave_types_accrual_method", "leave_types", "accrual_method IN ('none', 'monthly')"
    )

    op.create_table(
        "leave_balance_adjustments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("leave_type_id", sa.Uuid(), sa.ForeignKey("leave_types.id"), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(8, 2), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("expires_on", sa.Date(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount <> 0", name="ck_leave_balance_adjustment_nonzero"),
    )
    op.create_table(
        "leave_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("leave_type_id", sa.Uuid(), sa.ForeignKey("leave_types.id"), nullable=False),
        sa.Column("requested_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("portion", sa.String(20), nullable=False),
        sa.Column("working_days", sa.Numeric(8, 2), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("exception_reason", sa.Text(), nullable=True),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column("cancellation_manager_approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("manager_approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hr_approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lock_version", sa.Integer(), server_default="1", nullable=False),
        sa.CheckConstraint("end_date >= start_date", name="ck_leave_request_date_order"),
        sa.CheckConstraint("working_days > 0", name="ck_leave_request_working_days_positive"),
        sa.CheckConstraint("lock_version > 0", name="ck_leave_request_lock_version_positive"),
    )
    op.create_index(
        "ix_leave_requests_employee_dates",
        "leave_requests",
        ["employee_id", "start_date", "end_date"],
    )
    op.create_index("ix_leave_requests_status", "leave_requests", ["status"])
    op.create_table(
        "leave_request_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "request_id",
            sa.Uuid(),
            sa.ForeignKey("leave_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("from_status", sa.String(32), nullable=True),
        sa.Column("to_status", sa.String(32), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "leave_attachments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "request_id",
            sa.Uuid(),
            sa.ForeignKey("leave_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("storage_key", sa.String(255), nullable=False, unique=True),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(80), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("uploaded_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("replacement_reason", sa.Text(), nullable=True),
        sa.UniqueConstraint("request_id", "version", name="uq_leave_attachment_version"),
    )

    for code, description in PERMISSIONS.items():
        op.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code, :description) "
                "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description"
            ).bindparams(code=code, description=description)
        )
    _grant("OWNER", tuple(PERMISSIONS))
    _grant("HR", HR)
    for role_code in ("GM", "BDM", "SM", "COD", "TL"):
        _grant(role_code, MANAGER)
    for role_code in ("SE", "OM", "ITM", "AUDITOR"):
        _grant(role_code, BASE_EMPLOYEE)

    leave_types = (
        ("ANNUAL", "Annual"),
        ("SICK", "Sick"),
        ("UNPAID", "Unpaid"),
        ("MATERNITY", "Maternity"),
        ("PARENTAL", "Parental"),
        ("BEREAVEMENT", "Bereavement"),
        ("STUDY", "Study"),
        ("OTHER", "Other"),
    )
    for code, name in leave_types:
        op.execute(
            sa.text(
                "INSERT INTO leave_types "
                "(id, code, name, is_system, status, created_at, updated_at) "
                "VALUES (:id, :code, :name, true, 'active', now(), now()) "
                "ON CONFLICT (code) DO NOTHING"
            ).bindparams(id=uuid.uuid4(), code=code, name=name)
        )


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
