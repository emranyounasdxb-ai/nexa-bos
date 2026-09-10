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
    event,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Mapper, mapped_column, relationship

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import User, new_uuid


class ContractType(Base):
    __tablename__ = "contract_types"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class EmploymentContract(Base):
    __tablename__ = "employment_contracts"
    __table_args__ = (
        CheckConstraint(
            "end_date IS NULL OR end_date >= start_date", name="ck_contract_date_order"
        ),
        CheckConstraint("basic_salary >= 0", name="ck_contract_basic_salary_nonnegative"),
        CheckConstraint("allowances_total >= 0", name="ck_contract_allowances_nonnegative"),
        CheckConstraint("lock_version > 0", name="ck_contract_lock_version_positive"),
        Index(
            "uq_employment_contract_active_employee",
            "employee_id",
            unique=True,
            postgresql_where=text("status = 'Active' AND archived_at IS NULL"),
        ),
        Index("ix_employment_contract_status_end", "status", "end_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    employee_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    contract_type_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("contract_types.id"), nullable=False
    )
    parent_contract_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("employment_contracts.id")
    )
    contract_number: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    job_title_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    basic_salary: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    allowances_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    employee: Mapped[User] = relationship(foreign_keys=[employee_id])
    contract_type: Mapped[ContractType] = relationship()
    parent_contract: Mapped[EmploymentContract | None] = relationship(remote_side=[id])
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped[User] = relationship(foreign_keys=[updated_by_id])
    events: Mapped[list[ContractEvent]] = relationship(
        back_populates="contract", order_by="ContractEvent.created_at"
    )
    attachments: Mapped[list[ContractAttachment]] = relationship(
        back_populates="contract", order_by="ContractAttachment.version"
    )

    __mapper_args__ = {"version_id_col": lock_version}


class ContractEvent(Base):
    __tablename__ = "contract_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    contract_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("employment_contracts.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    contract: Mapped[EmploymentContract] = relationship(back_populates="events")
    actor: Mapped[User] = relationship(foreign_keys=[actor_id])


class ContractAttachment(Base):
    __tablename__ = "contract_attachments"
    __table_args__ = (
        UniqueConstraint("contract_id", "version", name="uq_contract_attachment_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    contract_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("employment_contracts.id", ondelete="CASCADE"), nullable=False
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

    contract: Mapped[EmploymentContract] = relationship(back_populates="attachments")


def _reject_history_mutation(_mapper: Mapper[object], _connection: object, _target: object) -> None:
    raise RuntimeError("Contract history is immutable")


for _history_model in (ContractEvent,):
    event.listen(_history_model, "before_update", _reject_history_mutation)
    event.listen(_history_model, "before_delete", _reject_history_mutation)
