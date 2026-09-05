"""Read-only TL workspace: current, directly assigned team membership is authoritative."""

from collections import Counter
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.applications.review import REVIEW_LABELS, review_state
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
from nexa_bos_api.reporting.periods import in_window, resolve_period
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
            "count": sum(_aware(f.created_at).date().replace(day=1) == m for f in selected),
        }
        for m in months
    ]
    stage_rows = {
        s.id: s
        for f in selected
        for s in f.stages.values()
        if s.workflow_id == f.workflow_id and s.status == "active"
    }
    stages = [
        {"name": s.name, "count": sum(f.current_stage_id == s.id for f in selected)}
        for s in sorted(stage_rows.values(), key=lambda s: (s.sort_order, s.name, str(s.id)))
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
