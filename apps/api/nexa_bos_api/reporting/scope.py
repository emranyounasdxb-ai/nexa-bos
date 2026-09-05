from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.identity.access import (
    descendant_ids,
    has_user_type,
    reporting_visibility_scope,
    tl_team_owner_ids,
)
from nexa_bos_api.identity.enums import AssignmentField, VisibilityScope
from nexa_bos_api.identity.models import User, UserAssignmentHistory


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


@dataclass
class ReportingAccess:
    actor: User
    scope: VisibilityScope | None
    descendant_ids: set[UUID]
    current_managers: dict[UUID, UUID | None]
    manager_spans: dict[UUID, list[tuple[datetime, datetime | None, UUID | None]]]
    office_spans: dict[UUID, list[tuple[datetime, datetime | None, UUID | None]]]
    restrict_current_team: bool = False

    @property
    def label(self) -> str | None:
        if self.scope is None:
            return None
        mapping = {
            VisibilityScope.COMPANY: "Company-wide",
            VisibilityScope.OFFICE: "Office",
            VisibilityScope.TEAM: "Team / Reporting Hierarchy",
            VisibilityScope.OWN: "Own Performance",
        }
        return mapping[self.scope]

    def manager_at(self, user_id: UUID, at: datetime) -> UUID | None:
        moment = _aware(at)
        for start, end, manager_id in self.manager_spans.get(user_id, ()):
            if start <= moment and (end is None or moment < end):
                return manager_id
        return self.current_managers.get(user_id)

    def office_at(self, user_id: UUID, at: datetime) -> UUID | None:
        moment = _aware(at)
        for start, end, office_id in self.office_spans.get(user_id, ()):
            if start <= moment and (end is None or moment < end):
                return office_id
        return None

    def was_descendant_at(self, owner_id: UUID, at: datetime) -> bool:
        seen: set[UUID] = set()
        current = owner_id
        while current and current not in seen:
            seen.add(current)
            manager_id = self.manager_at(current, at)
            if manager_id is None:
                return False
            if manager_id == self.actor.id:
                return True
            current = manager_id
        return False

    def owner_visible(
        self,
        owner_id: UUID | None,
        at: datetime,
        office_id: UUID | None,
    ) -> bool:
        if self.scope is None or owner_id is None:
            return False
        if self.restrict_current_team:
            return owner_id == self.actor.id or owner_id in self.descendant_ids
        if self.scope is VisibilityScope.COMPANY:
            return True
        if self.scope is VisibilityScope.OWN:
            return owner_id == self.actor.id
        if self.scope is VisibilityScope.OFFICE:
            event_office = (
                office_id
                or self.office_at(owner_id, at)
                or (owner_id == self.actor.id and self.actor.office_id)
            )
            if owner_id == self.actor.id and event_office is None:
                event_office = self.actor.office_id
            return event_office is not None and event_office == self.actor.office_id
        if owner_id == self.actor.id:
            return True
        if owner_id in self.descendant_ids and self.was_descendant_at(owner_id, at):
            return True
        return self.was_descendant_at(owner_id, at)


async def load_reporting_access(session: AsyncSession, actor: User) -> ReportingAccess:
    scope = reporting_visibility_scope(actor)
    descendants: set[UUID] = set()
    if scope is VisibilityScope.TEAM:
        descendants = await descendant_ids(session, actor.id)
    if has_user_type(actor, "TL"):
        descendants = (await tl_team_owner_ids(session, actor)) - {actor.id}
    users = (await session.execute(select(User.id, User.reporting_manager_id))).all()
    current_managers = {row[0]: row[1] for row in users}
    history = (
        (
            await session.execute(
                select(UserAssignmentHistory).where(
                    UserAssignmentHistory.field.in_(
                        (AssignmentField.REPORTING_MANAGER, AssignmentField.OFFICE)
                    )
                )
            )
        )
        .scalars()
        .all()
    )
    manager_spans: dict[UUID, list[tuple[datetime, datetime | None, UUID | None]]] = {}
    office_spans: dict[UUID, list[tuple[datetime, datetime | None, UUID | None]]] = {}
    for row in history:
        value = UUID(row.value_id) if row.value_id else None
        span = (_aware(row.effective_from), row.effective_to and _aware(row.effective_to), value)
        if row.field == AssignmentField.REPORTING_MANAGER:
            manager_spans.setdefault(row.user_id, []).append(span)
        else:
            office_spans.setdefault(row.user_id, []).append(span)
    return ReportingAccess(
        actor=actor,
        scope=scope,
        descendant_ids=descendants,
        current_managers=current_managers,
        manager_spans=manager_spans,
        office_spans=office_spans,
        restrict_current_team=has_user_type(actor, "TL"),
    )


def empty_payload(access: ReportingAccess, period: dict[str, object]) -> dict[str, object]:
    return {
        "reportingScope": access.label,
        "currency": "AED",
        "period": period,
        "empty": True,
        "kpis": _empty_kpis(),
        "conversions": _empty_conversions(),
        "stageBreakdown": [],
        "activeDelays": _empty_delays(),
        "rankings": {"employees": [], "teams": [], "offices": [], "bankProducts": []},
        "trend": [],
        "targetsSummary": None,
        "items": [],
        "total": 0,
    }


def _empty_kpis() -> dict[str, object]:
    zero = {"count": 0, "value": "0.00"}
    return {
        "applicationsOwned": {"count": 0},
        "submitted": zero,
        "approved": zero,
        "booked": zero,
        "funded": zero,
        "pending": {"count": 0},
        "returnedRequirementPending": {"count": 0},
        "resubmitted": {"count": 0},
        "finalRejected": {"count": 0},
        "cancelled": {"count": 0},
        "withdrawn": {"count": 0},
        "completed": {"count": 0},
        "personalFinance": {"count": 0, "value": "0.00"},
        "creditCard": {"count": 0, "value": None},
        "totalBusinessValue": "0.00",
    }


def _empty_conversions() -> dict[str, object]:
    return {
        "submittedToApproved": None,
        "approvedToBooked": None,
        "bookedToFunded": None,
        "submittedToFinalRejected": None,
        "submittedToCancelledWithdrawn": None,
    }


def _empty_delays() -> dict[str, int]:
    return {"Bank": 0, "Customer": 0, "Internal": 0, "Other": 0, "total": 0}
