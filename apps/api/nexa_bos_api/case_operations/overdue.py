from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.applications.models import (
    Application,
    ApplicationStageOccupancy,
    WorkflowStage,
)
from nexa_bos_api.case_operations.models import OverdueNotificationDispatch
from nexa_bos_api.identity.access import has_permission, has_user_type, load_user_with_type
from nexa_bos_api.identity.enums import AccountStatus
from nexa_bos_api.identity.models import User, new_uuid
from nexa_bos_api.identity.permissions import NOTIFICATIONS_VIEW
from nexa_bos_api.notifications.service import create_system_notification


def utcnow() -> datetime:
    return datetime.now(UTC)


async def application_overdue_payload(
    session: AsyncSession,
    application: Application,
    *,
    now: datetime | None = None,
) -> dict[str, object] | None:
    occupancy = await session.scalar(
        select(ApplicationStageOccupancy).where(
            ApplicationStageOccupancy.application_id == application.id,
            ApplicationStageOccupancy.exited_at.is_(None),
        )
    )
    if occupancy is None:
        return None
    stage = await session.get(WorkflowStage, occupancy.stage_id)
    if stage is None or stage.timeframe_seconds is None:
        return None
    elapsed = max(0, int(((now or utcnow()) - occupancy.entered_at).total_seconds()))
    if elapsed <= stage.timeframe_seconds:
        return None
    overdue_seconds = elapsed - stage.timeframe_seconds
    return {
        "isOverdue": True,
        "overdueSeconds": overdue_seconds,
        "overdueHours": round(overdue_seconds / 3600, 1),
        "stageEnteredAt": occupancy.entered_at.isoformat(),
        "deadlineAt": (
            occupancy.entered_at + timedelta(seconds=stage.timeframe_seconds)
        ).isoformat(),
    }


async def _recipients(
    session: AsyncSession,
    application: Application,
) -> set[UUID]:
    ids: set[UUID] = set()
    owner = await session.get(User, application.case_owner_id)
    if owner and owner.reporting_manager_id:
        manager = await load_user_with_type(session, owner.reporting_manager_id)
        if manager and has_user_type(manager, "TL"):
            ids.add(manager.id)
    if application.routed_coordinator_id:
        ids.add(application.routed_coordinator_id)
    if application.routed_sales_manager_id:
        ids.add(application.routed_sales_manager_id)
    users = list(
        await session.scalars(select(User).where(User.account_status == AccountStatus.ACTIVE))
    )
    for user in users:
        loaded = await load_user_with_type(session, user.id)
        if loaded and has_user_type(loaded, "BDM", "GM", "OWNER"):
            ids.add(loaded.id)
    eligible: set[UUID] = set()
    for user_id in ids:
        user = await load_user_with_type(session, user_id)
        if (
            user
            and user.account_status == AccountStatus.ACTIVE
            and has_permission(user, NOTIFICATIONS_VIEW)
        ):
            eligible.add(user.id)
    return eligible


async def dispatch_overdue_notifications(session_factory) -> int:
    now = utcnow()
    delivered = 0
    async with session_factory() as session:
        rows = (
            await session.execute(
                select(Application, ApplicationStageOccupancy, WorkflowStage)
                .join(
                    ApplicationStageOccupancy,
                    ApplicationStageOccupancy.application_id == Application.id,
                )
                .join(WorkflowStage, WorkflowStage.id == ApplicationStageOccupancy.stage_id)
                .where(
                    Application.terminal_outcome.is_(None),
                    ApplicationStageOccupancy.exited_at.is_(None),
                    WorkflowStage.timeframe_seconds.is_not(None),
                )
            )
        ).all()
        for application, occupancy, stage in rows:
            elapsed = int((now - occupancy.entered_at).total_seconds())
            if elapsed <= stage.timeframe_seconds:
                continue
            for recipient_id in await _recipients(session, application):
                existing = await session.scalar(
                    select(OverdueNotificationDispatch.id).where(
                        OverdueNotificationDispatch.occupancy_id == occupancy.id,
                        OverdueNotificationDispatch.recipient_id == recipient_id,
                        OverdueNotificationDispatch.reminder_date == now.date(),
                    )
                )
                if existing:
                    continue
                source_key = f"{occupancy.id}:{recipient_id}:{now.date().isoformat()}"
                notification_id, count = await create_system_notification(
                    session,
                    recipient_ids={recipient_id},
                    title="Case stage overdue",
                    message=(
                        f"{application.application_code} has exceeded the {stage.name} timeframe."
                    ),
                    source_event_type="operations.case_stage_overdue",
                    source_event_key=source_key,
                    linked_entity_type="application",
                    linked_entity_id=str(application.id),
                    contextual_link=f"/applications/{application.id}",
                )
                session.add(
                    OverdueNotificationDispatch(
                        id=new_uuid(),
                        application_id=application.id,
                        occupancy_id=occupancy.id,
                        recipient_id=recipient_id,
                        reminder_date=now.date(),
                        notification_id=notification_id,
                        created_at=now,
                    )
                )
                delivered += count
        await session.commit()
    return delivered
