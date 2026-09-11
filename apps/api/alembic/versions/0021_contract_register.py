"""Phase 2 employment contract register.

Revision ID: 0021_contract_register
Revises: 0020_leave_management
Create Date: 2026-09-10
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0021_contract_register"
down_revision: str | Sequence[str] | None = "0020_leave_management"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PERMISSIONS = {
    "Contracts.ViewOwn": "View and download the authenticated employee's active contract",
    "Contracts.View": "View the company employment-contract register",
    "Contracts.Create": "Prepare employment contracts and renewals",
    "Contracts.Edit": "Edit draft employment contracts",
    "Contracts.Approve": "Approve and activate employment contracts",
    "Contracts.ReturnReject": "Return or reject pending employment contracts with a comment",
    "Contracts.Cancel": "Cancel draft or pending employment contracts with a reason",
    "Contracts.History": "View immutable employment-contract history",
    "Contracts.Settings": "Configure employment contract types",
}


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
    op.create_table(
        "contract_types",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("code", sa.String(40), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "employment_contracts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "contract_type_id", sa.Uuid(), sa.ForeignKey("contract_types.id"), nullable=False
        ),
        sa.Column(
            "parent_contract_id",
            sa.Uuid(),
            sa.ForeignKey("employment_contracts.id"),
            nullable=True,
        ),
        sa.Column("contract_number", sa.String(80), nullable=False, unique=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("job_title_snapshot", sa.String(160), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("basic_salary", sa.Numeric(14, 2), nullable=False),
        sa.Column("allowances_total", sa.Numeric(14, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lock_version", sa.Integer(), server_default="1", nullable=False),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date >= start_date", name="ck_contract_date_order"
        ),
        sa.CheckConstraint("basic_salary >= 0", name="ck_contract_basic_salary_nonnegative"),
        sa.CheckConstraint("allowances_total >= 0", name="ck_contract_allowances_nonnegative"),
        sa.CheckConstraint("lock_version > 0", name="ck_contract_lock_version_positive"),
    )
    op.create_index(
        "uq_employment_contract_active_employee",
        "employment_contracts",
        ["employee_id"],
        unique=True,
        postgresql_where=sa.text("status = 'Active' AND archived_at IS NULL"),
    )
    op.create_index(
        "ix_employment_contract_status_end", "employment_contracts", ["status", "end_date"]
    )
    op.create_table(
        "contract_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "contract_id",
            sa.Uuid(),
            sa.ForeignKey("employment_contracts.id", ondelete="CASCADE"),
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
        "contract_attachments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "contract_id",
            sa.Uuid(),
            sa.ForeignKey("employment_contracts.id", ondelete="CASCADE"),
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
        sa.UniqueConstraint("contract_id", "version", name="uq_contract_attachment_version"),
    )

    for code, description in PERMISSIONS.items():
        op.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code, :description) "
                "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description"
            ).bindparams(code=code, description=description)
        )
    _grant("OWNER", tuple(PERMISSIONS))
    own = ("Contracts.ViewOwn",)
    for role_code in ("GM", "BDM", "SM", "COD", "TL", "SE", "OM", "ITM", "AUDITOR"):
        _grant(role_code, own)
    _grant(
        "HR",
        (
            "Contracts.ViewOwn",
            "Contracts.View",
            "Contracts.Create",
            "Contracts.Edit",
            "Contracts.ReturnReject",
            "Contracts.Cancel",
            "Contracts.History",
            "Contracts.Settings",
        ),
    )


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
