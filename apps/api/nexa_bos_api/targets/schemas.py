from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from nexa_bos_api.targets.enums import (
    KpiDirection,
    MeasurementMode,
    TargetLevel,
    TargetMilestone,
)


class TargetCreateRequest(BaseModel):
    level: TargetLevel
    entity_id: UUID
    period_month: date
    product_id: UUID
    bank_id: UUID | None = None
    milestone: TargetMilestone
    measurement: MeasurementMode | None = None
    target_value: Decimal = Field(ge=0)
    prorate: bool = False


class TargetUpdateRequest(BaseModel):
    target_value: Decimal | None = Field(default=None, ge=0)
    prorate: bool | None = None
    measurement: MeasurementMode | None = None
    reason: str = Field(min_length=1, max_length=2000)


class TargetPeriodReopenRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class KpiMetricInput(BaseModel):
    metric_code: str = Field(min_length=1, max_length=64)
    weight_percent: Decimal = Field(gt=0, le=100)
    direction: KpiDirection
    baseline: Decimal | None = Field(default=None, ge=0)
    sort_order: int | None = None


class KpiScorecardCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    metrics: list[KpiMetricInput] = Field(default_factory=list)


class KpiScorecardUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    metrics: list[KpiMetricInput] | None = None
