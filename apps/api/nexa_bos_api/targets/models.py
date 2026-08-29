from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
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


class PerformanceTarget(Base):
    __tablename__ = "performance_targets"
    __table_args__ = (
        Index(
            "uq_targets_active_overall",
            "level",
            "entity_id",
            "period_month",
            "product_id",
            "milestone",
            unique=True,
            postgresql_where=text("status = 'active' AND bank_id IS NULL"),
        ),
        Index(
            "uq_targets_active_bank",
            "level",
            "entity_id",
            "period_month",
            "product_id",
            "milestone",
            "bank_id",
            unique=True,
            postgresql_where=text("status = 'active' AND bank_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    level: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    period_month: Mapped[date] = mapped_column(Date, nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id"), nullable=False)
    bank_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("banks.id"))
    milestone: Mapped[str] = mapped_column(String(20), nullable=False)
    measurement: Mapped[str] = mapped_column(String(20), nullable=False)
    target_value: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    prorate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)

    changes: Mapped[list[TargetChange]] = relationship(
        back_populates="target",
        order_by="TargetChange.created_at",
    )


class TargetChange(Base):
    __tablename__ = "target_changes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    target_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("performance_targets.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    old_values: Mapped[dict] = mapped_column(JSONB, nullable=False)
    new_values: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    target: Mapped[PerformanceTarget] = relationship(back_populates="changes")
    actor: Mapped[User] = relationship(foreign_keys=[actor_id])


class TargetPeriodLock(Base):
    __tablename__ = "target_period_locks"

    period_month: Mapped[date] = mapped_column(Date, primary_key=True)
    locked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    locked_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)


class TargetPeriodReopen(Base):
    __tablename__ = "target_period_reopens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    period_month: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class KpiScorecard(Base):
    __tablename__ = "kpi_scorecards"
    __table_args__ = (
        Index(
            "uq_kpi_scorecards_active",
            text("(true)"),
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)

    metrics: Mapped[list[KpiScorecardMetric]] = relationship(
        back_populates="scorecard",
        cascade="all, delete-orphan",
        order_by="KpiScorecardMetric.sort_order",
    )


class KpiScorecardMetric(Base):
    __tablename__ = "kpi_scorecard_metrics"
    __table_args__ = (UniqueConstraint("scorecard_id", "metric_code"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    scorecard_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("kpi_scorecards.id", ondelete="CASCADE"), nullable=False
    )
    metric_code: Mapped[str] = mapped_column(String(64), nullable=False)
    weight_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    direction: Mapped[str] = mapped_column(String(32), nullable=False)
    baseline: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    scorecard: Mapped[KpiScorecard] = relationship(back_populates="metrics")


def _reject_history_mutation(_mapper: Mapper[object], _connection: object, _target: object) -> None:
    raise RuntimeError("Target and KPI history records are immutable")


event.listen(TargetChange, "before_update", _reject_history_mutation)
event.listen(TargetChange, "before_delete", _reject_history_mutation)
event.listen(TargetPeriodReopen, "before_update", _reject_history_mutation)
event.listen(TargetPeriodReopen, "before_delete", _reject_history_mutation)
