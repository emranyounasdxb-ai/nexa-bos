from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Mapper, mapped_column

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import new_uuid


class CardPointRule(Base):
    __tablename__ = "card_point_rules"
    __table_args__ = (
        UniqueConstraint("bank_id", "product_variant_id", "version"),
        CheckConstraint("points >= 0", name="card_point_rules_points_check"),
        CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from",
            name="card_point_rules_effective_dates_check",
        ),
        CheckConstraint(
            "status IN ('draft', 'active', 'inactive')",
            name="card_point_rules_status_check",
        ),
        Index(
            "ix_card_point_rules_resolution",
            "bank_id",
            "product_variant_id",
            "status",
            "effective_from",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    bank_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("banks.id"), nullable=False)
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("product_variants.id"), nullable=False
    )
    version: Mapped[int] = mapped_column(nullable=False)
    points: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activated_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))


class LaneRoutingAssignment(Base):
    __tablename__ = "lane_routing_assignments"
    __table_args__ = (
        UniqueConstraint("office_id", "product_id"),
        CheckConstraint(
            "status IN ('active', 'inactive')", name="lane_routing_assignments_status_check"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    office_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("offices.id"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id"), nullable=False)
    sales_manager_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    coordinator_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)


class CaseEarning(Base):
    __tablename__ = "case_earnings"
    __table_args__ = (
        UniqueConstraint("application_id", "earning_type"),
        CheckConstraint("amount >= 0", name="case_earnings_amount_check"),
        CheckConstraint(
            "earning_type IN ('card_points', 'pf_commission')",
            name="case_earnings_type_check",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id"), nullable=False, index=True
    )
    case_owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    earning_type: Mapped[str] = mapped_column(String(24), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    card_point_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("card_point_rules.id")
    )
    commission_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("commission_rules.id")
    )
    source_event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("application_events.id"), nullable=False
    )
    rule_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    earned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ClawbackRequest(Base):
    __tablename__ = "case_clawback_requests"
    __table_args__ = (
        CheckConstraint("amount > 0", name="case_clawback_requests_amount_check"),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="case_clawback_requests_status_check",
        ),
        Index(
            "uq_case_clawback_active_request",
            "earning_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    earning_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("case_earnings.id"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    submitted_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_reason: Mapped[str | None] = mapped_column(Text)


class CaseEarningReversal(Base):
    __tablename__ = "case_earning_reversals"
    __table_args__ = (
        UniqueConstraint("clawback_request_id"),
        CheckConstraint("amount > 0", name="case_earning_reversals_amount_check"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    earning_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("case_earnings.id"), nullable=False, index=True
    )
    clawback_request_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("case_clawback_requests.id"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    approved_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    reversed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class OverdueNotificationDispatch(Base):
    __tablename__ = "case_overdue_notification_dispatches"
    __table_args__ = (
        UniqueConstraint("occupancy_id", "recipient_id", "reminder_date"),
        Index("ix_case_overdue_dispatch_application_id", "application_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id"), nullable=False
    )
    occupancy_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("application_stage_occupancies.id"), nullable=False
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    reminder_date: Mapped[date] = mapped_column(Date, nullable=False)
    notification_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("notifications.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def _reject_immutable_mutation(
    _mapper: Mapper[object], _connection: object, _target: object
) -> None:
    raise RuntimeError("Case earnings, reversals, and overdue dispatch history are immutable")


for _model in (CaseEarning, CaseEarningReversal, OverdueNotificationDispatch):
    event.listen(_model, "before_update", _reject_immutable_mutation)
    event.listen(_model, "before_delete", _reject_immutable_mutation)
