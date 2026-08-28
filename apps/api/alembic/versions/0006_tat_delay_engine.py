"""Simple TAT occupancy and delay engine.

Revision ID: 0006_tat_delay_engine
Revises: 0005_application_lifecycle
Create Date: 2026-08-28
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0006_tat_delay_engine"
down_revision: str | Sequence[str] | None = "0005_application_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OPENING_EVENTS = frozenset(
    {
        "application_created",
        "submission",
        "stage_moved",
        "stage_corrected",
        "returned_requirement_pending",
        "resubmission",
        "approval",
        "booking",
        "fund_release",
        "workflow_migrated",
    }
)
_TERMINAL_EVENTS = frozenset({"completed", "final_rejected", "cancelled", "withdrawn"})


def _seconds(start: datetime, end: datetime) -> int:
    return max(0, int((end - start).total_seconds()))


def _close_open(open_row: dict | None, rows: list[dict], at: datetime, actor_id) -> None:
    if open_row is None:
        return
    open_row["exited_at"] = at
    open_row["duration_seconds"] = _seconds(open_row["entered_at"], at)
    open_row["bos_updated_at"] = at
    open_row["updated_by_id"] = actor_id
    rows.append(open_row)


def _backfill(connection) -> None:
    connection.execute(
        sa.text(
            """
            UPDATE applications
            SET tat_stopped_at = completed_at
            WHERE completed_at IS NOT NULL AND tat_stopped_at IS NULL
            """
        )
    )
    connection.execute(
        sa.text(
            """
            UPDATE applications AS app
            SET tat_stopped_at = terminal.bos_updated_at
            FROM (
                SELECT DISTINCT ON (application_id)
                    application_id,
                    bos_updated_at
                FROM application_events
                WHERE event_type IN ('completed', 'final_rejected', 'cancelled', 'withdrawn')
                ORDER BY application_id, bos_updated_at DESC, id DESC
            ) AS terminal
            WHERE app.id = terminal.application_id
              AND app.tat_stopped_at IS NULL
              AND app.terminal_outcome IS NOT NULL
            """
        )
    )
    apps = connection.execute(
        sa.text(
            """
            SELECT id, created_at, created_by_id, current_stage_id, tat_stopped_at
            FROM applications
            """
        )
    ).mappings()
    occupancy = sa.table(
        "application_stage_occupancies",
        sa.column("id"),
        sa.column("application_id"),
        sa.column("stage_id"),
        sa.column("entered_at"),
        sa.column("exited_at"),
        sa.column("duration_seconds"),
        sa.column("bank_stage_date"),
        sa.column("stage_note"),
        sa.column("bos_updated_at"),
        sa.column("updated_by_id"),
    )
    for app in apps:
        events = (
            connection.execute(
                sa.text(
                    """
                    SELECT event_type, new_stage_id, bank_stage_date, stage_note,
                           bos_updated_at, actor_id
                    FROM application_events
                    WHERE application_id = :id
                    ORDER BY bos_updated_at ASC, id ASC
                    """
                ),
                {"id": app["id"]},
            )
            .mappings()
            .all()
        )
        open_row: dict | None = None
        rows: list[dict] = []

        for event in events:
            event_type = event["event_type"]
            if event_type in _OPENING_EVENTS and event["new_stage_id"] is not None:
                _close_open(open_row, rows, event["bos_updated_at"], event["actor_id"])
                open_row = {
                    "id": uuid.uuid4(),
                    "application_id": app["id"],
                    "stage_id": event["new_stage_id"],
                    "entered_at": event["bos_updated_at"],
                    "exited_at": None,
                    "duration_seconds": None,
                    "bank_stage_date": event["bank_stage_date"],
                    "stage_note": event["stage_note"],
                    "bos_updated_at": event["bos_updated_at"],
                    "updated_by_id": event["actor_id"],
                }
            elif event_type in _TERMINAL_EVENTS:
                _close_open(open_row, rows, event["bos_updated_at"], event["actor_id"])
                open_row = None
        if open_row is not None and app["tat_stopped_at"] is not None:
            _close_open(open_row, rows, app["tat_stopped_at"], app["created_by_id"])
            open_row = None
        if open_row is not None:
            rows.append(open_row)
        elif not rows:
            rows.append(
                {
                    "id": uuid.uuid4(),
                    "application_id": app["id"],
                    "stage_id": app["current_stage_id"],
                    "entered_at": app["created_at"],
                    "exited_at": app["tat_stopped_at"],
                    "duration_seconds": (
                        _seconds(app["created_at"], app["tat_stopped_at"])
                        if app["tat_stopped_at"] is not None
                        else None
                    ),
                    "bank_stage_date": None,
                    "stage_note": None,
                    "bos_updated_at": app["tat_stopped_at"] or app["created_at"],
                    "updated_by_id": app["created_by_id"],
                }
            )
        if rows:
            connection.execute(occupancy.insert(), rows)


def upgrade() -> None:
    op.add_column(
        "applications",
        sa.Column("tat_stopped_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "application_stage_occupancies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=False),
        sa.Column("stage_id", sa.Uuid(), nullable=False),
        sa.Column("entered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("exited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("bank_stage_date", sa.Date(), nullable=True),
        sa.Column("stage_note", sa.Text(), nullable=True),
        sa.Column("bos_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stage_id"], ["workflow_stages.id"]),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_application_stage_occupancies_application_id",
        "application_stage_occupancies",
        ["application_id"],
    )
    op.create_index(
        "uq_application_stage_occupancies_open",
        "application_stage_occupancies",
        ["application_id"],
        unique=True,
        postgresql_where=sa.text("exited_at IS NULL"),
    )
    op.create_table(
        "application_delays",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=False),
        sa.Column("stage_id", sa.Uuid(), nullable=False),
        sa.Column("delay_type", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("other_explanation", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("marked_by_id", sa.Uuid(), nullable=False),
        sa.Column("marked_event_id", sa.Uuid(), nullable=True),
        sa.Column("closed_cause", sa.String(length=32), nullable=True),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["marked_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["marked_event_id"], ["application_events.id"]),
        sa.ForeignKeyConstraint(["stage_id"], ["workflow_stages.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_application_delays_application_id", "application_delays", ["application_id"]
    )
    op.create_index(
        "uq_application_delays_one_active",
        "application_delays",
        ["application_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.create_table(
        "application_delay_corrections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("delay_id", sa.Uuid(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["delay_id"], ["application_delays.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["application_events.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_application_delay_corrections_delay_id",
        "application_delay_corrections",
        ["delay_id"],
    )
    _backfill(op.get_bind())


def downgrade() -> None:
    op.drop_index(
        "ix_application_delay_corrections_delay_id",
        table_name="application_delay_corrections",
    )
    op.drop_table("application_delay_corrections")
    op.drop_index("uq_application_delays_one_active", table_name="application_delays")
    op.drop_index("ix_application_delays_application_id", table_name="application_delays")
    op.drop_table("application_delays")
    op.drop_index(
        "uq_application_stage_occupancies_open",
        table_name="application_stage_occupancies",
    )
    op.drop_index(
        "ix_application_stage_occupancies_application_id",
        table_name="application_stage_occupancies",
    )
    op.drop_table("application_stage_occupancies")
    op.drop_column("applications", "tat_stopped_at")
