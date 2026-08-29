from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    Uuid,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Mapper, mapped_column, relationship

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import User, new_uuid


class CompanyWorkingDay(Base):
    __tablename__ = "company_working_days"

    weekday: Mapped[int] = mapped_column(SmallInteger, primary_key=True)


class LeaveType(Base):
    __tablename__ = "leave_types"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AttendanceSchedule(Base):
    __tablename__ = "attendance_schedules"
    __table_args__ = (
        Index(
            "uq_attendance_schedules_office_normal",
            "office_id",
            unique=True,
            postgresql_where=text("department_id IS NULL AND kind = 'normal'"),
        ),
        Index(
            "uq_attendance_schedules_dept_normal",
            "office_id",
            "department_id",
            unique=True,
            postgresql_where=text("department_id IS NOT NULL AND kind = 'normal'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    office_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("offices.id"), nullable=False)
    department_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("departments.id"))
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    grace_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ramadan_from: Mapped[date | None] = mapped_column(Date)
    ramadan_to: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))


class OfficialHoliday(Base):
    __tablename__ = "official_holidays"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    holiday_date: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))


class HolidayReminder(Base):
    __tablename__ = "holiday_reminders"
    __table_args__ = (
        Index(
            "uq_holiday_reminders_automatic",
            "holiday_id",
            unique=True,
            postgresql_where=text("kind = 'automatic'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    holiday_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("official_holidays.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))

    holiday: Mapped[OfficialHoliday] = relationship()


class HolidayReminderDismissal(Base):
    __tablename__ = "holiday_reminder_dismissals"
    __table_args__ = (UniqueConstraint("reminder_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    reminder_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("holiday_reminders.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    dismissed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AttendanceImpactRule(Base):
    __tablename__ = "attendance_impact_rules"
    __table_args__ = (
        UniqueConstraint("condition", "leave_type_id"),
        Index(
            "uq_attendance_impact_rules_condition",
            "condition",
            unique=True,
            postgresql_where=text("leave_type_id IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    condition: Mapped[str] = mapped_column(String(20), nullable=False)
    leave_type_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("leave_types.id"))
    method: Mapped[str] = mapped_column(String(20), nullable=False)
    value: Mapped[float] = mapped_column(Numeric(8, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    leave_type: Mapped[LeaveType | None] = relationship()


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    __table_args__ = (UniqueConstraint("employee_id", "attendance_date"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    employee_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    attendance_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    time_in: Mapped[time | None] = mapped_column(Time)
    time_out: Mapped[time | None] = mapped_column(Time)
    notes: Mapped[str | None] = mapped_column(Text)
    leave_type_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("leave_types.id"))
    is_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    late_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_early_exit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    early_exit_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_incomplete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    calculation_state: Mapped[str] = mapped_column(String(32), nullable=False)
    schedule_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("attendance_schedules.id")
    )
    worked_on_holiday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))

    employee: Mapped[User] = relationship(foreign_keys=[employee_id])
    leave_type: Mapped[LeaveType | None] = relationship()
    schedule: Mapped[AttendanceSchedule | None] = relationship()
    corrections: Mapped[list[AttendanceCorrection]] = relationship(
        back_populates="attendance",
        order_by="AttendanceCorrection.created_at",
    )


class AttendanceCorrection(Base):
    __tablename__ = "attendance_corrections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    attendance_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("attendance_records.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    old_values: Mapped[dict] = mapped_column(JSONB, nullable=False)
    new_values: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    attendance: Mapped[AttendanceRecord] = relationship(back_populates="corrections")
    actor: Mapped[User] = relationship(foreign_keys=[actor_id])


def _reject_correction_mutation(
    _mapper: Mapper[AttendanceCorrection], _connection: object, _target: AttendanceCorrection
) -> None:
    raise RuntimeError("Attendance correction history is immutable")


event.listen(AttendanceCorrection, "before_update", _reject_correction_mutation)
event.listen(AttendanceCorrection, "before_delete", _reject_correction_mutation)
