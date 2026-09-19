"""Attendance-only operational evidence. No leave approval or balance engine."""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import new_uuid


class AttendanceImportBatch(Base):
    __tablename__ = "attendance_import_batches"
    __table_args__ = (UniqueConstraint("uploader_id", "fingerprint"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    reference: Mapped[str] = mapped_column(String(64), unique=True)
    filename: Mapped[str] = mapped_column(String(255))
    fingerprint: Mapped[str] = mapped_column(String(64))
    office_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("offices.id"))
    uploader_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    uploader_snapshot: Mapped[dict] = mapped_column(JSONB)
    rows: Mapped[list] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_by_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    confirmation_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    results: Mapped[list | None] = mapped_column(JSONB)


class AttendanceProvenance(Base):
    __tablename__ = "attendance_provenance"
    attendance_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("attendance_records.id"), primary_key=True
    )
    source: Mapped[str] = mapped_column(String(32))
    office_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("offices.id"))
    batch_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("attendance_import_batches.id"))
    actor_snapshot: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AttendanceMonthEvent(Base):
    __tablename__ = "attendance_month_events"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    office_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("offices.id"), index=True)
    month: Mapped[date] = mapped_column(Date, index=True)
    action: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    actor_snapshot: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AttendanceLeaveEvidence(Base):
    __tablename__ = "attendance_leave_evidence"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    employee_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    leave_type_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("leave_types.id"))
    office_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("offices.id"))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    approval_reference: Mapped[str] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    actor_snapshot: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AttendanceOfficeHoliday(Base):
    __tablename__ = "attendance_office_holidays"
    __table_args__ = (UniqueConstraint("office_id", "holiday_date"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    office_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("offices.id"))
    holiday_date: Mapped[date] = mapped_column(Date)
    name: Mapped[str] = mapped_column(String(200))
    actor_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


def _immutable(*_args: object) -> None:
    raise RuntimeError("Attendance history cannot be changed or deleted")


for _model in (AttendanceProvenance, AttendanceMonthEvent, AttendanceLeaveEvidence):
    event.listen(_model, "before_update", _immutable)
    event.listen(_model, "before_delete", _immutable)
event.listen(AttendanceImportBatch, "before_delete", _immutable)
