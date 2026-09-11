"""Reviewed employee assignment transfers; single-company and forward-only."""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0022_employee_transfers"
down_revision = "0021_contract_register"
branch_labels = None
depends_on = None

PERMISSIONS = {
    "Transfers.ViewOwn": "View own transfer status",
    "Transfers.View": "View transfers within directory scope",
    "Transfers.Create": "Prepare employee transfers",
    "Transfers.Recommend": "Recommend transfers for directly assigned employees",
    "Transfers.Edit": "Edit draft or returned transfers",
    "Transfers.Review": "Review submitted employee transfers",
    "Transfers.Approve": "Approve and apply employee transfers",
    "Transfers.ReturnReject": "Return or reject employee transfers",
    "Transfers.Cancel": "Cancel employee transfers with a reason",
    "Transfers.History": "View immutable employee transfer history",
}


def _grant(code, permissions):
    for permission in permissions:
        op.execute(
            sa.text(
                "INSERT INTO user_type_permissions (id, user_type_id, permission_code) "
                "SELECT :id, id, :permission FROM user_types WHERE code = :code "
                "ON CONFLICT (user_type_id, permission_code) DO NOTHING"
            ).bindparams(id=uuid.uuid4(), permission=permission, code=code)
        )


def upgrade():
    op.create_table(
        "employee_transfers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("requested_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reviewed_by_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("approved_by_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("supersedes_id", sa.Uuid(), sa.ForeignKey("employee_transfers.id")),
        sa.Column("current_snapshot", JSONB(), nullable=False),
        sa.Column("proposed", JSONB(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("backdate_reason", sa.Text()),
        sa.Column("requested_date", sa.Date(), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True)),
        sa.Column("application_error", sa.String(80)),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("lock_version", sa.Integer(), nullable=False),
        sa.CheckConstraint("lock_version > 0", name="ck_transfer_version_positive"),
    )
    op.create_index(
        "ix_transfer_status_effective", "employee_transfers", ["status", "effective_date"]
    )
    op.create_table(
        "transfer_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("transfer_id", sa.Uuid(), sa.ForeignKey("employee_transfers.id"), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("from_status", sa.String(32)),
        sa.Column("to_status", sa.String(32), nullable=False),
        sa.Column("comment", sa.Text()),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for code, description in PERMISSIONS.items():
        op.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code, :description) "
                "ON CONFLICT (code) DO NOTHING"
            ).bindparams(code=code, description=description)
        )
    _grant("OWNER", PERMISSIONS)
    _grant(
        "HR", tuple(p for p in PERMISSIONS if p not in {"Transfers.Approve", "Transfers.Recommend"})
    )
    for code in ("GM", "BDM", "SM", "COD", "TL"):
        _grant(code, ("Transfers.ViewOwn", "Transfers.Recommend", "Transfers.History"))
    for code in ("SE", "OM", "ITM", "AUDITOR"):
        _grant(code, ("Transfers.ViewOwn",))


def downgrade():
    raise NotImplementedError("NEXA BOS migrations are forward-only")
