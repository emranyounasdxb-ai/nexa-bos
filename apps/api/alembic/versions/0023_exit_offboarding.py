"""Employee exits with assigned clearance and immutable evidence."""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0023_exit_offboarding"
down_revision = "0022_employee_transfers"
branch_labels = None
depends_on = None
PERMISSIONS = (
    "Exits.ViewOwn",
    "Exits.View",
    "Exits.Request",
    "Exits.Create",
    "Exits.Edit",
    "Exits.Progress",
    "Exits.Assign",
    "Exits.Clearance",
    "Exits.Approve",
    "Exits.ReturnReject",
    "Exits.Cancel",
    "Exits.History",
)


def _grant(code, permissions):
    for permission in permissions:
        op.execute(
            sa.text(
                "INSERT INTO user_type_permissions (id, user_type_id, permission_code) "
                "SELECT :id, id, :permission FROM user_types WHERE code=:code "
                "ON CONFLICT (user_type_id, permission_code) DO NOTHING"
            ).bindparams(id=uuid.uuid4(), code=code, permission=permission)
        )


def upgrade():
    op.create_table(
        "employee_exits",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("requested_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("exit_type", sa.String(30), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("request_date", sa.Date(), nullable=False),
        sa.Column("notice_date", sa.Date(), nullable=False),
        sa.Column("last_working_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("settlement_status", sa.String(30), nullable=False),
        sa.Column("settlement_reference", sa.String(200)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lock_version", sa.Integer(), nullable=False),
        sa.CheckConstraint("lock_version > 0", name="ck_exit_version_positive"),
    )
    op.create_index(
        "uq_exit_open_employee",
        "employee_exits",
        ["employee_id"],
        unique=True,
        postgresql_where=sa.text(
            "status NOT IN ('Completed', 'Cancelled') AND archived_at IS NULL"
        ),
    )
    op.create_table(
        "exit_clearances",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("exit_id", sa.Uuid(), sa.ForeignKey("employee_exits.id"), nullable=False),
        sa.Column("key", sa.String(30), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("assignee_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("uq_exit_clearance_key", "exit_clearances", ["exit_id", "key"], unique=True)
    op.create_table(
        "exit_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("exit_id", sa.Uuid(), sa.ForeignKey("employee_exits.id"), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("before", JSONB(), nullable=False),
        sa.Column("after", JSONB(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for permission in PERMISSIONS:
        op.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code,:description) "
                "ON CONFLICT (code) DO NOTHING"
            ).bindparams(
                code=permission, description=permission.replace("Exits.", "Employee exit: ")
            )
        )
    _grant("OWNER", PERMISSIONS)
    _grant("HR", tuple(p for p in PERMISSIONS if p != "Exits.Approve"))
    for code in ("GM", "BDM", "SM", "COD", "TL", "SE", "OM", "ITM", "FIN", "AUDITOR"):
        _grant(code, ("Exits.ViewOwn", "Exits.Request", "Exits.Clearance"))


def downgrade():
    raise NotImplementedError("NEXA BOS migrations are forward-only")
