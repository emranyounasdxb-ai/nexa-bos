from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from nexa_bos_api.api.v1.deps import CurrentUser, require_permission
from nexa_bos_api.db.session import SessionDep
from nexa_bos_api.identity.permissions import (
    NOTIFICATIONS_MANAGE_RULES,
    NOTIFICATIONS_SEND_URGENT,
    NOTIFICATIONS_VIEW,
    NOTIFICATIONS_VIEW_AUDIT,
)
from nexa_bos_api.notifications.schemas import (
    NotificationRuleUpsertRequest,
    UrgentNotificationRequest,
)
from nexa_bos_api.notifications.service import (
    acknowledge,
    create_rule,
    get_rule,
    list_notifications,
    list_rules,
    mark_all_read,
    mark_read,
    notification_audit,
    notification_options,
    send_urgent,
    set_rule_status,
    unread_count,
    update_rule,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def notifications_list(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_VIEW))],
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
) -> dict[str, object]:
    return await list_notifications(session, actor, limit=limit)


@router.get("/unread-count")
async def notifications_unread_count(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_VIEW))],
) -> dict[str, int]:
    return await unread_count(session, actor)


@router.post("/{delivery_id}/read")
async def notifications_mark_read(
    delivery_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_VIEW))],
) -> dict[str, object]:
    return await mark_read(session, actor, delivery_id)


@router.post("/read-all")
async def notifications_mark_all_read(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_VIEW))],
) -> dict[str, int]:
    return await mark_all_read(session, actor)


@router.post("/{delivery_id}/acknowledge")
async def notifications_acknowledge(
    delivery_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_VIEW))],
) -> dict[str, object]:
    return await acknowledge(session, actor, delivery_id)


@router.get("/options")
async def notifications_options(
    session: SessionDep,
    actor: CurrentUser,
) -> dict[str, object]:
    return await notification_options(session, actor)


@router.get("/rules")
async def notification_rules_list(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_MANAGE_RULES))],
) -> dict[str, object]:
    return await list_rules(session, actor)


@router.post("/rules")
async def notification_rules_create(
    payload: NotificationRuleUpsertRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_MANAGE_RULES))],
) -> dict[str, object]:
    return await create_rule(session, actor, payload)


@router.get("/rules/{rule_id}")
async def notification_rules_get(
    rule_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_MANAGE_RULES))],
) -> dict[str, object]:
    return await get_rule(session, actor, rule_id)


@router.put("/rules/{rule_id}")
async def notification_rules_update(
    rule_id: UUID,
    payload: NotificationRuleUpsertRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_MANAGE_RULES))],
) -> dict[str, object]:
    return await update_rule(session, actor, rule_id, payload)


@router.post("/rules/{rule_id}/activate")
async def notification_rules_activate(
    rule_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_MANAGE_RULES))],
) -> dict[str, object]:
    return await set_rule_status(session, actor, rule_id, active=True)


@router.post("/rules/{rule_id}/deactivate")
async def notification_rules_deactivate(
    rule_id: UUID,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_MANAGE_RULES))],
) -> dict[str, object]:
    return await set_rule_status(session, actor, rule_id, active=False)


@router.post("/urgent")
async def notifications_urgent_send(
    payload: UrgentNotificationRequest,
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_SEND_URGENT))],
) -> dict[str, object]:
    return await send_urgent(session, actor, payload)


@router.get("/audit")
async def notifications_audit(
    session: SessionDep,
    actor: Annotated[CurrentUser, Depends(require_permission(NOTIFICATIONS_VIEW_AUDIT))],
) -> dict[str, object]:
    return await notification_audit(session, actor)
