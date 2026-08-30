from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import (
    has_permission,
    load_user_with_type,
    user_load_options,
    visibility_scope,
    visible_user_ids,
)
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus, MasterStatus, UserTypeStatus, VisibilityScope
from nexa_bos_api.identity.models import AuditEvent, Office, Team, User, UserType, new_uuid
from nexa_bos_api.identity.permissions import (
    NOTIFICATIONS_MANAGE_RULES,
    NOTIFICATIONS_SEND_URGENT,
    NOTIFICATIONS_VIEW,
)
from nexa_bos_api.notifications.enums import (
    EVENT_CATEGORY,
    RULE_EVENT_TYPES,
    NotificationCategory,
    NotificationEventType,
    NotificationRuleStatus,
    NotificationSeverity,
    NotificationTargetType,
)
from nexa_bos_api.notifications.models import (
    Notification,
    NotificationDelivery,
    NotificationRule,
    NotificationRuleTarget,
)
from nexa_bos_api.notifications.schemas import (
    NotificationRuleUpsertRequest,
    NotificationTargetInput,
    UrgentNotificationRequest,
)


def utcnow() -> datetime:
    return datetime.now(UTC)


def _clean_text(value: str, *, label: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise AppError(
            status_code=422,
            code="NOTIFICATION_TEXT_REQUIRED",
            message=f"{label} is required",
        )
    return cleaned


def _rule_options():
    return (selectinload(NotificationRule.targets),)


async def _get_rule(
    session: AsyncSession, rule_id: UUID, *, lock: bool = False
) -> NotificationRule:
    stmt = select(NotificationRule).options(*_rule_options()).where(NotificationRule.id == rule_id)
    if lock:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise AppError(
            status_code=404,
            code="NOTIFICATION_RULE_NOT_FOUND",
            message="Notification rule was not found",
        )
    return row


async def _active_notification_users(session: AsyncSession) -> list[User]:
    rows = list(
        (
            await session.execute(
                select(User)
                .options(*user_load_options())
                .where(User.account_status == AccountStatus.ACTIVE)
            )
        ).scalars()
    )
    return [
        row
        for row in rows
        if row.user_type is not None
        and row.user_type.status == UserTypeStatus.ACTIVE
        and has_permission(row, NOTIFICATIONS_VIEW)
    ]


def _target_reference(
    item: NotificationTargetInput,
) -> tuple[UUID | None, UUID | None, UUID | None]:
    if item.target_type == NotificationTargetType.USER_TYPE:
        return item.target_id, None, None
    if item.target_type == NotificationTargetType.OFFICE:
        return None, item.target_id, None
    if item.target_type == NotificationTargetType.TEAM:
        return None, None, item.target_id
    return None, None, None


def _validate_target_shapes(targets: list[NotificationTargetInput]) -> None:
    seen: set[tuple[str, UUID | None]] = set()
    dynamic = {
        NotificationTargetType.AFFECTED_USER,
        NotificationTargetType.REPORTING_MANAGER,
        NotificationTargetType.COMPANY,
    }
    for item in targets:
        if item.target_type in dynamic and item.target_id is not None:
            raise AppError(
                status_code=422,
                code="NOTIFICATION_TARGET_INVALID",
                message=f"{item.target_type.value} cannot include a target ID",
            )
        if item.target_type not in dynamic and item.target_id is None:
            raise AppError(
                status_code=422,
                code="NOTIFICATION_TARGET_INVALID",
                message=f"{item.target_type.value} requires a target ID",
            )
        key = (item.target_type.value, item.target_id)
        if key in seen:
            raise AppError(
                status_code=422,
                code="NOTIFICATION_TARGET_DUPLICATE",
                message="Notification targets must be unique",
            )
        seen.add(key)


async def _assert_target_authorized(
    session: AsyncSession,
    actor: User,
    target: NotificationTargetInput,
) -> None:
    scope = visibility_scope(actor)
    if target.target_type == NotificationTargetType.COMPANY:
        if scope != VisibilityScope.COMPANY:
            raise AppError(
                status_code=403,
                code="NOTIFICATION_TARGET_OUT_OF_SCOPE",
                message="Company notification targeting is outside your visibility scope",
            )
        return
    if target.target_type == NotificationTargetType.USER_TYPE:
        if scope != VisibilityScope.COMPANY:
            raise AppError(
                status_code=403,
                code="NOTIFICATION_TARGET_OUT_OF_SCOPE",
                message="User Type notification targeting requires company visibility",
            )
        row = await session.get(UserType, target.target_id)
        if row is None or row.status != UserTypeStatus.ACTIVE:
            raise AppError(
                status_code=404,
                code="NOTIFICATION_TARGET_NOT_FOUND",
                message="Notification target was not found",
            )
        return
    if target.target_type == NotificationTargetType.OFFICE:
        row = await session.get(Office, target.target_id)
        if row is None or row.status != MasterStatus.ACTIVE:
            raise AppError(
                status_code=404,
                code="NOTIFICATION_TARGET_NOT_FOUND",
                message="Notification target was not found",
            )
        if scope == VisibilityScope.COMPANY or (
            scope == VisibilityScope.OFFICE and actor.office_id == row.id
        ):
            return
        raise AppError(
            status_code=403,
            code="NOTIFICATION_TARGET_OUT_OF_SCOPE",
            message="Office notification targeting is outside your visibility scope",
        )
    if target.target_type == NotificationTargetType.TEAM:
        row = await session.get(Team, target.target_id)
        if row is None or row.status != MasterStatus.ACTIVE:
            raise AppError(
                status_code=404,
                code="NOTIFICATION_TARGET_NOT_FOUND",
                message="Notification target was not found",
            )
        if scope == VisibilityScope.COMPANY:
            return
        if scope == VisibilityScope.OFFICE and actor.office_id == row.office_id:
            return
        allowed = await visible_user_ids(session, actor)
        team_users = set(
            (await session.execute(select(User.id).where(User.team_id == row.id))).scalars()
        )
        if allowed is not None and team_users and team_users.issubset(allowed):
            return
        if actor.team_id == row.id:
            return
        raise AppError(
            status_code=403,
            code="NOTIFICATION_TARGET_OUT_OF_SCOPE",
            message="Team notification targeting is outside your visibility scope",
        )


async def _validate_targets(
    session: AsyncSession,
    actor: User,
    targets: list[NotificationTargetInput],
    *,
    affected_user_id: UUID | None = None,
) -> None:
    _validate_target_shapes(targets)
    needs_affected = any(
        item.target_type
        in (NotificationTargetType.AFFECTED_USER, NotificationTargetType.REPORTING_MANAGER)
        for item in targets
    )
    if needs_affected and affected_user_id is not None:
        affected = await session.get(User, affected_user_id)
        allowed = await visible_user_ids(session, actor)
        if affected is None or (allowed is not None and affected.id not in allowed):
            raise AppError(
                status_code=404,
                code="NOTIFICATION_TARGET_NOT_FOUND",
                message="Notification target was not found",
            )
    elif needs_affected and affected_user_id is None:
        # Rule events resolve the affected user from the authoritative source event.
        pass
    for item in targets:
        await _assert_target_authorized(session, actor, item)


def _rule_payload_for_audit(rule: NotificationRule) -> dict[str, object]:
    return {
        "eventType": rule.event_type,
        "category": rule.category,
        "severity": rule.severity,
        "acknowledgementRequired": rule.acknowledgement_required,
        "status": rule.status,
        "targetCount": len(rule.targets),
    }


async def _target_payload(session: AsyncSession, row: NotificationRuleTarget) -> dict[str, object]:
    target_id: UUID | None = row.user_type_id or row.office_id or row.team_id
    label: str | None = None
    if row.user_type_id:
        target = await session.get(UserType, row.user_type_id)
        label = target.name if target else None
    elif row.office_id:
        target = await session.get(Office, row.office_id)
        label = target.name if target else None
    elif row.team_id:
        target = await session.get(Team, row.team_id)
        label = target.name if target else None
    return {
        "targetType": row.target_type,
        "targetId": str(target_id) if target_id else None,
        "label": label,
    }


async def serialize_rule(session: AsyncSession, row: NotificationRule) -> dict[str, object]:
    return {
        "id": str(row.id),
        "name": row.name,
        "eventType": row.event_type,
        "category": row.category,
        "severity": row.severity,
        "title": row.title,
        "message": row.message,
        "acknowledgementRequired": row.acknowledgement_required,
        "status": row.status,
        "targets": [await _target_payload(session, item) for item in row.targets],
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
        "activatedAt": row.activated_at.isoformat() if row.activated_at else None,
    }


def _scope_contains(
    actor_allowed: set[UUID] | None,
    effective_allowed: set[UUID] | None,
) -> bool:
    if actor_allowed is None:
        return True
    if effective_allowed is None:
        return False
    return effective_allowed.issubset(actor_allowed)


async def _stored_static_target_within_scope(
    session: AsyncSession,
    actor: User,
    target: NotificationRuleTarget,
    *,
    actor_allowed: set[UUID] | None,
) -> bool:
    scope = visibility_scope(actor)
    target_type = NotificationTargetType(target.target_type)
    if target_type == NotificationTargetType.COMPANY:
        return scope == VisibilityScope.COMPANY
    if target_type == NotificationTargetType.USER_TYPE:
        return scope == VisibilityScope.COMPANY
    if target_type == NotificationTargetType.OFFICE:
        return scope == VisibilityScope.COMPANY or (
            scope == VisibilityScope.OFFICE and actor.office_id == target.office_id
        )
    if target_type != NotificationTargetType.TEAM:
        return False
    team = await session.get(Team, target.team_id)
    if team is None:
        return False
    if scope == VisibilityScope.COMPANY:
        return True
    if scope == VisibilityScope.OFFICE and actor.office_id == team.office_id:
        return True
    team_users = set(
        (await session.execute(select(User.id).where(User.team_id == team.id))).scalars()
    )
    return actor.team_id == team.id or (
        actor_allowed is not None and bool(team_users) and team_users.issubset(actor_allowed)
    )


async def _can_manage_rule(session: AsyncSession, actor: User, row: NotificationRule) -> bool:
    if not row.targets:
        return False
    actor_allowed = await visible_user_ids(session, actor)
    dynamic_types = {
        NotificationTargetType.AFFECTED_USER,
        NotificationTargetType.REPORTING_MANAGER,
    }
    has_dynamic_target = any(
        NotificationTargetType(target.target_type) in dynamic_types for target in row.targets
    )
    dynamic_reach_authorized = True
    if has_dynamic_target:
        creator = await load_user_with_type(session, row.created_by_id)
        if creator is None:
            return False
        creator_allowed = await visible_user_ids(session, creator)
        dynamic_reach_authorized = _scope_contains(actor_allowed, creator_allowed)
    for target in row.targets:
        target_type = NotificationTargetType(target.target_type)
        if target_type in dynamic_types:
            if not dynamic_reach_authorized:
                return False
            continue
        if not await _stored_static_target_within_scope(
            session,
            actor,
            target,
            actor_allowed=actor_allowed,
        ):
            return False
    return True


def _category_for_rule(event_type: NotificationEventType) -> NotificationCategory:
    if event_type not in RULE_EVENT_TYPES:
        raise AppError(
            status_code=422,
            code="NOTIFICATION_EVENT_UNSUPPORTED",
            message="This event type is not configurable as a notification rule",
        )
    return EVENT_CATEGORY[event_type]


def _validate_acknowledgement(severity: str, required: bool) -> None:
    if required and severity not in (
        NotificationSeverity.CRITICAL,
        NotificationSeverity.URGENT,
    ):
        raise AppError(
            status_code=422,
            code="NOTIFICATION_ACKNOWLEDGEMENT_INVALID",
            message="Only Critical or Urgent notifications may require acknowledgement",
        )


def _replace_targets(rule: NotificationRule, targets: list[NotificationTargetInput]) -> None:
    rule.targets.clear()
    for item in targets:
        user_type_id, office_id, team_id = _target_reference(item)
        rule.targets.append(
            NotificationRuleTarget(
                id=new_uuid(),
                rule_id=rule.id,
                target_type=item.target_type.value,
                user_type_id=user_type_id,
                office_id=office_id,
                team_id=team_id,
            )
        )


async def create_rule(
    session: AsyncSession,
    actor: User,
    payload: NotificationRuleUpsertRequest,
) -> dict[str, object]:
    await _validate_targets(session, actor, payload.targets)
    category = _category_for_rule(payload.event_type)
    _validate_acknowledgement(payload.severity.value, payload.acknowledgement_required)
    now = utcnow()
    row = NotificationRule(
        id=new_uuid(),
        name=_clean_text(payload.name, label="Rule name"),
        event_type=payload.event_type.value,
        category=category.value,
        severity=payload.severity.value,
        title=_clean_text(payload.title, label="Notification title"),
        message=_clean_text(payload.message, label="Notification message"),
        acknowledgement_required=payload.acknowledgement_required,
        status=NotificationRuleStatus.DRAFT,
        created_by_id=actor.id,
        updated_by_id=actor.id,
        activated_by_id=None,
        created_at=now,
        updated_at=now,
        activated_at=None,
    )
    session.add(row)
    _replace_targets(row, payload.targets)
    await record_audit(
        session,
        action="notification.rule.create",
        entity_type="notification_rule",
        entity_id=str(row.id),
        actor_id=actor.id,
        new_values=_rule_payload_for_audit(row),
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="NOTIFICATION_RULE_CONFLICT",
            message="Notification rule targets conflict",
        ) from exc
    return await get_rule(session, actor, row.id)


async def update_rule(
    session: AsyncSession,
    actor: User,
    rule_id: UUID,
    payload: NotificationRuleUpsertRequest,
) -> dict[str, object]:
    row = await _get_rule(session, rule_id, lock=True)
    if not await _can_manage_rule(session, actor, row):
        raise AppError(
            status_code=404,
            code="NOTIFICATION_RULE_NOT_FOUND",
            message="Notification rule was not found",
        )
    await _validate_targets(session, actor, payload.targets)
    category = _category_for_rule(payload.event_type)
    _validate_acknowledgement(payload.severity.value, payload.acknowledgement_required)
    old = _rule_payload_for_audit(row)
    row.name = _clean_text(payload.name, label="Rule name")
    row.event_type = payload.event_type.value
    row.category = category.value
    row.severity = payload.severity.value
    row.title = _clean_text(payload.title, label="Notification title")
    row.message = _clean_text(payload.message, label="Notification message")
    row.acknowledgement_required = payload.acknowledgement_required
    row.updated_by_id = actor.id
    row.updated_at = utcnow()
    _replace_targets(row, payload.targets)
    await record_audit(
        session,
        action="notification.rule.update",
        entity_type="notification_rule",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values=old,
        new_values=_rule_payload_for_audit(row),
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="NOTIFICATION_RULE_CONFLICT",
            message="Notification rule targets conflict",
        ) from exc
    return await get_rule(session, actor, row.id)


async def list_rules(session: AsyncSession, actor: User) -> dict[str, object]:
    rows = list(
        (
            await session.execute(
                select(NotificationRule)
                .options(*_rule_options())
                .order_by(NotificationRule.created_at.desc())
            )
        ).scalars()
    )
    visible = [row for row in rows if await _can_manage_rule(session, actor, row)]
    return {"items": [await serialize_rule(session, row) for row in visible]}


async def get_rule(session: AsyncSession, actor: User, rule_id: UUID) -> dict[str, object]:
    row = await _get_rule(session, rule_id)
    if not await _can_manage_rule(session, actor, row):
        raise AppError(
            status_code=404,
            code="NOTIFICATION_RULE_NOT_FOUND",
            message="Notification rule was not found",
        )
    return await serialize_rule(session, row)


async def set_rule_status(
    session: AsyncSession,
    actor: User,
    rule_id: UUID,
    *,
    active: bool,
) -> dict[str, object]:
    row = await _get_rule(session, rule_id, lock=True)
    if not await _can_manage_rule(session, actor, row):
        raise AppError(
            status_code=404,
            code="NOTIFICATION_RULE_NOT_FOUND",
            message="Notification rule was not found",
        )
    target = NotificationRuleStatus.ACTIVE if active else NotificationRuleStatus.INACTIVE
    if row.status == target:
        return await serialize_rule(session, row)
    persisted_targets = [
        NotificationTargetInput(
            target_type=item.target_type,
            target_id=item.user_type_id or item.office_id or item.team_id,
        )
        for item in row.targets
    ]
    await _validate_targets(session, actor, persisted_targets)
    _category_for_rule(NotificationEventType(row.event_type))
    _validate_acknowledgement(row.severity, row.acknowledgement_required)
    old = row.status
    row.status = target
    row.updated_at = utcnow()
    row.updated_by_id = actor.id
    if active:
        row.activated_at = row.updated_at
        row.activated_by_id = actor.id
    await record_audit(
        session,
        action="notification.rule.activate" if active else "notification.rule.deactivate",
        entity_type="notification_rule",
        entity_id=str(row.id),
        actor_id=actor.id,
        old_values={"status": old},
        new_values={"status": row.status},
    )
    await session.commit()
    return await get_rule(session, actor, row.id)


async def _resolve_target_recipients(
    session: AsyncSession,
    targets: list[NotificationTargetInput],
    *,
    affected_user_id: UUID | None,
    allowed_ids: set[UUID] | None,
) -> set[UUID]:
    eligible = {row.id: row for row in await _active_notification_users(session)}
    resolved: set[UUID] = set()
    affected = await session.get(User, affected_user_id) if affected_user_id else None
    for target in targets:
        if target.target_type == NotificationTargetType.AFFECTED_USER:
            if affected and affected.id in eligible:
                resolved.add(affected.id)
        elif target.target_type == NotificationTargetType.REPORTING_MANAGER:
            if affected and affected.reporting_manager_id in eligible:
                resolved.add(affected.reporting_manager_id)
        elif target.target_type == NotificationTargetType.USER_TYPE:
            resolved.update(
                row.id for row in eligible.values() if row.user_type_id == target.target_id
            )
        elif target.target_type == NotificationTargetType.OFFICE:
            resolved.update(
                row.id for row in eligible.values() if row.office_id == target.target_id
            )
        elif target.target_type == NotificationTargetType.TEAM:
            resolved.update(row.id for row in eligible.values() if row.team_id == target.target_id)
        elif target.target_type == NotificationTargetType.COMPANY:
            resolved.update(eligible)
    if allowed_ids is not None:
        resolved.intersection_update(allowed_ids)
    return resolved


async def _persist_notification(
    session: AsyncSession,
    *,
    rule_id: UUID | None,
    category: str,
    severity: str,
    title: str,
    message: str,
    acknowledgement_required: bool,
    source_event_type: str,
    source_event_key: str,
    deduplication_key: str,
    recipient_ids: set[UUID],
    linked_entity_type: str | None,
    linked_entity_id: str | None,
    contextual_link: str | None,
    created_by_id: UUID | None,
) -> tuple[UUID, int]:
    now = utcnow()
    notification_id = new_uuid()
    inserted_id = await session.scalar(
        insert(Notification)
        .values(
            id=notification_id,
            rule_id=rule_id,
            category=category,
            severity=severity,
            title=title,
            message=message,
            acknowledgement_required=acknowledgement_required,
            source_event_type=source_event_type,
            source_event_key=source_event_key,
            deduplication_key=deduplication_key,
            linked_entity_type=linked_entity_type,
            linked_entity_id=linked_entity_id,
            contextual_link=contextual_link,
            created_by_id=created_by_id,
            created_at=now,
        )
        .on_conflict_do_nothing(index_elements=[Notification.deduplication_key])
        .returning(Notification.id)
    )
    if inserted_id is None:
        existing = await session.scalar(
            select(Notification.id).where(Notification.deduplication_key == deduplication_key)
        )
        if existing is None:
            raise RuntimeError("Notification deduplication lookup failed")
        notification_id = existing
    else:
        notification_id = inserted_id
    delivered = 0
    for recipient_id in sorted(recipient_ids, key=str):
        result = await session.execute(
            insert(NotificationDelivery)
            .values(
                id=new_uuid(),
                notification_id=notification_id,
                recipient_id=recipient_id,
                delivered_at=now,
                read_at=None,
                acknowledged_at=None,
                acknowledged_by_id=None,
            )
            .on_conflict_do_nothing(constraint="uq_notification_deliveries_recipient")
            .returning(NotificationDelivery.id)
        )
        if result.scalar_one_or_none() is not None:
            delivered += 1
    return notification_id, delivered


async def dispatch_source_event(
    session: AsyncSession,
    *,
    event_type: NotificationEventType,
    source_event_key: str,
    affected_user_id: UUID | None,
    linked_entity_type: str | None,
    linked_entity_id: str | None,
    contextual_link: str | None,
    actor_id: UUID | None,
) -> int:
    if event_type not in RULE_EVENT_TYPES:
        raise ValueError("Only configured source event types can dispatch rules")
    rules = list(
        (
            await session.execute(
                select(NotificationRule)
                .options(*_rule_options())
                .where(
                    NotificationRule.event_type == event_type.value,
                    NotificationRule.status == NotificationRuleStatus.ACTIVE,
                )
            )
        ).scalars()
    )
    delivered = 0
    for rule in rules:
        creator = (
            await session.execute(
                select(User).options(*user_load_options()).where(User.id == rule.created_by_id)
            )
        ).scalar_one_or_none()
        if (
            creator is None
            or creator.account_status != AccountStatus.ACTIVE
            or not has_permission(creator, NOTIFICATIONS_MANAGE_RULES)
        ):
            continue
        allowed = await visible_user_ids(session, creator)
        if affected_user_id is not None and allowed is not None and affected_user_id not in allowed:
            continue
        targets = [
            NotificationTargetInput(
                target_type=row.target_type,
                target_id=row.user_type_id or row.office_id or row.team_id,
            )
            for row in rule.targets
        ]
        recipients = await _resolve_target_recipients(
            session,
            targets,
            affected_user_id=affected_user_id,
            allowed_ids=allowed,
        )
        if not recipients:
            continue
        _, count = await _persist_notification(
            session,
            rule_id=rule.id,
            category=rule.category,
            severity=rule.severity,
            title=rule.title,
            message=rule.message,
            acknowledgement_required=rule.acknowledgement_required,
            source_event_type=event_type.value,
            source_event_key=source_event_key,
            deduplication_key=f"rule:{rule.id}:{event_type.value}:{source_event_key}",
            recipient_ids=recipients,
            linked_entity_type=linked_entity_type,
            linked_entity_id=linked_entity_id,
            contextual_link=contextual_link,
            created_by_id=actor_id,
        )
        delivered += count
    return delivered


async def dispatch_holiday_reminder(
    session: AsyncSession,
    *,
    holiday_id: UUID,
    holiday_name: str,
    holiday_date: str,
    kind: str,
    actor_id: UUID | None,
) -> int:
    severity = NotificationSeverity.URGENT if kind == "urgent" else NotificationSeverity.INFO
    recipients = {row.id for row in await _active_notification_users(session)}
    if not recipients:
        return 0
    _, count = await _persist_notification(
        session,
        rule_id=None,
        category=NotificationCategory.ATTENDANCE_HOLIDAY.value,
        severity=severity.value,
        title="Urgent holiday reminder" if kind == "urgent" else "Upcoming holiday",
        message=f"{holiday_name} is on {holiday_date}.",
        acknowledgement_required=False,
        source_event_type=NotificationEventType.HOLIDAY_REMINDER.value,
        source_event_key=f"{holiday_id}:{kind}",
        deduplication_key=f"holiday:{holiday_id}:{kind}",
        recipient_ids=recipients,
        linked_entity_type="official_holiday",
        linked_entity_id=str(holiday_id),
        contextual_link="/attendance/holidays",
        created_by_id=actor_id,
    )
    if kind == "urgent":
        automatic_id = await session.scalar(
            select(Notification.id).where(
                Notification.deduplication_key == f"holiday:{holiday_id}:automatic"
            )
        )
        if automatic_id is not None:
            await session.execute(
                update(NotificationDelivery)
                .where(
                    NotificationDelivery.notification_id == automatic_id,
                    NotificationDelivery.read_at.is_(None),
                )
                .values(read_at=utcnow())
            )
    return count


async def mark_holiday_reminder_read(
    session: AsyncSession,
    *,
    actor_id: UUID,
    holiday_id: UUID,
    kind: str,
) -> None:
    notification_id = await session.scalar(
        select(Notification.id).where(
            Notification.deduplication_key == f"holiday:{holiday_id}:{kind}"
        )
    )
    if notification_id is not None:
        await session.execute(
            update(NotificationDelivery)
            .where(
                NotificationDelivery.notification_id == notification_id,
                NotificationDelivery.recipient_id == actor_id,
                NotificationDelivery.read_at.is_(None),
            )
            .values(read_at=utcnow())
        )


async def send_urgent(
    session: AsyncSession,
    actor: User,
    payload: UrgentNotificationRequest,
) -> dict[str, object]:
    await _validate_targets(
        session,
        actor,
        payload.targets,
        affected_user_id=payload.affected_user_id,
    )
    allowed = await visible_user_ids(session, actor)
    recipients = await _resolve_target_recipients(
        session,
        payload.targets,
        affected_user_id=payload.affected_user_id,
        allowed_ids=allowed,
    )
    if not recipients:
        raise AppError(
            status_code=422,
            code="NOTIFICATION_RECIPIENTS_EMPTY",
            message="No authorized active recipients with Notifications.View were resolved",
        )
    event_key = str(uuid4())
    notification_id, delivered = await _persist_notification(
        session,
        rule_id=None,
        category=payload.category.value,
        severity=NotificationSeverity.URGENT.value,
        title=_clean_text(payload.title, label="Notification title"),
        message=_clean_text(payload.message, label="Notification message"),
        acknowledgement_required=payload.acknowledgement_required,
        source_event_type=NotificationEventType.URGENT_BROADCAST.value,
        source_event_key=event_key,
        deduplication_key=f"urgent:{event_key}",
        recipient_ids=recipients,
        linked_entity_type=None,
        linked_entity_id=None,
        contextual_link=None,
        created_by_id=actor.id,
    )
    await record_audit(
        session,
        action="notification.urgent.send",
        entity_type="notification",
        entity_id=str(notification_id),
        actor_id=actor.id,
        new_values={
            "category": payload.category.value,
            "severity": NotificationSeverity.URGENT.value,
            "acknowledgementRequired": payload.acknowledgement_required,
            "recipientCount": len(recipients),
            "newDeliveryCount": delivered,
        },
    )
    await session.commit()
    return {
        "id": str(notification_id),
        "severity": NotificationSeverity.URGENT.value,
        "recipientCount": len(recipients),
    }


def _safe_contextual_link(value: str | None) -> str | None:
    if not value or not value.startswith("/") or value.startswith("//"):
        return None
    allowed = (
        "/applications/",
        "/targets",
        "/finance",
        "/attendance",
        "/users/",
        "/security",
        "/notifications",
    )
    return value if value.startswith(allowed) else None


def _delivery_payload(row: NotificationDelivery) -> dict[str, object]:
    notification = row.notification
    return {
        "id": str(row.id),
        "category": notification.category,
        "severity": notification.severity,
        "title": notification.title,
        "message": notification.message,
        "timestamp": notification.created_at.isoformat(),
        "contextualLink": _safe_contextual_link(notification.contextual_link),
        "unread": row.read_at is None,
        "readAt": row.read_at.isoformat() if row.read_at else None,
        "acknowledgementRequired": notification.acknowledgement_required,
        "acknowledged": row.acknowledged_at is not None,
        "acknowledgedAt": row.acknowledged_at.isoformat() if row.acknowledged_at else None,
    }


async def list_notifications(
    session: AsyncSession, actor: User, *, limit: int = 100
) -> dict[str, object]:
    rows = list(
        (
            await session.execute(
                select(NotificationDelivery)
                .options(selectinload(NotificationDelivery.notification))
                .join(Notification, NotificationDelivery.notification_id == Notification.id)
                .where(NotificationDelivery.recipient_id == actor.id)
                .order_by(Notification.created_at.desc(), NotificationDelivery.id)
                .limit(limit)
            )
        ).scalars()
    )
    return {"items": [_delivery_payload(row) for row in rows]}


async def unread_count(session: AsyncSession, actor: User) -> dict[str, int]:
    count = await session.scalar(
        select(func.count())
        .select_from(NotificationDelivery)
        .where(
            NotificationDelivery.recipient_id == actor.id,
            NotificationDelivery.read_at.is_(None),
        )
    )
    return {"unreadCount": int(count or 0)}


async def _own_delivery(
    session: AsyncSession,
    actor: User,
    delivery_id: UUID,
    *,
    lock: bool = False,
) -> NotificationDelivery:
    stmt = (
        select(NotificationDelivery)
        .options(selectinload(NotificationDelivery.notification))
        .where(
            NotificationDelivery.id == delivery_id,
            NotificationDelivery.recipient_id == actor.id,
        )
    )
    if lock:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise AppError(
            status_code=404,
            code="NOTIFICATION_NOT_FOUND",
            message="Notification was not found",
        )
    return row


async def mark_read(session: AsyncSession, actor: User, delivery_id: UUID) -> dict[str, object]:
    row = await _own_delivery(session, actor, delivery_id, lock=True)
    if row.read_at is None:
        row.read_at = utcnow()
        await session.commit()
    return _delivery_payload(row)


async def mark_all_read(session: AsyncSession, actor: User) -> dict[str, int]:
    result = await session.execute(
        update(NotificationDelivery)
        .where(
            NotificationDelivery.recipient_id == actor.id,
            NotificationDelivery.read_at.is_(None),
        )
        .values(read_at=utcnow())
    )
    await session.commit()
    return {"markedRead": int(result.rowcount or 0)}


async def acknowledge(session: AsyncSession, actor: User, delivery_id: UUID) -> dict[str, object]:
    row = await _own_delivery(session, actor, delivery_id, lock=True)
    if not row.notification.acknowledgement_required:
        raise AppError(
            status_code=422,
            code="NOTIFICATION_ACKNOWLEDGEMENT_NOT_REQUIRED",
            message="This notification does not require acknowledgement",
        )
    if row.notification.severity not in (
        NotificationSeverity.CRITICAL,
        NotificationSeverity.URGENT,
    ):
        raise AppError(
            status_code=422,
            code="NOTIFICATION_ACKNOWLEDGEMENT_INVALID",
            message="Only Critical or Urgent notifications may be acknowledged",
        )
    if row.acknowledged_at is None:
        row.acknowledged_at = utcnow()
        row.acknowledged_by_id = actor.id
        await record_audit(
            session,
            action="notification.acknowledge",
            entity_type="notification_delivery",
            entity_id=str(row.id),
            actor_id=actor.id,
            target_user_id=actor.id,
            new_values={
                "notificationId": str(row.notification_id),
                "acknowledged": True,
            },
        )
        await session.commit()
    return _delivery_payload(row)


async def notification_audit(session: AsyncSession, actor: User) -> dict[str, object]:
    allowed = await visible_user_ids(session, actor)
    stmt = select(AuditEvent).where(
        or_(
            AuditEvent.action.like("notification.%"),
            AuditEvent.action == "attendance.holiday_urgent_reminder",
        )
    )
    if allowed is not None:
        stmt = stmt.where(
            or_(AuditEvent.actor_id.in_(allowed), AuditEvent.target_user_id.in_(allowed))
        )
    rows = list(
        (await session.execute(stmt.order_by(AuditEvent.created_at.desc()).limit(200))).scalars()
    )
    return {
        "items": [
            {
                "id": str(row.id),
                "action": row.action,
                "entityType": row.entity_type,
                "entityId": row.entity_id,
                "actorId": str(row.actor_id) if row.actor_id else None,
                "targetUserId": str(row.target_user_id) if row.target_user_id else None,
                "newValues": row.new_values,
                "createdAt": row.created_at.isoformat(),
                "note": row.note,
            }
            for row in rows
        ]
    }


async def notification_options(session: AsyncSession, actor: User) -> dict[str, object]:
    if not (
        has_permission(actor, NOTIFICATIONS_MANAGE_RULES)
        or has_permission(actor, NOTIFICATIONS_SEND_URGENT)
    ):
        raise AppError(
            status_code=403,
            code="FORBIDDEN",
            message="You do not have permission to configure or send notifications",
        )
    scope = visibility_scope(actor)
    allowed = await visible_user_ids(session, actor)
    users = await _active_notification_users(session)
    if allowed is not None:
        users = [row for row in users if row.id in allowed]
    offices = list(
        (
            await session.execute(
                select(Office).where(Office.status == MasterStatus.ACTIVE).order_by(Office.name)
            )
        ).scalars()
    )
    teams = list(
        (
            await session.execute(
                select(Team).where(Team.status == MasterStatus.ACTIVE).order_by(Team.name)
            )
        ).scalars()
    )
    if scope == VisibilityScope.OFFICE:
        offices = [row for row in offices if row.id == actor.office_id]
        teams = [row for row in teams if row.office_id == actor.office_id]
    elif scope != VisibilityScope.COMPANY:
        offices = []
        teams = [row for row in teams if row.id == actor.team_id]
    user_types = []
    if scope == VisibilityScope.COMPANY:
        user_types = list(
            (
                await session.execute(
                    select(UserType)
                    .where(UserType.status == UserTypeStatus.ACTIVE)
                    .order_by(UserType.name)
                )
            ).scalars()
        )
    return {
        "categories": [item.value for item in NotificationCategory],
        "severities": [item.value for item in NotificationSeverity],
        "eventTypes": [
            {"value": item.value, "category": EVENT_CATEGORY[item].value}
            for item in RULE_EVENT_TYPES
        ],
        "targetTypes": [item.value for item in NotificationTargetType],
        "companyAvailable": scope == VisibilityScope.COMPANY,
        "users": [
            {"id": str(row.id), "name": row.full_name, "employeeCode": row.employee_code}
            for row in users
        ],
        "userTypes": [{"id": str(row.id), "name": row.name} for row in user_types],
        "offices": [{"id": str(row.id), "name": row.name} for row in offices],
        "teams": [{"id": str(row.id), "name": row.name} for row in teams],
    }
