from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from nexa_bos_api.notifications.enums import (
    NotificationCategory,
    NotificationEventType,
    NotificationSeverity,
    NotificationTargetType,
)


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NotificationTargetInput(StrictRequest):
    target_type: NotificationTargetType
    target_id: UUID | None = None


class NotificationRuleUpsertRequest(StrictRequest):
    name: str = Field(min_length=1, max_length=120)
    event_type: NotificationEventType
    severity: NotificationSeverity
    title: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=1000)
    acknowledgement_required: bool = False
    targets: list[NotificationTargetInput] = Field(min_length=1, max_length=50)


class UrgentNotificationRequest(StrictRequest):
    category: NotificationCategory
    title: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=1000)
    acknowledgement_required: bool = False
    affected_user_id: UUID | None = None
    targets: list[NotificationTargetInput] = Field(min_length=1, max_length=50)
