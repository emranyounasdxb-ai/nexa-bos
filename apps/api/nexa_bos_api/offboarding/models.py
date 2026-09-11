from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import User, new_uuid


class EmployeeExit(Base):
    __tablename__ = "employee_exits"
    __table_args__ = (
        CheckConstraint("lock_version > 0", name="ck_exit_version_positive"),
        Index(
            "uq_exit_open_employee",
            "employee_id",
            unique=True,
            postgresql_where=text(
                "status NOT IN ('Completed', 'Cancelled') AND archived_at IS NULL"
            ),
        ),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    employee_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    requested_by_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    exit_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    request_date: Mapped[date] = mapped_column(Date, nullable=False)
    notice_date: Mapped[date] = mapped_column(Date, nullable=False)
    last_working_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    settlement_status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="Not recorded"
    )
    settlement_reference: Mapped[str | None] = mapped_column(String(200))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    employee: Mapped[User] = relationship(foreign_keys=[employee_id])
    requester: Mapped[User] = relationship(foreign_keys=[requested_by_id])
    checklist: Mapped[list[ExitClearance]] = relationship(order_by="ExitClearance.position")
    events: Mapped[list[ExitEvent]] = relationship(order_by="ExitEvent.created_at")
    __mapper_args__ = {"version_id_col": lock_version}


class ExitClearance(Base):
    __tablename__ = "exit_clearances"
    __table_args__ = (Index("uq_exit_clearance_key", "exit_id", "key", unique=True),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    exit_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("employee_exits.id"), nullable=False)
    key: Mapped[str] = mapped_column(String(30), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    assignee_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    assignee: Mapped[User | None] = relationship()


class ExitEvent(Base):
    __tablename__ = "exit_events"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    exit_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("employee_exits.id"), nullable=False)
    actor_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    before: Mapped[dict] = mapped_column(JSONB, nullable=False)
    after: Mapped[dict] = mapped_column(JSONB, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor: Mapped[User] = relationship()


@event.listens_for(ExitEvent, "before_update")
@event.listens_for(ExitEvent, "before_delete")
def immutable_exit_event(*_args):
    raise ValueError("Exit events are immutable")
