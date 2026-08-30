from __future__ import annotations

import uuid
from datetime import date, datetime

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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import Office, User, new_uuid


class AssetCodeCounter(Base):
    __tablename__ = "asset_code_counters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AssetCategory(Base):
    __tablename__ = "asset_categories"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'inactive')",
            name="asset_categories_status_check",
        ),
        CheckConstraint(
            "jsonb_typeof(field_definitions) = 'array'",
            name="asset_categories_field_definitions_check",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    field_definitions: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    assets: Mapped[list[Asset]] = relationship(back_populates="category")


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        CheckConstraint(
            "status IN ('In Stock', 'Allocated', 'Under Repair', 'Damaged', 'Lost', 'Retired')",
            name="assets_status_check",
        ),
        CheckConstraint(
            "condition IN ('New', 'Good', 'Fair', 'Damaged')",
            name="assets_condition_check",
        ),
        CheckConstraint(
            "jsonb_typeof(attributes) = 'object'",
            name="assets_attributes_check",
        ),
        Index("ix_assets_office_status", "office_id", "status"),
        Index("ix_assets_category_status", "category_id", "status"),
        Index(
            "uq_assets_serial_number",
            "serial_number",
            unique=True,
            postgresql_where=text("serial_number IS NOT NULL"),
        ),
        Index(
            "uq_assets_imei",
            "imei",
            unique=True,
            postgresql_where=text("imei IS NOT NULL"),
        ),
        Index(
            "uq_assets_iccid",
            "iccid",
            unique=True,
            postgresql_where=text("iccid IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    asset_code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("asset_categories.id"), nullable=False
    )
    office_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("offices.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    condition: Mapped[str] = mapped_column(String(20), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(120))
    model: Mapped[str | None] = mapped_column(String(120))
    serial_number: Mapped[str | None] = mapped_column(String(160))
    imei: Mapped[str | None] = mapped_column(String(32))
    iccid: Mapped[str | None] = mapped_column(String(64))
    mobile_number: Mapped[str | None] = mapped_column(String(32))
    operator: Mapped[str | None] = mapped_column(String(120))
    attributes: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False, default=dict)
    description: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    category: Mapped[AssetCategory] = relationship(back_populates="assets")
    office: Mapped[Office] = relationship()
    allocations: Mapped[list[AssetAllocation]] = relationship(
        back_populates="asset",
        order_by="AssetAllocation.issue_date.desc()",
    )
    office_history: Mapped[list[AssetOfficeCustody]] = relationship(
        back_populates="asset",
        order_by="AssetOfficeCustody.started_on.desc()",
    )


class AssetAllocation(Base):
    __tablename__ = "asset_allocations"
    __table_args__ = (
        CheckConstraint(
            "condition_at_issue IN ('New', 'Good', 'Fair', 'Damaged')",
            name="asset_allocations_issue_condition_check",
        ),
        CheckConstraint(
            "return_condition IS NULL OR return_condition IN ('New', 'Good', 'Fair', 'Damaged')",
            name="asset_allocations_return_condition_check",
        ),
        CheckConstraint(
            "end_type IS NULL OR end_type IN ('return', 'employee_transfer')",
            name="asset_allocations_end_type_check",
        ),
        CheckConstraint(
            "(return_date IS NULL AND received_by_id IS NULL AND return_condition IS NULL "
            "AND end_type IS NULL) OR "
            "(return_date IS NOT NULL AND received_by_id IS NOT NULL "
            "AND return_condition IS NOT NULL AND end_type IS NOT NULL)",
            name="asset_allocations_closure_check",
        ),
        CheckConstraint(
            "return_date IS NULL OR return_date >= issue_date",
            name="asset_allocations_dates_check",
        ),
        Index(
            "uq_asset_allocations_active",
            "asset_id",
            unique=True,
            postgresql_where=text("return_date IS NULL"),
        ),
        Index("ix_asset_allocations_employee_active", "employee_id", "return_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    asset_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("assets.id"), nullable=False)
    employee_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    issued_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    condition_at_issue: Mapped[str] = mapped_column(String(20), nullable=False)
    issue_remarks: Mapped[str | None] = mapped_column(Text)
    return_date: Mapped[date | None] = mapped_column(Date)
    received_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    return_condition: Mapped[str | None] = mapped_column(String(20))
    return_remarks: Mapped[str | None] = mapped_column(Text)
    end_type: Mapped[str | None] = mapped_column(String(30))
    previous_allocation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("asset_allocations.id")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    asset: Mapped[Asset] = relationship(back_populates="allocations")
    employee: Mapped[User] = relationship(foreign_keys=[employee_id])
    issued_by: Mapped[User] = relationship(foreign_keys=[issued_by_id])
    received_by: Mapped[User | None] = relationship(foreign_keys=[received_by_id])


class AssetOfficeCustody(Base):
    __tablename__ = "asset_office_custody_history"
    __table_args__ = (
        CheckConstraint(
            "ended_on IS NULL OR ended_on >= started_on",
            name="asset_office_custody_dates_check",
        ),
        Index(
            "uq_asset_office_custody_active",
            "asset_id",
            unique=True,
            postgresql_where=text("ended_on IS NULL"),
        ),
        Index("ix_asset_office_custody_office", "office_id", "ended_on"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    asset_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("assets.id"), nullable=False)
    office_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("offices.id"), nullable=False)
    started_on: Mapped[date] = mapped_column(Date, nullable=False)
    ended_on: Mapped[date | None] = mapped_column(Date)
    transferred_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    reason: Mapped[str | None] = mapped_column(Text)
    previous_custody_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("asset_office_custody_history.id")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    asset: Mapped[Asset] = relationship(back_populates="office_history")
    office: Mapped[Office] = relationship()
    transferred_by: Mapped[User] = relationship(foreign_keys=[transferred_by_id])
