from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    event,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Mapper, mapped_column, relationship

from nexa_bos_api.db.base import Base


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


class Permission(Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)


class UserType(Base):
    __tablename__ = "user_types"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500))
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    visibility_scope: Mapped[str | None] = mapped_column(String(20))
    customer_visibility_scope: Mapped[str | None] = mapped_column(String(20))
    mfa_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_be_reporting_manager: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    permissions: Mapped[list[UserTypePermission]] = relationship(
        back_populates="user_type",
        cascade="all, delete-orphan",
    )
    users: Mapped[list[User]] = relationship(back_populates="user_type")


class UserTypePermission(Base):
    __tablename__ = "user_type_permissions"
    __table_args__ = (UniqueConstraint("user_type_id", "permission_code"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_type_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("user_types.id", ondelete="CASCADE"), nullable=False
    )
    permission_code: Mapped[str] = mapped_column(
        String(64), ForeignKey("permissions.code"), nullable=False
    )

    user_type: Mapped[UserType] = relationship(back_populates="permissions")


class SecuritySettings(Base):
    __tablename__ = "security_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    setup_link_expiry_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24)
    lockout_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    inactivity_timeout_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    absolute_session_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    bootstrap_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserCodeCounter(Base):
    __tablename__ = "user_code_counters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Office(Base):
    __tablename__ = "offices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    departments: Mapped[list[Department]] = relationship(back_populates="office")
    name_history: Mapped[list[OfficeNameHistory]] = relationship(back_populates="office")


class OfficeNameHistory(Base):
    __tablename__ = "office_name_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    office_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("offices.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    office: Mapped[Office] = relationship(back_populates="name_history")


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    office_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("offices.id"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    office: Mapped[Office] = relationship(back_populates="departments")
    name_history: Mapped[list[DepartmentNameHistory]] = relationship(back_populates="department")


class DepartmentNameHistory(Base):
    __tablename__ = "department_name_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    department_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("departments.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    department: Mapped[Department] = relationship(back_populates="name_history")


class Designation(Base):
    __tablename__ = "designations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    name_history: Mapped[list[DesignationNameHistory]] = relationship(back_populates="designation")


class DesignationNameHistory(Base):
    __tablename__ = "designation_name_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    designation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("designations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    designation: Mapped[Designation] = relationship(back_populates="name_history")


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    office_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("offices.id"), nullable=False)
    department_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("departments.id"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    team_leader_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    office: Mapped[Office] = relationship()
    department: Mapped[Department] = relationship()
    team_leader: Mapped[User | None] = relationship(foreign_keys=[team_leader_id])
    name_history: Mapped[list[TeamNameHistory]] = relationship(back_populates="team")


class TeamNameHistory(Base):
    __tablename__ = "team_name_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    team_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    team: Mapped[Team] = relationship(back_populates="name_history")


class TeamLeaderHistory(Base):
    __tablename__ = "team_leader_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    team_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    employee_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    mobile: Mapped[str] = mapped_column(String(32), nullable=False)
    designation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("designations.id"), nullable=False
    )
    employment_status: Mapped[str] = mapped_column(String(32), nullable=False)
    joining_date: Mapped[date] = mapped_column(Date, nullable=False)
    last_working_date: Mapped[date | None] = mapped_column(Date)
    office_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("offices.id"))
    department_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("departments.id"))
    team_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("teams.id"))
    reporting_manager_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    profile_photo_key: Mapped[str | None] = mapped_column(String(255))
    profile_photo_content_type: Mapped[str | None] = mapped_column(String(80))
    profile_photo_original_name: Mapped[str | None] = mapped_column(String(255))
    user_type_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("user_types.id"))
    account_status: Mapped[str] = mapped_column(String(20), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mfa_secret: Mapped[str | None] = mapped_column(String(64))
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user_type: Mapped[UserType | None] = relationship(back_populates="users")
    designation: Mapped[Designation] = relationship()
    office: Mapped[Office | None] = relationship()
    department: Mapped[Department | None] = relationship()
    team: Mapped[Team | None] = relationship(foreign_keys=[team_id])
    reporting_manager: Mapped[User | None] = relationship(
        remote_side="User.id",
        foreign_keys=[reporting_manager_id],
    )


class UserEmailHistory(Base):
    __tablename__ = "user_email_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class UserAssignmentHistory(Base):
    __tablename__ = "user_assignment_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field: Mapped[str] = mapped_column(String(40), nullable=False)
    value_id: Mapped[str | None] = mapped_column(String(64))
    value_label: Mapped[str | None] = mapped_column(String(200))
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EmploymentPeriod(Base):
    __tablename__ = "employment_periods"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    joining_date: Mapped[date] = mapped_column(Date, nullable=False)
    last_working_date: Mapped[date | None] = mapped_column(Date)
    employee_code: Mapped[str] = mapped_column(String(64), nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PasswordHistory(Base):
    __tablename__ = "password_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_token: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class OneTimeToken(Base):
    __tablename__ = "one_time_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    old_values: Mapped[dict | None] = mapped_column(JSONB)
    new_values: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)


def _reject_audit_mutation(
    _mapper: Mapper[AuditEvent], _connection: object, _target: AuditEvent
) -> None:
    raise RuntimeError("Audit records are immutable")


event.listen(AuditEvent, "before_update", _reject_audit_mutation)
event.listen(AuditEvent, "before_delete", _reject_audit_mutation)
