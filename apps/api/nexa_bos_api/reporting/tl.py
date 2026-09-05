"""Read-only TL workspace: current, directly assigned team membership is authoritative."""

from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.applications.models import Workflow
from nexa_bos_api.applications.review import REVIEW_EVENTS, REVIEW_LABELS, review_state
from nexa_bos_api.attendance.service import personal_attendance_snapshot
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import (
    application_visibility_scope,
    has_permission,
    has_user_type,
    reporting_visibility_scope,
    tl_team_owner_ids,
)
from nexa_bos_api.identity.models import User
from nexa_bos_api.identity.permissions import APPLICATIONS_VIEW, DASHBOARD_VIEW
from nexa_bos_api.reporting.periods import PeriodWindow, end_of_day, in_window, resolve_period
from nexa_bos_api.reporting.scope import load_reporting_access
from nexa_bos_api.reporting.service import (
    AppFact,
    MetricEngine,
    ReportFilters,
    _aware,
    _month_start_shift,
    _personal_performance_payload,
    _target_progress,
    load_facts,
    money,
    ratio,
)

QUEUE_LABELS = {
    "pending_review": "Pending Review",
    "returned": "Returned",
    "resubmitted": "Resubmitted",
    "forwarded": "Forwarded to COD",
    "active": "Active Team Cases",
    "submitted": "Submitted",
    "approved": "Approved",
    "funded": "Funded / Completed",
    "attention": "Attention Required",
    "all": "All cases",
}


def _history_cutoffs(window: PeriodWindow, now: datetime) -> list[datetime]:
    """Daily period endpoints, or monthly YTD endpoints; never invent future points."""
    last = min(window.end, now)
    cursor = window.date_from
    cutoffs = []
    while cursor <= last.date():
        if window.key == "ytd":
            next_month = _month_start_shift(cursor.replace(day=1), 1)
            cutoff = min(end_of_day(next_month - timedelta(days=1)), last)
            cursor = next_month
        else:
            cutoff = min(end_of_day(cursor), last)
            cursor += timedelta(days=1)
        cutoffs.append(cutoff)
    return cutoffs


def _metric_history(facts: list[AppFact], window: PeriodWindow, now: datetime) -> dict[str, object]:
    """Histories share the TL's already-authorized current-owner cohort and view."""
    cutoffs = _history_cutoffs(window, now)
    reviews = {
        fact.id: sorted(
            (event for event in fact.events if event.event_type in REVIEW_EVENTS),
            key=lambda event: (_aware(event.bos_updated_at), str(event.id)),
        )
        for fact in facts
    }
    current_states = {fact.id: review_state(fact.events)["status"] for fact in facts}

    def open_at(fact: AppFact, cutoff: datetime) -> bool | None:
        if _aware(fact.created_at) > cutoff:
            return False
        if fact.terminal_at is not None:
            return _aware(fact.terminal_at) > cutoff
        # A terminal legacy record without its completion date has unknown historical stock.
        return None if fact.terminal_outcome else True

    def routing_at(fact: AppFact, cutoff: datetime) -> str | None:
        rows = [event for event in reviews[fact.id] if _aware(event.bos_updated_at) <= cutoff]
        if not rows:
            return None
        status = (rows[-1].payload or {}).get("status")
        if isinstance(status, str) and status in {
            "pending_review",
            "returned",
            "resubmitted",
            "forwarded",
        }:
            return status
        return None

    stock_basis = (
        "Open cases at each selected-period endpoint, using the current permitted owner scope. "
        "The card shows current stock and may differ from a past period endpoint. "
        "A gap means the historical state cannot be established."
    )
    cumulative_basis = (
        "Cumulative unique cases from the selected-period start to each endpoint, "
        "using the card's current permitted owner scope and recorded milestone dates."
    )
    histories = {}
    for key in list(QUEUE_LABELS)[:8]:
        points = []
        for cutoff in cutoffs:
            count = 0
            unknown = False
            for fact in facts:
                if key in {"pending_review", "returned", "resubmitted", "active"}:
                    opened = open_at(fact, cutoff)
                    if opened is None:
                        unknown = True
                    elif opened:
                        if key == "active":
                            count += 1
                        else:
                            state = routing_at(fact, cutoff)
                            if state is None:
                                unknown = True
                            elif state == key:
                                count += 1
                elif key == "forwarded":
                    existed = _aware(fact.created_at) <= cutoff
                    overlaps = fact.terminal_at is None or _aware(fact.terminal_at) >= window.start
                    if existed and overlaps and routing_at(fact, cutoff) is None:
                        unknown = True
                    elif current_states[fact.id] == "forwarded" and any(
                        event.event_type in {"internal_forwarded", "internal_review_started"}
                        and (event.payload or {}).get("status") == "forwarded"
                        and window.start <= _aware(event.bos_updated_at) <= cutoff
                        for event in reviews[fact.id]
                    ):
                        count += 1
                else:
                    dates = {
                        "submitted": [fact.submitted_at],
                        "approved": [fact.approved_at],
                        "funded": [
                            fact.funded_at,
                            fact.terminal_at if fact.terminal_outcome == "Completed" else None,
                        ],
                    }[key]
                    if any(moment and window.start <= _aware(moment) <= cutoff for moment in dates):
                        count += 1
            points.append({"date": cutoff.date().isoformat(), "value": None if unknown else count})
        basis = (
            stock_basis
            if key in {"pending_review", "returned", "resubmitted", "active"}
            else cumulative_basis
        )
        if key == "forwarded":
            basis += (
                " Only currently forwarded cases qualify; missing legacy review history is a gap."
            )
        if key == "funded":
            basis += " A case that is both funded and completed is counted once."
        histories[key] = {"unit": "cases", "basis": basis, "points": points}
    return histories


async def tl_dashboard(
    session: AsyncSession,
    actor: User,
    *,
    period: str,
    view: str,
    queue: str,
    page: int,
) -> dict[str, object]:
    if not (
        has_user_type(actor, "TL")
        and has_permission(actor, DASHBOARD_VIEW)
        and has_permission(actor, APPLICATIONS_VIEW)
        and application_visibility_scope(actor) is not None
        and reporting_visibility_scope(actor) is not None
    ):
        raise AppError(status_code=403, code="FORBIDDEN", message="Permission denied")
    if (
        period not in {"today", "mtd", "previous_month", "ytd"}
        or view not in {"own", "team", "combined"}
        or queue not in QUEUE_LABELS
    ):
        raise AppError(
            status_code=422, code="INVALID_FILTER", message="Unknown TL dashboard filter"
        )
    # All collections and calculations originate from this exact current-owner allowlist.
    allowed = await tl_team_owner_ids(session, actor)
    facts, users, offices, teams = await load_facts(session, owner_ids=allowed)
    access = await load_reporting_access(session, actor)
    window = resolve_period(period)
    now = datetime.now(UTC)
    states = {fact.id: review_state(fact.events) for fact in facts}
    selected = [
        f
        for f in facts
        if view == "combined" or (f.current_owner_id == actor.id) == (view == "own")
    ]
    created = [f for f in selected if in_window(f.created_at, window)]
    opened = [f for f in selected if not f.terminal_outcome]
    # Pending work spans creation periods, while completed activity uses event dates.
    queues = {
        key: [f for f in opened if states[f.id]["status"] == key]
        for key in ("pending_review", "returned", "resubmitted")
    }
    queues.update(
        {
            "forwarded": [
                f
                for f in selected
                if states[f.id]["status"] == "forwarded"
                and any(
                    e.event_type in {"internal_forwarded", "internal_review_started"}
                    and (e.payload or {}).get("status") == "forwarded"
                    and in_window(e.bos_updated_at, window)
                    for e in f.events
                )
            ],
            "active": opened,
            "submitted": [f for f in selected if in_window(f.submitted_at, window)],
            "approved": [f for f in selected if in_window(f.approved_at, window)],
            "funded": [
                f
                for f in selected
                if in_window(f.funded_at, window)
                or (f.terminal_outcome == "Completed" and in_window(f.terminal_at, window))
            ],
            "attention": [
                f
                for f in opened
                if f.active_delay_type
                or states[f.id]["status"] in {"pending_review", "returned", "resubmitted"}
            ],
            "all": created,
        }
    )

    def item(f: AppFact) -> dict[str, object]:
        state = states[f.id]
        return {
            "id": str(f.id),
            "fileNumber": f.code,
            "customer": f.customer_name,
            "caseOwner": users[f.current_owner_id].full_name,
            "bank": f.bank_name,
            "product": f.product_name,
            "requestedAmount": money(f.requested_amount),
            "routingStatus": state["status"],
            "routingLabel": state["label"],
            "bankStage": f.current_stage_name,
            "bankNumber": f.bank_case_number,
            "tatSeconds": max(
                0, int((_aware(f.tat_stopped_at or now) - _aware(f.created_at)).total_seconds())
            ),
            "delayed": bool(f.active_delay_type),
            "updatedAt": (f.updated_at or f.created_at).isoformat(),
            "reason": state["reason"],
            "canReview": state["tlId"] == str(actor.id)
            and state["status"] in {"pending_review", "resubmitted"},
        }

    def latest(rows: list[AppFact]) -> list[AppFact]:
        return sorted(rows, key=lambda f: f.updated_at or f.created_at, reverse=True)

    def counts(values) -> list[dict[str, object]]:
        return [{"name": name, "count": count} for name, count in sorted(Counter(values).items())]

    # Existing target engine, guarded by the same direct-SE allowlist; no general Targets access.
    from nexa_bos_api.targets.service import _profile_targets_kpi

    staff = []
    for user_id in sorted(allowed - {actor.id}, key=lambda uid: users[uid].full_name):
        target = _target_progress(
            await _profile_targets_kpi(
                session,
                actor,
                user_id,
                window=window,
                facts=facts,
                access=access,
            )
        )
        metrics = MetricEngine(facts, access, window, ReportFilters(employee_id=user_id)).kpis()
        staff.append(
            {
                "id": str(user_id),
                "name": users[user_id].full_name,
                "target": {
                    key: target[key]
                    for key in (
                        "assigned",
                        "achieved",
                        "remaining",
                        "achievementPct",
                        "measurement",
                    )
                },
                "applications": metrics["applicationsOwned"]["count"],
                "cc": metrics["creditCard"]["count"],
                "pf": metrics["personalFinance"]["count"],
                "submitted": metrics["submitted"]["count"],
                "approved": metrics["approved"]["count"],
                "funded": metrics["funded"]["count"],
                "conversion": ratio(metrics["approved"]["count"], metrics["submitted"]["count"]),
                "pendingReview": sum(
                    f.current_owner_id == user_id
                    and states[f.id]["status"] in {"pending_review", "resubmitted"}
                    for f in facts
                ),
            }
        )
    month = now.date().replace(day=1)
    months = [_month_start_shift(month, offset) for offset in range(-5, 1)]
    trend = [
        {
            "name": m.strftime("%b %Y"),
            "created": sum(_aware(f.created_at).date().replace(day=1) == m for f in selected),
            "submitted": sum(
                bool(f.submitted_at and _aware(f.submitted_at).date().replace(day=1) == m)
                for f in selected
            ),
        }
        for m in months
    ]
    stage_rows = {
        s.id: s
        for f in selected
        for s in f.stages.values()
        if s.workflow_id == f.workflow_id and s.status == "active"
    }
    workflow_ids = {stage.workflow_id for stage in stage_rows.values()}
    workflows = {
        row.id: row
        for row in (
            await session.scalars(select(Workflow).where(Workflow.id.in_(workflow_ids)))
            if workflow_ids
            else []
        )
    }
    workflow_context = {
        f.workflow_id: f"{f.bank_name} · {f.product_name} · v{workflows[f.workflow_id].version}"
        for f in selected
        if f.workflow_id in workflows
    }
    stages = [
        {
            "stageId": str(s.id),
            "name": s.name,
            "workflowContext": workflow_context.get(s.workflow_id, "Configured workflow"),
            "label": f"{workflow_context.get(s.workflow_id, 'Configured workflow')} · {s.name}",
            "count": sum(f.current_stage_id == s.id for f in selected),
        }
        for s in sorted(
            stage_rows.values(),
            key=lambda s: (workflow_context.get(s.workflow_id, ""), s.sort_order, str(s.id)),
        )
    ]
    rows = latest(queues[queue])
    size = 8
    office, team = offices.get(actor.office_id), teams.get(actor.team_id)
    return {
        "office": office.name if office else "Office not assigned",
        "team": team.name if team else "Team not assigned",
        "updatedAt": now.isoformat(),
        "period": period,
        "view": view,
        "queue": queue,
        "queueLabel": QUEUE_LABELS[queue],
        "cards": [
            {"key": key, "label": QUEUE_LABELS[key], "count": len(queues[key])}
            for key in list(QUEUE_LABELS)[:8]
        ],
        "metricHistory": _metric_history(selected, window, now),
        "items": [item(f) for f in rows[(page - 1) * size : page * size]],
        "total": len(rows),
        "page": page,
        "pageSize": size,
        "charts": {
            "trend": trend,
            "ownership": [
                {"name": "My cases", "count": sum(f.current_owner_id == actor.id for f in created)},
                {
                    "name": "Team cases",
                    "count": sum(f.current_owner_id != actor.id for f in created),
                },
            ],
            "review": [
                {
                    "name": REVIEW_LABELS[key],
                    "count": sum(states[f.id]["status"] == key for f in selected),
                }
                for key in ("pending_review", "returned", "resubmitted", "forwarded")
            ],
            "stages": stages,
            "products": counts(f.product_name for f in created),
            "outcomes": counts(f.terminal_outcome or "In progress" for f in created),
            "tat": [
                {"name": "Recorded delay", "count": sum(bool(f.active_delay_type) for f in opened)},
                {
                    "name": "No recorded delay",
                    "count": sum(not f.active_delay_type for f in opened),
                },
            ],
        },
        "staff": staff,
        "attention": [item(f) for f in latest(queues["attention"])[:5]],
        "returned": [item(f) for f in latest(queues["returned"])[:5]],
        "activity": [
            {
                "id": str(e.id),
                "fileNumber": f.code,
                "applicationId": str(f.id),
                "event": e.event_type,
                "at": e.bos_updated_at.isoformat(),
                "reason": e.reason,
            }
            for f, e in sorted(
                [(f, e) for f in selected for e in f.events],
                key=lambda pair: pair[1].bos_updated_at,
                reverse=True,
            )[:10]
        ],
        "personalPerformance": await _personal_performance_payload(
            session, actor, selected_window=window, facts=facts, access=access
        ),
        "personalAttendance": await personal_attendance_snapshot(session, actor),
    }
