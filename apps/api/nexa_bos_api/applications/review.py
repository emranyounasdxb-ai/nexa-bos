"""Internal review is an append-only event stream, independent of bank workflow."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.applications.models import Application, ApplicationEvent
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import (
    has_permission,
    has_user_type,
    load_user_with_type,
    tl_team_owner_ids,
)
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.models import User, new_uuid
from nexa_bos_api.identity.permissions import APPLICATIONS_EDIT

REVIEW_EVENTS = (
    "internal_review_started",
    "internal_forwarded",
    "internal_returned",
    "internal_resubmitted",
)
REVIEW_LABELS = {
    "pending_review": "Pending TL Review",
    "returned": "Returned to SE",
    "resubmitted": "Resubmitted to TL",
    "forwarded": "Forwarded to COD",
    "legacy": "Existing case · COD workflow",
}


class ReviewActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["forward", "return", "resubmit"]
    expected_event_id: UUID
    reason: str | None = Field(default=None, max_length=2000)


def review_state(events: list[ApplicationEvent]) -> dict[str, object]:
    rows = sorted(
        (row for row in events if row.event_type in REVIEW_EVENTS),
        key=lambda row: (row.bos_updated_at, str(row.id)),
    )
    if not rows:
        return {
            "status": "legacy",
            "label": REVIEW_LABELS["legacy"],
            "eventId": None,
            "tlId": None,
            "officeId": None,
            "reason": None,
            "history": [],
        }
    last = rows[-1]
    state = dict(last.payload or {})
    status = str(state.get("status", "pending_review"))
    return {
        **state,
        "status": status,
        "label": REVIEW_LABELS.get(status, "Pending TL Review"),
        "eventId": str(last.id),
        "reason": last.reason,
        "history": [
            {
                "id": str(row.id),
                "action": row.event_type,
                "at": row.bos_updated_at.isoformat(),
                "reason": row.reason,
                "actorId": str(row.actor_id),
            }
            for row in rows
        ],
    }


async def get_review(session: AsyncSession, application: Application) -> dict[str, object]:
    events = list(
        await session.scalars(
            select(ApplicationEvent).where(
                ApplicationEvent.application_id == application.id,
                ApplicationEvent.event_type.in_(REVIEW_EVENTS),
            )
        )
    )
    return review_state(events)


async def _append_review(
    session: AsyncSession,
    application: Application,
    actor: User,
    *,
    event_type: str,
    status: str,
    tl_id: str | None,
    office_id: str | None,
    reason: str | None = None,
) -> None:
    now = datetime.now(UTC)
    payload = {"status": status, "tlId": tl_id, "officeId": office_id}
    session.add(
        ApplicationEvent(
            id=new_uuid(),
            application_id=application.id,
            event_type=event_type,
            actor_id=actor.id,
            bos_updated_at=now,
            payload=payload,
            reason=reason,
        )
    )
    application.updated_at = now
    await record_audit(
        session,
        action=f"application.{event_type}",
        entity_type="application",
        entity_id=str(application.id),
        actor_id=actor.id,
        new_values=payload,
        note=reason,
    )
    await session.flush()


async def start_review(session: AsyncSession, application: Application, actor: User) -> None:
    if not has_user_type(actor, "SE", "TL"):
        return
    tl_id = None
    if has_user_type(actor, "SE") and actor.reporting_manager_id:
        manager = await load_user_with_type(session, actor.reporting_manager_id)
        if manager and has_user_type(manager, "TL"):
            if actor.id in await tl_team_owner_ids(session, manager):
                tl_id = str(manager.id)
    # Unassigned SEs fail closed in the review queue; never fall through to COD.
    await _append_review(
        session,
        application,
        actor,
        event_type="internal_review_started",
        status="pending_review" if has_user_type(actor, "SE") else "forwarded",
        tl_id=tl_id,
        office_id=str(actor.office_id) if actor.office_id else None,
    )


async def review_payload(
    session: AsyncSession,
    application: Application,
    actor: User,
) -> dict[str, object]:
    state = await get_review(session, application)
    actions: list[str] = []
    if not application.submitted_at and not application.terminal_outcome:
        if has_permission(actor, APPLICATIONS_EDIT):
            if (
                has_user_type(actor, "TL")
                and state["tlId"] == str(actor.id)
                and application.case_owner_id != actor.id
                and application.case_owner_id in await tl_team_owner_ids(session, actor)
                and state["status"] in {"pending_review", "resubmitted"}
            ):
                actions = ["forward", "return"]
            elif (
                has_user_type(actor, "SE")
                and application.case_owner_id == actor.id
                and state["status"] == "returned"
            ):
                actions = ["resubmit"]
    return {**state, "actions": actions}


async def transition_review(
    session: AsyncSession,
    application: Application,
    actor: User,
    payload: ReviewActionRequest,
) -> dict[str, object]:
    # Lock before re-reading state. Expected event IDs reject stale/double submissions.
    await session.refresh(application, with_for_update=True)
    state = await review_payload(session, application, actor)
    if state["eventId"] != str(payload.expected_event_id):
        raise AppError(
            status_code=409,
            code="REVIEW_CHANGED",
            message="Review changed. Refresh the case before continuing.",
        )
    if payload.action not in state["actions"]:
        raise AppError(
            status_code=403, code="REVIEW_FORBIDDEN", message="This review action is not available."
        )
    reason = payload.reason.strip() if payload.reason else None
    if payload.action == "return" and not reason:
        raise AppError(
            status_code=422, code="REVIEW_REASON_REQUIRED", message="A return reason is required."
        )
    if payload.action == "resubmit":
        assigned = (
            await load_user_with_type(session, UUID(str(state["tlId"]))) if state["tlId"] else None
        )
        if (
            not assigned
            or not has_user_type(assigned, "TL")
            or actor.id not in await tl_team_owner_ids(session, assigned)
        ):
            raise AppError(
                status_code=409,
                code="REVIEW_ASSIGNMENT_CHANGED",
                message="Original TL assignment is no longer valid. Contact your administrator.",
            )
    status, event = {
        "forward": ("forwarded", "internal_forwarded"),
        "return": ("returned", "internal_returned"),
        "resubmit": ("resubmitted", "internal_resubmitted"),
    }[payload.action]
    await _append_review(
        session,
        application,
        actor,
        event_type=event,
        status=status,
        tl_id=state["tlId"],
        office_id=state["officeId"],
        reason=reason,
    )
    await session.commit()
    return await review_payload(session, application, actor)


async def require_review_mutation(
    session: AsyncSession,
    actor: User,
    application: Application,
    *,
    editing: bool = False,
) -> None:
    """Lock review and bank/correction mutations on the same application row."""
    if has_user_type(actor, "OWNER", "GM"):
        return
    await session.refresh(application, with_for_update=True)
    state = await get_review(session, application)
    if (
        has_user_type(actor, "BDM", "SM", "TL", "SE", "OM")
        and application.case_owner_id != actor.id
    ):
        raise AppError(
            status_code=404, code="APPLICATION_NOT_FOUND", message="Application not found"
        )
    if has_user_type(actor, "TL") and not editing:
        raise AppError(
            status_code=403,
            code="REVIEW_FORBIDDEN",
            message="Bank processing is not a TL review action.",
        )
    if state["status"] == "legacy":
        return
    if has_user_type(actor, "SE"):
        if editing and application.case_owner_id == actor.id and state["status"] == "returned":
            return
        raise AppError(
            status_code=409,
            code="REVIEW_LOCKED",
            message="Application data may be corrected only after it is returned by the TL.",
        )
    if state["status"] != "forwarded":
        raise AppError(
            status_code=409,
            code="TL_REVIEW_REQUIRED",
            message="Forward this Application through TL review before COD processing.",
        )
    if has_user_type(actor, "COD") and state["officeId"] != str(actor.office_id):
        raise AppError(
            status_code=404, code="APPLICATION_NOT_FOUND", message="Application not found"
        )
