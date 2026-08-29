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
from nexa_bos_api.identity.models import new_uuid


class CommissionRule(Base):
    __tablename__ = "commission_rules"
    __table_args__ = (
        UniqueConstraint("bank_id", "product_id", "eligibility_milestone", "version"),
        CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from",
            name="commission_rules_check",
        ),
        Index(
            "ix_commission_rules_resolution",
            "bank_id",
            "product_id",
            "eligibility_milestone",
            "status",
            "effective_from",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    bank_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("banks.id"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id"), nullable=False)
    eligibility_milestone: Mapped[str] = mapped_column(String(20), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    payout_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    calculation_method: Mapped[str | None] = mapped_column(String(32))
    fixed_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    percentage_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    flat_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activated_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))

    recipients: Mapped[list[CommissionRuleRecipient]] = relationship(
        back_populates="rule", order_by="CommissionRuleRecipient.sort_order"
    )
    slabs: Mapped[list[CommissionRuleSlab]] = relationship(
        back_populates="rule", order_by="CommissionRuleSlab.sort_order"
    )


class CommissionRuleRecipient(Base):
    __tablename__ = "commission_rule_recipients"
    __table_args__ = (
        UniqueConstraint("rule_id", "role_code"),
        UniqueConstraint("rule_id", "sort_order"),
        CheckConstraint(
            "split_percent IS NULL OR (split_percent > 0 AND split_percent <= 100)",
            name="commission_rule_recipients_split_percent_check",
        ),
        CheckConstraint(
            "(recipient_source = 'case_owner' AND hierarchy_level IS NULL) OR "
            "(recipient_source = 'reporting_manager' AND hierarchy_level >= 1)",
            name="commission_rule_recipients_check",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    rule_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("commission_rules.id"), nullable=False
    )
    role_code: Mapped[str] = mapped_column(String(64), nullable=False)
    role_name: Mapped[str] = mapped_column(String(120), nullable=False)
    recipient_source: Mapped[str] = mapped_column(String(32), nullable=False)
    hierarchy_level: Mapped[int | None] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    split_percent: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    calculation_method: Mapped[str | None] = mapped_column(String(32))
    fixed_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    percentage_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    flat_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    rule: Mapped[CommissionRule] = relationship(back_populates="recipients")
    slabs: Mapped[list[CommissionRuleSlab]] = relationship(
        back_populates="recipient", order_by="CommissionRuleSlab.sort_order"
    )


class CommissionRuleSlab(Base):
    __tablename__ = "commission_rule_slabs"
    __table_args__ = (
        UniqueConstraint("rule_id", "recipient_id", "sort_order"),
        CheckConstraint(
            "minimum_eligible >= 0", name="commission_rule_slabs_minimum_eligible_check"
        ),
        CheckConstraint(
            "maximum_eligible IS NULL OR maximum_eligible >= minimum_eligible",
            name="commission_rule_slabs_check",
        ),
        CheckConstraint("payout_amount >= 0", name="commission_rule_slabs_payout_amount_check"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    rule_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("commission_rules.id"), nullable=False
    )
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("commission_rule_recipients.id")
    )
    minimum_eligible: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    maximum_eligible: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    payout_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)

    rule: Mapped[CommissionRule] = relationship(back_populates="slabs")
    recipient: Mapped[CommissionRuleRecipient | None] = relationship(back_populates="slabs")


class IncentivePlan(Base):
    __tablename__ = "incentive_plans"
    __table_args__ = (
        UniqueConstraint("name", "version"),
        CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from",
            name="incentive_plans_check",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activated_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))

    slabs: Mapped[list[IncentiveSlab]] = relationship(
        back_populates="plan", order_by="IncentiveSlab.sort_order"
    )


class IncentiveSlab(Base):
    __tablename__ = "incentive_slabs"
    __table_args__ = (
        UniqueConstraint("plan_id", "sort_order"),
        CheckConstraint("minimum_production >= 0", name="incentive_slabs_minimum_production_check"),
        CheckConstraint(
            "maximum_production IS NULL OR maximum_production >= minimum_production",
            name="incentive_slabs_check",
        ),
        CheckConstraint("payout_amount >= 0", name="incentive_slabs_payout_amount_check"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("incentive_plans.id"), nullable=False
    )
    minimum_production: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    maximum_production: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    payout_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)

    plan: Mapped[IncentivePlan] = relationship(back_populates="slabs")


class FinancePayoutPeriod(Base):
    __tablename__ = "finance_payout_periods"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    period_month: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    generated_by_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finalized_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))


class FinanceComponent(Base):
    __tablename__ = "finance_components"
    __table_args__ = (
        CheckConstraint("amount = round(amount, 2)", name="finance_components_amount_check"),
        CheckConstraint(
            "component_type <> 'clawback' OR amount < 0", name="finance_components_check"
        ),
        Index("ix_finance_components_period_recipient", "period_id", "recipient_id"),
        Index(
            "uq_finance_commission_component",
            "period_id",
            "application_id",
            "recipient_id",
            "role_code",
            "eligibility_milestone",
            unique=True,
            postgresql_where=text("component_type = 'commission'"),
        ),
        Index(
            "uq_finance_incentive_component",
            "period_id",
            "recipient_id",
            unique=True,
            postgresql_where=text("component_type = 'incentive'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    period_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("finance_payout_periods.id"), nullable=False
    )
    application_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("applications.id"))
    recipient_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    component_type: Mapped[str] = mapped_column(String(20), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    eligible_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    eligibility_milestone: Mapped[str | None] = mapped_column(String(20))
    eligibility_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    commission_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("commission_rules.id")
    )
    incentive_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("incentive_plans.id")
    )
    original_component_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("finance_components.id")
    )
    role_code: Mapped[str | None] = mapped_column(String(64))
    role_name: Mapped[str | None] = mapped_column(String(120))
    attribution_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    calculation_method: Mapped[str | None] = mapped_column(String(32))
    calculation_evidence: Mapped[dict | None] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class FinancePayout(Base):
    __tablename__ = "finance_payouts"
    __table_args__ = (
        UniqueConstraint("period_id", "recipient_id"),
        CheckConstraint("payable_amount >= 0", name="finance_payouts_payable_amount_check"),
        CheckConstraint("carry_forward <= 0", name="finance_payouts_carry_forward_check"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    period_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("finance_payout_periods.id"), nullable=False
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    previous_payout_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("finance_payouts.id")
    )
    previous_carry: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    commission_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    incentive_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    adjustment_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    clawback_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    payable_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    carry_forward: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class FinancePeriodTransition(Base):
    __tablename__ = "finance_period_transitions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    period_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("finance_payout_periods.id"), nullable=False, index=True
    )
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def _reject_finance_history_mutation(
    _mapper: Mapper[object], _connection: object, _target: object
) -> None:
    raise RuntimeError("Finance component and transition history records are immutable")


event.listen(FinanceComponent, "before_update", _reject_finance_history_mutation)
event.listen(FinanceComponent, "before_delete", _reject_finance_history_mutation)
event.listen(FinancePeriodTransition, "before_update", _reject_finance_history_mutation)
event.listen(FinancePeriodTransition, "before_delete", _reject_finance_history_mutation)
