from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    event,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Mapper, mapped_column, relationship

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import User, new_uuid


class LeaveBalanceAdjustment(Base):
    __tablename__ = "leave_balance_adjustments"
    __table_args__ = (CheckConstraint("amount <> 0", name="ck_leave_balance_adjustment_nonzero"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    employee_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("leave_types.id"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(8, 2), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    expires_on: Mapped[date | None] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LeaveRequest(Base):
    __tablename__ = "leave_requests"
    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="ck_leave_request_date_order"),
        CheckConstraint("working_days > 0", name="ck_leave_request_working_days_positive"),
        CheckConstraint("lock_version > 0", name="ck_leave_request_lock_version_positive"),
        Index("ix_leave_requests_employee_dates", "employee_id", "start_date", "end_date"),
        Index("ix_leave_requests_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    employee_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("leave_types.id"), nullable=False
    )
    requested_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    portion: Mapped[str] = mapped_column(String(20), nullable=False)
    working_days: Mapped[float] = mapped_column(Numeric(8, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    exception_reason: Mapped[str | None] = mapped_column(Text)
    cancellation_reason: Mapped[str | None] = mapped_column(Text)
    cancellation_manager_approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    manager_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hr_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    employee: Mapped[User] = relationship(foreign_keys=[employee_id])
    requested_by: Mapped[User] = relationship(foreign_keys=[requested_by_id])
    events: Mapped[list[LeaveRequestEvent]] = relationship(
        back_populates="request", order_by="LeaveRequestEvent.created_at"
    )
    attachments: Mapped[list[LeaveAttachment]] = relationship(
        back_populates="request", order_by="LeaveAttachment.version"
    )

    __mapper_args__ = {"version_id_col": lock_version}


class LeaveRequestEvent(Base):
    __tablename__ = "leave_request_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    request_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("leave_requests.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    request: Mapped[LeaveRequest] = relationship(back_populates="events")
    actor: Mapped[User] = relationship(foreign_keys=[actor_id])


class LeaveAttachment(Base):
    __tablename__ = "leave_attachments"
    __table_args__ = (
        UniqueConstraint("request_id", "version", name="uq_leave_attachment_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    request_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("leave_requests.id", ondelete="CASCADE"), nullable=False
    )
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(80), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    uploaded_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    replacement_reason: Mapped[str | None] = mapped_column(Text)

    request: Mapped[LeaveRequest] = relationship(back_populates="attachments")


def _reject_history_mutation(_mapper: Mapper[object], _connection: object, _target: object) -> None:
    raise RuntimeError("Leave history is immutable")


for _history_model in (LeaveRequestEvent, LeaveBalanceAdjustment):
    event.listen(_history_model, "before_update", _reject_history_mutation)
    event.listen(_history_model, "before_delete", _reject_history_mutation)
