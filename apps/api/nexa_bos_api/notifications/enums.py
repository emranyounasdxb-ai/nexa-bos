from __future__ import annotations

from enum import StrEnum


class NotificationCategory(StrEnum):
    OPERATIONS = "operations"
    PERFORMANCE = "performance"
    FINANCE = "finance"
    ATTENDANCE_HOLIDAY = "attendance_holiday"
    SECURITY_ADMIN = "security_admin"
    SYSTEM = "system"


class NotificationSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    URGENT = "urgent"


class NotificationRuleStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    INACTIVE = "inactive"


class NotificationTargetType(StrEnum):
    AFFECTED_USER = "affected_user"
    REPORTING_MANAGER = "reporting_manager"
    USER_TYPE = "user_type"
    OFFICE = "office"
    TEAM = "team"
    COMPANY = "company"


class NotificationEventType(StrEnum):
    APPLICATION_STAGE_CHANGED = "operations.application_stage_changed"
    TARGET_STATUS_CHANGED = "performance.target_status_changed"
    FINANCE_PERIOD_STATUS_CHANGED = "finance.period_status_changed"
    ATTENDANCE_RECORD_CORRECTED = "attendance.record_corrected"
    SECURITY_USER_STATUS_CHANGED = "security.user_status_changed"
    HOLIDAY_REMINDER = "attendance.holiday_reminder"
    URGENT_BROADCAST = "system.urgent_broadcast"


EVENT_CATEGORY: dict[NotificationEventType, NotificationCategory] = {
    NotificationEventType.APPLICATION_STAGE_CHANGED: NotificationCategory.OPERATIONS,
    NotificationEventType.TARGET_STATUS_CHANGED: NotificationCategory.PERFORMANCE,
    NotificationEventType.FINANCE_PERIOD_STATUS_CHANGED: NotificationCategory.FINANCE,
    NotificationEventType.ATTENDANCE_RECORD_CORRECTED: NotificationCategory.ATTENDANCE_HOLIDAY,
    NotificationEventType.SECURITY_USER_STATUS_CHANGED: NotificationCategory.SECURITY_ADMIN,
    NotificationEventType.HOLIDAY_REMINDER: NotificationCategory.ATTENDANCE_HOLIDAY,
    NotificationEventType.URGENT_BROADCAST: NotificationCategory.SYSTEM,
}


RULE_EVENT_TYPES: tuple[NotificationEventType, ...] = (
    NotificationEventType.APPLICATION_STAGE_CHANGED,
    NotificationEventType.TARGET_STATUS_CHANGED,
    NotificationEventType.FINANCE_PERIOD_STATUS_CHANGED,
    NotificationEventType.ATTENDANCE_RECORD_CORRECTED,
    NotificationEventType.SECURITY_USER_STATUS_CHANGED,
)
