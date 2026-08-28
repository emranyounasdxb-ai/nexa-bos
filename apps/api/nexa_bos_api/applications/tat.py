from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.applications.models import (
    Application,
    ApplicationDelay,
    ApplicationDelayCorrection,
    ApplicationEvent,
    ApplicationStageOccupancy,
    WorkflowStage,
    new_uuid,
)
from nexa_bos_api.applications.schemas import CorrectDelayRequest, MarkDelayRequest
from nexa_bos_api.applications.seed import utcnow
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import ApplicationEventType, DelayCorrectionAction, DelayType
from nexa_bos_api.identity.models import User

DELAY_CLOSE_STAGE_MOVE = "stage_move"
DELAY_CLOSE_TERMINAL = "terminal"
DELAY_CLOSE_CORRECT = "correct"
DELAY_CLOSE_CANCEL = "cancel"


def duration_seconds(start: datetime, end: datetime) -> int:
    return max(0, int((end - start).total_seconds()))


def _blank(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


async def _write_event(
    session: AsyncSession,
    *,
    application: Application,
    event_type: str,
    actor_id: UUID,
    at: datetime,
    previous_stage_id: UUID | None = None,
    new_stage_id: UUID | None = None,
    payload: dict | None = None,
    reason: str | None = None,
    correction_of_event_id: UUID | None = None,
) -> ApplicationEvent:
    event = ApplicationEvent(
        id=new_uuid(),
        application_id=application.id,
        event_type=event_type,
        previous_stage_id=previous_stage_id,
        new_stage_id=new_stage_id,
        bos_updated_at=at,
        actor_id=actor_id,
        payload=payload,
        reason=reason,
        correction_of_event_id=correction_of_event_id,
    )
    session.add(event)
    await session.flush()
    return event


async def _open_occupancy_row(
    session: AsyncSession,
    application: Application,
) -> ApplicationStageOccupancy | None:
    return (
        await session.execute(
            select(ApplicationStageOccupancy).where(
                ApplicationStageOccupancy.application_id == application.id,
                ApplicationStageOccupancy.exited_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def _active_delay_row(session: AsyncSession, application_id: UUID) -> ApplicationDelay | None:
    return (
        await session.execute(
            select(ApplicationDelay).where(
                ApplicationDelay.application_id == application_id,
                ApplicationDelay.ended_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def open_occupancy(
    session: AsyncSession,
    application: Application,
    *,
    stage_id: UUID,
    actor_id: UUID,
    at: datetime,
    bank_stage_date=None,
    stage_note: str | None = None,
) -> ApplicationStageOccupancy:
    occupancy = ApplicationStageOccupancy(
        id=new_uuid(),
        application_id=application.id,
        stage_id=stage_id,
        entered_at=at,
        bank_stage_date=bank_stage_date,
        stage_note=_blank(stage_note),
        bos_updated_at=at,
        updated_by_id=actor_id,
    )
    session.add(occupancy)
    await session.flush()
    return occupancy


async def close_open_occupancy(
    session: AsyncSession,
    application: Application,
    *,
    actor_id: UUID,
    at: datetime,
) -> ApplicationStageOccupancy | None:
    occupancy = await _open_occupancy_row(session, application)
    if occupancy is None:
        return None
    occupancy.exited_at = at
    occupancy.duration_seconds = duration_seconds(occupancy.entered_at, at)
    occupancy.bos_updated_at = at
    occupancy.updated_by_id = actor_id
    return occupancy


def stop_tat(application: Application, at: datetime) -> None:
    if application.tat_stopped_at is None:
        application.tat_stopped_at = at


async def close_active_delay(
    session: AsyncSession,
    application: Application,
    *,
    actor_id: UUID,
    at: datetime,
    cause: str,
) -> ApplicationDelay | None:
    delay = await _active_delay_row(session, application.id)
    if delay is None:
        return None
    delay.ended_at = at
    delay.duration_seconds = duration_seconds(delay.started_at, at)
    delay.closed_cause = cause
    event = await _write_event(
        session,
        application=application,
        event_type=ApplicationEventType.DELAY_CLOSED,
        actor_id=actor_id,
        at=at,
        new_stage_id=delay.stage_id,
        payload=_delay_payload(delay),
        reason=f"Delay closed ({cause.replace('_', ' ')})",
        correction_of_event_id=delay.marked_event_id,
    )
    await record_audit(
        session,
        action="application.delay_closed",
        entity_type="application_delay",
        entity_id=str(delay.id),
        actor_id=actor_id,
        new_values={"cause": cause, "eventId": str(event.id)},
    )
    return delay


async def on_successful_stage_movement(
    session: AsyncSession,
    application: Application,
    *,
    actor_id: UUID,
    at: datetime,
    previous_stage_id: UUID,
    new_stage_id: UUID,
    bank_stage_date=None,
    stage_note: str | None = None,
) -> None:
    if previous_stage_id == new_stage_id:
        return
    await close_active_delay(
        session, application, actor_id=actor_id, at=at, cause=DELAY_CLOSE_STAGE_MOVE
    )
    await close_open_occupancy(session, application, actor_id=actor_id, at=at)
    await session.flush()
    await open_occupancy(
        session,
        application,
        stage_id=new_stage_id,
        actor_id=actor_id,
        at=at,
        bank_stage_date=bank_stage_date,
        stage_note=stage_note,
    )
    if application.terminal_outcome:
        await close_open_occupancy(session, application, actor_id=actor_id, at=at)
        stop_tat(application, at)


async def on_stage_corrected(
    session: AsyncSession,
    application: Application,
    *,
    actor_id: UUID,
    at: datetime,
    previous_stage_id: UUID,
    new_stage_id: UUID,
    bank_stage_date=None,
    stage_note: str | None = None,
) -> None:
    if previous_stage_id == new_stage_id:
        return
    await close_open_occupancy(session, application, actor_id=actor_id, at=at)
    await session.flush()
    await open_occupancy(
        session,
        application,
        stage_id=new_stage_id,
        actor_id=actor_id,
        at=at,
        bank_stage_date=bank_stage_date,
        stage_note=stage_note,
    )


async def on_terminal_outcome(
    session: AsyncSession,
    application: Application,
    *,
    actor_id: UUID,
    at: datetime,
) -> None:
    await close_active_delay(
        session, application, actor_id=actor_id, at=at, cause=DELAY_CLOSE_TERMINAL
    )
    await close_open_occupancy(session, application, actor_id=actor_id, at=at)
    stop_tat(application, at)


def _delay_payload(delay: ApplicationDelay) -> dict[str, object]:
    return {
        "delayId": str(delay.id),
        "delayType": delay.delay_type,
        "reason": delay.reason,
        "otherExplanation": delay.other_explanation,
        "startedAt": delay.started_at.isoformat(),
        "endedAt": delay.ended_at.isoformat() if delay.ended_at else None,
        "durationSeconds": delay.duration_seconds,
        "stageId": str(delay.stage_id),
        "closedCause": delay.closed_cause,
    }


async def serialize_delay(session: AsyncSession, delay: ApplicationDelay) -> dict[str, object]:
    stage = await session.get(WorkflowStage, delay.stage_id)
    marker = await session.get(User, delay.marked_by_id)
    return {
        "id": str(delay.id),
        "delayType": delay.delay_type,
        "reason": delay.reason,
        "otherExplanation": delay.other_explanation,
        "stageId": str(delay.stage_id),
        "stageName": stage.name if stage else None,
        "startedAt": delay.started_at.isoformat(),
        "endedAt": delay.ended_at.isoformat() if delay.ended_at else None,
        "durationSeconds": delay.duration_seconds,
        "markedById": str(delay.marked_by_id),
        "markedBy": marker.full_name if marker else None,
        "closedCause": delay.closed_cause,
        "active": delay.ended_at is None,
    }


async def serialize_occupancy(
    session: AsyncSession, occupancy: ApplicationStageOccupancy, *, now: datetime
) -> dict[str, object]:
    stage = await session.get(WorkflowStage, occupancy.stage_id)
    actor = await session.get(User, occupancy.updated_by_id)
    elapsed = (
        occupancy.duration_seconds
        if occupancy.exited_at is not None
        else duration_seconds(occupancy.entered_at, now)
    )
    return {
        "id": str(occupancy.id),
        "stageId": str(occupancy.stage_id),
        "stageName": stage.name if stage else None,
        "enteredAt": occupancy.entered_at.isoformat(),
        "exitedAt": occupancy.exited_at.isoformat() if occupancy.exited_at else None,
        "durationSeconds": elapsed,
        "completed": occupancy.exited_at is not None,
        "bankStageDate": occupancy.bank_stage_date.isoformat()
        if occupancy.bank_stage_date
        else None,
        "stageNote": occupancy.stage_note,
        "bosUpdatedAt": occupancy.bos_updated_at.isoformat(),
        "updatedById": str(occupancy.updated_by_id),
        "updatedBy": actor.full_name if actor else None,
    }


async def tat_fields(session: AsyncSession, application: Application) -> dict[str, object]:
    now = utcnow()
    occupancies = (
        (
            await session.execute(
                select(ApplicationStageOccupancy)
                .where(ApplicationStageOccupancy.application_id == application.id)
                .order_by(ApplicationStageOccupancy.entered_at.asc())
            )
        )
        .scalars()
        .all()
    )
    delays = (
        (
            await session.execute(
                select(ApplicationDelay)
                .where(ApplicationDelay.application_id == application.id)
                .order_by(ApplicationDelay.started_at.asc())
            )
        )
        .scalars()
        .all()
    )
    current = next((row for row in occupancies if row.exited_at is None), None)
    active = next((row for row in delays if row.ended_at is None), None)
    stopped = application.tat_stopped_at is not None
    end = application.tat_stopped_at or now
    return {
        "tatStartedAt": application.created_at.isoformat(),
        "tatStoppedAt": application.tat_stopped_at.isoformat()
        if application.tat_stopped_at
        else None,
        "totalDurationSeconds": duration_seconds(application.created_at, end) if stopped else None,
        "currentElapsedSeconds": None if stopped else duration_seconds(application.created_at, now),
        "currentStageEnteredAt": current.entered_at.isoformat() if current else None,
        "currentStageElapsedSeconds": (
            duration_seconds(current.entered_at, now) if current else None
        ),
        "stageDurations": [await serialize_occupancy(session, row, now=now) for row in occupancies],
        "activeDelay": await serialize_delay(session, active) if active else None,
        "hasActiveDelay": active is not None,
    }


async def occupancy_by_stage(
    session: AsyncSession, application: Application
) -> dict[str, ApplicationStageOccupancy]:
    rows = (
        (
            await session.execute(
                select(ApplicationStageOccupancy)
                .where(ApplicationStageOccupancy.application_id == application.id)
                .order_by(ApplicationStageOccupancy.entered_at.asc())
            )
        )
        .scalars()
        .all()
    )
    latest: dict[str, ApplicationStageOccupancy] = {}
    for row in rows:
        latest[str(row.stage_id)] = row
    return latest


async def mark_delay(
    session: AsyncSession,
    actor: User,
    application: Application,
    payload: MarkDelayRequest,
) -> ApplicationDelay:
    if application.terminal_outcome:
        raise AppError(
            status_code=422,
            code="APPLICATION_TERMINAL",
            message="Terminal applications cannot be changed or reopened",
        )
    reason = payload.reason.strip()
    explanation = _blank(payload.other_explanation)
    if payload.delay_type is DelayType.OTHER and explanation is None:
        raise AppError(
            status_code=422,
            code="DELAY_OTHER_EXPLANATION_REQUIRED",
            message="Delay type Other requires an explanation",
        )
    if payload.delay_type is not DelayType.OTHER:
        explanation = None
    existing = await _active_delay_row(session, application.id)
    if existing is not None:
        raise AppError(
            status_code=409,
            code="DELAY_ALREADY_ACTIVE",
            message="Only one active delay is allowed per application",
        )
    now = utcnow()
    delay = ApplicationDelay(
        id=new_uuid(),
        application_id=application.id,
        stage_id=application.current_stage_id,
        delay_type=payload.delay_type,
        reason=reason,
        other_explanation=explanation,
        started_at=now,
        marked_by_id=actor.id,
    )
    session.add(delay)
    await session.flush()
    event = await _write_event(
        session,
        application=application,
        event_type=ApplicationEventType.DELAY_MARKED,
        actor_id=actor.id,
        at=now,
        new_stage_id=application.current_stage_id,
        payload=_delay_payload(delay),
        reason=reason,
    )
    delay.marked_event_id = event.id
    application.updated_at = now
    await record_audit(
        session,
        action="application.delay_marked",
        entity_type="application_delay",
        entity_id=str(delay.id),
        actor_id=actor.id,
        new_values={
            "delayType": delay.delay_type,
            "stageId": str(delay.stage_id),
            "eventId": str(event.id),
        },
        note=reason,
    )
    await session.commit()
    return delay


async def correct_delay(
    session: AsyncSession,
    actor: User,
    application: Application,
    delay_id: UUID,
    payload: CorrectDelayRequest,
) -> ApplicationDelay:
    delay = await session.get(ApplicationDelay, delay_id)
    if delay is None or delay.application_id != application.id:
        raise AppError(status_code=404, code="DELAY_NOT_FOUND", message="Delay not found")
    reason = payload.reason.strip()
    now = utcnow()
    if delay.ended_at is None:
        delay.ended_at = now
        delay.duration_seconds = duration_seconds(delay.started_at, now)
        delay.closed_cause = (
            DELAY_CLOSE_CANCEL
            if payload.action is DelayCorrectionAction.CANCEL
            else DELAY_CLOSE_CORRECT
        )
    event_type = (
        ApplicationEventType.DELAY_CANCELLED
        if payload.action is DelayCorrectionAction.CANCEL
        else ApplicationEventType.DELAY_CORRECTED
    )
    event = await _write_event(
        session,
        application=application,
        event_type=event_type,
        actor_id=actor.id,
        at=now,
        new_stage_id=delay.stage_id,
        payload={**_delay_payload(delay), "correctionAction": payload.action},
        reason=reason,
        correction_of_event_id=delay.marked_event_id,
    )
    correction = ApplicationDelayCorrection(
        id=new_uuid(),
        delay_id=delay.id,
        application_id=application.id,
        action=payload.action,
        reason=reason,
        actor_id=actor.id,
        created_at=now,
        event_id=event.id,
    )
    session.add(correction)
    application.updated_at = now
    await record_audit(
        session,
        action="application.delay_corrected",
        entity_type="application_delay",
        entity_id=str(delay.id),
        actor_id=actor.id,
        new_values={"action": payload.action, "eventId": str(event.id)},
        note=reason,
    )
    await session.commit()
    return delay
