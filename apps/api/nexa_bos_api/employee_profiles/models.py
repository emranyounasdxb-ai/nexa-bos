from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

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
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import new_uuid


class HRProfile(Base):
    __tablename__ = "hr_profiles"
    __table_args__ = (
        CheckConstraint("lock_version > 0", name="ck_hr_profiles_lock_version_positive"),
        CheckConstraint("basic_salary >= 0", name="ck_hr_profiles_basic_salary_nonnegative"),
        CheckConstraint(
            "housing_allowance >= 0", name="ck_hr_profiles_housing_allowance_nonnegative"
        ),
        CheckConstraint(
            "transport_allowance >= 0", name="ck_hr_profiles_transport_allowance_nonnegative"
        ),
        CheckConstraint(
            "other_allowances >= 0", name="ck_hr_profiles_other_allowances_nonnegative"
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(40))
    nationality: Mapped[str | None] = mapped_column(String(100))
    marital_status: Mapped[str | None] = mapped_column(String(40))
    emergency_contact_name: Mapped[str | None] = mapped_column(String(200))
    emergency_contact_relationship: Mapped[str | None] = mapped_column(String(100))
    emergency_contact_mobile: Mapped[str | None] = mapped_column(String(32))
    employee_type: Mapped[str | None] = mapped_column(String(80))
    employment_type: Mapped[str | None] = mapped_column(String(80))
    probation_end_date: Mapped[date | None] = mapped_column(Date)
    job_title: Mapped[str | None] = mapped_column(String(160))
    business_unit: Mapped[str | None] = mapped_column(String(160))
    location: Mapped[str | None] = mapped_column(String(160))
    employee_grade: Mapped[str | None] = mapped_column(String(80))
    basic_salary: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    housing_allowance: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    transport_allowance: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    other_allowances: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    payment_method: Mapped[str | None] = mapped_column(String(80))
    bank_name: Mapped[str | None] = mapped_column(String(160))
    bank_account_name: Mapped[str | None] = mapped_column(String(200))
    iban: Mapped[str | None] = mapped_column(String(34))
    bank_account_number: Mapped[str | None] = mapped_column(String(80))
    hr_notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    user: Mapped[object] = relationship("User", back_populates="hr_profile", foreign_keys=[user_id])
    created_by: Mapped[object] = relationship("User", foreign_keys=[created_by_id])
    updated_by: Mapped[object] = relationship("User", foreign_keys=[updated_by_id])

    __mapper_args__ = {"version_id_col": lock_version}


class EmployeeDocument(Base):
    __tablename__ = "employee_documents"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_employee_documents_version_positive"),
        CheckConstraint(
            "size_bytes IS NULL OR size_bytes >= 0",
            name="ck_employee_documents_size_nonnegative",
        ),
        UniqueConstraint("user_id", "record_key", "version", name="uq_employee_doc_version"),
        Index(
            "uq_employee_documents_active_record",
            "user_id",
            "record_key",
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    record_key: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str | None] = mapped_column(String(160))
    document_number: Mapped[str | None] = mapped_column(String(120))
    visa_type: Mapped[str | None] = mapped_column(String(100))
    medical_status: Mapped[str | None] = mapped_column(String(80))
    insurance_provider: Mapped[str | None] = mapped_column(String(160))
    expiry_date: Mapped[date | None] = mapped_column(Date)
    declared_status: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(Text)
    storage_key: Mapped[str | None] = mapped_column(String(255))
    original_filename: Mapped[str | None] = mapped_column(String(255))
    content_type: Mapped[str | None] = mapped_column(String(80))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    replacement_reason: Mapped[str | None] = mapped_column(String(500))
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[object] = relationship(
        "User", back_populates="employee_documents", foreign_keys=[user_id]
    )
    created_by: Mapped[object] = relationship("User", foreign_keys=[created_by_id])
    updated_by: Mapped[object] = relationship("User", foreign_keys=[updated_by_id])
    uploaded_by: Mapped[object | None] = relationship("User", foreign_keys=[uploaded_by_id])
