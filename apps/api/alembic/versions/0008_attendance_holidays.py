"""Attendance, official holidays, schedules, and leave types.

Revision ID: 0008_attendance_holidays
Revises: 0007_reporting_mis
Create Date: 2026-08-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_attendance_holidays"
down_revision: str | Sequence[str] | None = "0007_reporting_mis"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PERMISSIONS = (
    (
        "Attendance.View",
        "View attendance, schedules, holidays, and in-app holiday reminders in scope",
    ),
    (
        "Attendance.Manage",
        "Record attendance and configure schedules, holidays, leave types, and impact rules",
    ),
    (
        "Attendance.Correct",
        "Correct attendance records with a mandatory reason and immutable history",
    ),
    ("Attendance.Reports", "View attendance reports and attendance score summaries"),
    ("Notifications.SendUrgent", "Send urgent in-app notifications"),
)


def upgrade() -> None:
    op.create_table(
        "company_working_days",
        sa.Column("weekday", sa.SmallInteger(), primary_key=True),
    )
    op.create_table(
        "leave_types",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "attendance_schedules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("office_id", sa.Uuid(), sa.ForeignKey("offices.id"), nullable=False),
        sa.Column("department_id", sa.Uuid(), sa.ForeignKey("departments.id"), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("grace_minutes", sa.Integer(), nullable=False),
        sa.Column("ramadan_from", sa.Date(), nullable=True),
        sa.Column("ramadan_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index(
        "uq_attendance_schedules_office_normal",
        "attendance_schedules",
        ["office_id"],
        unique=True,
        postgresql_where=sa.text("department_id IS NULL AND kind = 'normal'"),
    )
    op.create_index(
        "uq_attendance_schedules_dept_normal",
        "attendance_schedules",
        ["office_id", "department_id"],
        unique=True,
        postgresql_where=sa.text("department_id IS NOT NULL AND kind = 'normal'"),
    )
    op.create_table(
        "official_holidays",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("holiday_date", sa.Date(), nullable=False, unique=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_table(
        "holiday_reminders",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "holiday_id",
            sa.Uuid(),
            sa.ForeignKey("official_holidays.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index(
        "uq_holiday_reminders_automatic",
        "holiday_reminders",
        ["holiday_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'automatic'"),
    )
    op.create_table(
        "holiday_reminder_dismissals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "reminder_id",
            sa.Uuid(),
            sa.ForeignKey("holiday_reminders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("reminder_id", "user_id"),
    )
    op.create_table(
        "attendance_impact_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("condition", sa.String(length=20), nullable=False),
        sa.Column("leave_type_id", sa.Uuid(), sa.ForeignKey("leave_types.id"), nullable=True),
        sa.Column("method", sa.String(length=20), nullable=False),
        sa.Column("value", sa.Numeric(8, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("condition", "leave_type_id"),
    )
    op.create_index(
        "uq_attendance_impact_rules_condition",
        "attendance_impact_rules",
        ["condition"],
        unique=True,
        postgresql_where=sa.text("leave_type_id IS NULL"),
    )
    op.create_table(
        "attendance_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("employee_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("time_in", sa.Time(), nullable=True),
        sa.Column("time_out", sa.Time(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("leave_type_id", sa.Uuid(), sa.ForeignKey("leave_types.id"), nullable=True),
        sa.Column("is_late", sa.Boolean(), nullable=False),
        sa.Column("late_minutes", sa.Integer(), nullable=False),
        sa.Column("is_early_exit", sa.Boolean(), nullable=False),
        sa.Column("early_exit_minutes", sa.Integer(), nullable=False),
        sa.Column("is_incomplete", sa.Boolean(), nullable=False),
        sa.Column("calculation_state", sa.String(length=32), nullable=False),
        sa.Column(
            "schedule_id", sa.Uuid(), sa.ForeignKey("attendance_schedules.id"), nullable=True
        ),
        sa.Column("worked_on_holiday", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.UniqueConstraint("employee_id", "attendance_date"),
    )
    op.create_table(
        "attendance_corrections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "attendance_id",
            sa.Uuid(),
            sa.ForeignKey("attendance_records.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("old_values", postgresql.JSONB(), nullable=False),
        sa.Column("new_values", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    permissions = sa.table(
        "permissions",
        sa.column("code", sa.String),
        sa.column("description", sa.String),
    )
    op.bulk_insert(
        permissions,
        [{"code": code, "description": description} for code, description in _PERMISSIONS],
    )


def downgrade() -> None:
    raise NotImplementedError("NEXA BOS migrations are forward-only")
