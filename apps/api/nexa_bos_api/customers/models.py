from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import new_uuid


class CustomerCodeCounter(Base):
    __tablename__ = "customer_code_counters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    customer_code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    customer_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(200))
    company_name: Mapped[str | None] = mapped_column(String(200))
    contact_person: Mapped[str | None] = mapped_column(String(200))
    mobile: Mapped[str] = mapped_column(String(32), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    emirates_id: Mapped[str | None] = mapped_column(String(64))
    passport: Mapped[str | None] = mapped_column(String(64))
    employer: Mapped[str | None] = mapped_column(String(200))
    trade_license: Mapped[str | None] = mapped_column(String(64))
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("customers.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    merged_into: Mapped[Customer | None] = relationship(
        remote_side="Customer.id", foreign_keys=[merged_into_id]
    )
    identifier_history: Mapped[list[CustomerIdentifierHistory]] = relationship(
        back_populates="customer",
        foreign_keys="CustomerIdentifierHistory.customer_id",
    )
    field_history: Mapped[list[CustomerFieldHistory]] = relationship(back_populates="customer")


class CustomerIdentifierHistory(Base):
    __tablename__ = "customer_identifier_history"
    __table_args__ = (UniqueConstraint("kind", "value_normalized"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[str] = mapped_column(String(64), nullable=False)
    value_normalized: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    customer: Mapped[Customer] = relationship(
        back_populates="identifier_history", foreign_keys=[customer_id]
    )


class CustomerFieldHistory(Base):
    __tablename__ = "customer_field_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field: Mapped[str] = mapped_column(String(40), nullable=False)
    value: Mapped[str | None] = mapped_column(String(320))
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    customer: Mapped[Customer] = relationship(back_populates="field_history")


class CustomerMerge(Base):
    __tablename__ = "customer_merges"
    __table_args__ = (UniqueConstraint("source_customer_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    source_customer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("customers.id"), nullable=False
    )
    primary_customer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("customers.id"), nullable=False, index=True
    )
    merged_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    merged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_customer_code: Mapped[str] = mapped_column(String(16), nullable=False)
