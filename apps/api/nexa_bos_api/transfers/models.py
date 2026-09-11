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
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import User, new_uuid


class EmployeeTransfer(Base):
    __tablename__ = "employee_transfers"
    __table_args__ = (
        CheckConstraint("lock_version > 0", name="ck_transfer_version_positive"),
        Index("ix_transfer_status_effective", "status", "effective_date"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    employee_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    requested_by_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    reviewed_by_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    approved_by_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    supersedes_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("employee_transfers.id"))
    current_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    proposed: Mapped[dict] = mapped_column(JSONB, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    requested_date: Mapped[date] = mapped_column(Date, nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    backdate_reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    application_error: Mapped[str | None] = mapped_column(String(80))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    employee: Mapped[User] = relationship(foreign_keys=[employee_id])
    requested_by: Mapped[User] = relationship(foreign_keys=[requested_by_id])
    events: Mapped[list[TransferEvent]] = relationship(order_by="TransferEvent.created_at")

    __mapper_args__ = {"version_id_col": lock_version}


class TransferEvent(Base):
    __tablename__ = "transfer_events"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    transfer_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("employee_transfers.id"), nullable=False
    )
    actor_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor: Mapped[User] = relationship()


@event.listens_for(TransferEvent, "before_update")
@event.listens_for(TransferEvent, "before_delete")
def immutable_transfer_event(*_args):
    raise ValueError("Transfer events are immutable")
