from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.models import new_uuid


class NotificationRule(Base):
    __tablename__ = "notification_rules"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ("
            "'operations.application_stage_changed', "
            "'performance.target_status_changed', "
            "'finance.period_status_changed', "
            "'attendance.record_corrected', "
            "'security.user_status_changed')",
            name="notification_rules_event_type_check",
        ),
        CheckConstraint(
            "category IN ('operations', 'performance', 'finance', "
            "'attendance_holiday', 'security_admin', 'system')",
            name="notification_rules_category_check",
        ),
        CheckConstraint(
            "severity IN ('info', 'warning', 'critical', 'urgent')",
            name="notification_rules_severity_check",
        ),
        CheckConstraint(
            "status IN ('draft', 'active', 'inactive')",
            name="notification_rules_status_check",
        ),
        CheckConstraint(
            "NOT acknowledgement_required OR severity IN ('critical', 'urgent')",
            name="notification_rules_acknowledgement_check",
        ),
        Index("ix_notification_rules_event_status", "event_type", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    acknowledgement_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    activated_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    targets: Mapped[list[NotificationRuleTarget]] = relationship(
        back_populates="rule",
        cascade="all, delete-orphan",
        order_by="NotificationRuleTarget.target_type",
    )


class NotificationRuleTarget(Base):
    __tablename__ = "notification_rule_targets"
    __table_args__ = (
        CheckConstraint(
            "target_type IN ('affected_user', 'reporting_manager', 'user_type', "
            "'office', 'team', 'company')",
            name="notification_rule_targets_type_check",
        ),
        CheckConstraint(
            "(target_type IN ('affected_user', 'reporting_manager', 'company') "
            "AND user_type_id IS NULL AND office_id IS NULL AND team_id IS NULL) OR "
            "(target_type = 'user_type' AND user_type_id IS NOT NULL "
            "AND office_id IS NULL AND team_id IS NULL) OR "
            "(target_type = 'office' AND office_id IS NOT NULL "
            "AND user_type_id IS NULL AND team_id IS NULL) OR "
            "(target_type = 'team' AND team_id IS NOT NULL "
            "AND user_type_id IS NULL AND office_id IS NULL)",
            name="notification_rule_targets_reference_check",
        ),
        Index(
            "uq_notification_rule_targets_dynamic",
            "rule_id",
            "target_type",
            unique=True,
            postgresql_where=text(
                "target_type IN ('affected_user', 'reporting_manager', 'company')"
            ),
        ),
        Index(
            "uq_notification_rule_targets_user_type",
            "rule_id",
            "user_type_id",
            unique=True,
            postgresql_where=text("target_type = 'user_type'"),
        ),
        Index(
            "uq_notification_rule_targets_office",
            "rule_id",
            "office_id",
            unique=True,
            postgresql_where=text("target_type = 'office'"),
        ),
        Index(
            "uq_notification_rule_targets_team",
            "rule_id",
            "team_id",
            unique=True,
            postgresql_where=text("target_type = 'team'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    rule_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("notification_rules.id"), nullable=False
    )
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    user_type_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("user_types.id"))
    office_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("offices.id"))
    team_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("teams.id"))

    rule: Mapped[NotificationRule] = relationship(back_populates="targets")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "category IN ('operations', 'performance', 'finance', "
            "'attendance_holiday', 'security_admin', 'system')",
            name="notifications_category_check",
        ),
        CheckConstraint(
            "severity IN ('info', 'warning', 'critical', 'urgent')",
            name="notifications_severity_check",
        ),
        CheckConstraint(
            "NOT acknowledgement_required OR severity IN ('critical', 'urgent')",
            name="notifications_acknowledgement_check",
        ),
        Index("ix_notifications_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    rule_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("notification_rules.id"))
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    acknowledgement_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    source_event_key: Mapped[str] = mapped_column(String(300), nullable=False)
    deduplication_key: Mapped[str] = mapped_column(String(700), unique=True, nullable=False)
    linked_entity_type: Mapped[str | None] = mapped_column(String(60))
    linked_entity_id: Mapped[str | None] = mapped_column(String(100))
    contextual_link: Mapped[str | None] = mapped_column(String(300))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"
    __table_args__ = (
        UniqueConstraint(
            "notification_id", "recipient_id", name="uq_notification_deliveries_recipient"
        ),
        CheckConstraint(
            "(acknowledged_at IS NULL AND acknowledged_by_id IS NULL) OR "
            "(acknowledged_at IS NOT NULL AND acknowledged_by_id IS NOT NULL)",
            name="notification_deliveries_acknowledgement_check",
        ),
        Index("ix_notification_deliveries_recipient_read", "recipient_id", "read_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    notification_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("notifications.id"), nullable=False
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    delivered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))

    notification: Mapped[Notification] = relationship()
