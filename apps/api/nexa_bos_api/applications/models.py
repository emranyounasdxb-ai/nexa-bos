from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import new_uuid


class ApplicationCodeCounter(Base):
    __tablename__ = "application_code_counters"

    product_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    bank_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Workflow(Base):
    __tablename__ = "workflows"
    __table_args__ = (UniqueConstraint("bank_id", "product_id", "version"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    bank_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("banks.id"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    stages: Mapped[list[WorkflowStage]] = relationship(back_populates="workflow")
    transitions: Mapped[list[WorkflowTransition]] = relationship(back_populates="workflow")


class WorkflowStage(Base):
    __tablename__ = "workflow_stages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    system_key: Mapped[str | None] = mapped_column(String(64))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    workflow: Mapped[Workflow] = relationship(back_populates="stages")


class WorkflowTransition(Base):
    __tablename__ = "workflow_transitions"
    __table_args__ = (UniqueConstraint("workflow_id", "from_stage_id", "to_stage_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_stage_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workflow_stages.id"), nullable=False
    )
    to_stage_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workflow_stages.id"), nullable=False
    )

    workflow: Mapped[Workflow] = relationship(back_populates="transitions")


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        Index(
            "uq_applications_active_customer_bank_product",
            "customer_id",
            "bank_id",
            "product_id",
            unique=True,
            postgresql_where=text("terminal_outcome IS NULL"),
        ),
        Index(
            "uq_applications_bank_case_number",
            "bank_id",
            "bank_case_number",
            unique=True,
            postgresql_where=text("bank_case_number IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    application_code: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("customers.id"), nullable=False, index=True
    )
    bank_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("banks.id"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id"), nullable=False)
    product_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("product_variants.id"), nullable=True, index=True
    )
    workflow_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("workflows.id"), nullable=False)
    current_stage_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workflow_stages.id"), nullable=False
    )
    terminal_outcome: Mapped[str | None] = mapped_column(String(32))
    terminal_reason: Mapped[str | None] = mapped_column(Text)
    case_owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    requested_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    approved_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    booked_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    funded_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    bank_case_number: Mapped[str | None] = mapped_column(String(64))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    submitted_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    booked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fund_released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tat_stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ApplicationOwnerHistory(Base):
    __tablename__ = "application_owner_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    office_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("offices.id"))
    department_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("departments.id"))
    team_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("teams.id"))
    office_name: Mapped[str | None] = mapped_column(String(120))
    department_name: Mapped[str | None] = mapped_column(String(120))
    team_name: Mapped[str | None] = mapped_column(String(120))
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApplicationCaseNumberHistory(Base):
    __tablename__ = "application_case_number_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value: Mapped[str] = mapped_column(String(64), nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    changed_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)


class ApplicationEvent(Base):
    __tablename__ = "application_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    previous_stage_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("workflow_stages.id")
    )
    new_stage_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("workflow_stages.id"))
    bank_stage_date: Mapped[date | None] = mapped_column(Date)
    stage_note: Mapped[str | None] = mapped_column(Text)
    bos_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONB)
    correction_of_event_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("application_events.id")
    )
    reason: Mapped[str | None] = mapped_column(Text)


class ApplicationStageOccupancy(Base):
    __tablename__ = "application_stage_occupancies"
    __table_args__ = (
        Index("ix_application_stage_occupancies_application_id", "application_id"),
        Index(
            "uq_application_stage_occupancies_open",
            "application_id",
            unique=True,
            postgresql_where=text("exited_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    stage_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workflow_stages.id"), nullable=False
    )
    entered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    exited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    bank_stage_date: Mapped[date | None] = mapped_column(Date)
    stage_note: Mapped[str | None] = mapped_column(Text)
    bos_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)


class ApplicationDelay(Base):
    __tablename__ = "application_delays"
    __table_args__ = (
        Index("ix_application_delays_application_id", "application_id"),
        Index(
            "uq_application_delays_one_active",
            "application_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    stage_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workflow_stages.id"), nullable=False
    )
    delay_type: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    other_explanation: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    marked_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    marked_event_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("application_events.id")
    )
    closed_cause: Mapped[str | None] = mapped_column(String(32))


class ApplicationDelayCorrection(Base):
    __tablename__ = "application_delay_corrections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    delay_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("application_delays.id", ondelete="CASCADE"), nullable=False, index=True
    )
    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("application_events.id"))
