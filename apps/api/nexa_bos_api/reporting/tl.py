"""Read-only TL workspace: current, directly assigned team membership is authoritative."""

from collections import Counter
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.applications.models import Workflow
from nexa_bos_api.applications.review import REVIEW_EVENTS, REVIEW_LABELS, review_state
from nexa_bos_api.attendance.service import personal_attendance_snapshot
from nexa_bos_api.case_operations.models import CaseEarning, CaseEarningReversal
from nexa_bos_api.case_operations.reporting import employee_metrics
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
    "forwarded": "Pending SM Approval",
    "active": "Active Team Cases",
    "submitted": "Submitted",
    "approved": "Approved",
    "funded": "Funded / Completed",
    "attention": "Attention Required",
    "all": "All cases",
    "booking": "Needs TL Booking",
    "coordinator": "With Coordinator",
    "overdue": "Overdue",
    "clawback": "Clawbacks in Period",
    "stage_created": "Created",
    "stage_tl_booking": "TL Booking",
    "stage_sm": "SM Approval",
    "stage_coordinator": "Coordinator",
    "stage_bank": "Bank Submitted",
    "stage_completed": "Completed",
    "stage_returned": "On Hold / Returned",
    "stage_closed": "Other Closed Outcomes",
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
            "booked",
            "sm_approved",
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
                    if open_at(fact, cutoff):
                        state = routing_at(fact, cutoff)
                        if state is None:
                            unknown = True
                        elif state == "booked":
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
                " Cases awaiting SM approval at each cutoff;"
                " missing legacy review history is a gap."
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
    date_from: date | None = None,
    date_to: date | None = None,
    member_id: UUID | None = None,
    search: str = "",
    owner_id: UUID | None = None,
    product_id: UUID | None = None,
    stage_id: UUID | None = None,
    outcome: str | None = None,
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
    if bool(date_from) != bool(date_to):
        raise AppError(status_code=422, code="INVALID_FILTER", message="Choose both range dates")
    # All collections and calculations originate from this exact current-owner allowlist.
    allowed = await tl_team_owner_ids(session, actor)
    if member_id is not None and member_id not in allowed - {actor.id}:
        raise AppError(status_code=404, code="USER_NOT_FOUND", message="Team member not found")
    if owner_id is not None and owner_id not in allowed:
        raise AppError(status_code=404, code="USER_NOT_FOUND", message="Case owner not found")
    facts, users, offices, teams = await load_facts(session, owner_ids=allowed)
    display_names = {str(user_id): user.full_name for user_id, user in users.items()}

    def timeline_details(payload):
        details = dict(payload or {})
        for key, label in (("fromOwnerId", "previousOwner"), ("toOwnerId", "newOwner")):
            if details.get(key):
                details[label] = display_names.get(details[key], "Unavailable employee")
        return details

    access = await load_reporting_access(session, actor)
    window = (
        resolve_period("custom", date_from=date_from, date_to=date_to)
        if date_from and date_to
        else resolve_period(period)
    )
    now = datetime.now(UTC)
    states = {fact.id: review_state(fact.events) for fact in facts}
    selected = [
        f
        for f in facts
        if view == "combined" or (f.current_owner_id == actor.id) == (view == "own")
    ]
    if member_id is not None:
        selected = [f for f in selected if f.current_owner_id == member_id]
    timeline_facts = selected
    if date_from and date_to:
        selected = [f for f in selected if in_window(f.created_at, window)]
    created = [f for f in selected if in_window(f.created_at, window)]
    opened = [f for f in selected if not f.terminal_outcome]

    def can_book(f):
        return (
            not f.terminal_outcome
            and states[f.id]["tlId"] == str(actor.id)
            and states[f.id]["status"] in {"pending_review", "resubmitted"}
        )

    def current_bucket(f):
        # Mutually exclusive CURRENT states; milestone totals below are cumulative.
        if f.terminal_outcome:
            return "completed" if f.terminal_outcome == "Completed" else "closed"
        if f.submitted_at:
            return "bank"
        if states[f.id]["status"] == "returned":
            return "returned"
        if f.routing_status == "sm_approved":
            return "coordinator"
        if f.routing_status == "booked":
            return "sm"
        return "tl_booking" if can_book(f) else "created"

    current_labels = {
        "created": "Created",
        "tl_booking": "TL Booking",
        "sm": "SM Approval",
        "coordinator": "Coordinator",
        "bank": "Bank Submitted",
        "completed": "Completed",
        "returned": "On Hold / Returned",
        "closed": "Closed",
    }
    # Pending work spans creation periods, while completed activity uses event dates.
    queues = {
        key: [f for f in opened if states[f.id]["status"] == key]
        for key in ("pending_review", "returned", "resubmitted")
    }
    queues.update(
        {
            "forwarded": [
                f for f in selected if not f.terminal_outcome and f.routing_status == "booked"
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
            "all": selected,
        }
    )
    queues.update(
        {
            f"stage_{key}": [f for f in selected if current_bucket(f) == key]
            for key in current_labels
        }
    )
    queues["booking"] = [f for f in selected if can_book(f)]
    queues["coordinator"] = queues["stage_coordinator"]
    queues["overdue"] = [f for f in opened if f.active_delay_type]

    def item(f: AppFact) -> dict[str, object]:
        state = states[f.id]
        return {
            "id": str(f.id),
            "fileNumber": f.code,
            "customer": f.customer_name,
            "caseOwner": users[f.current_owner_id].full_name,
            "ownerId": str(f.current_owner_id),
            "productId": str(f.product_id),
            "stageId": str(f.current_stage_id),
            "outcome": f.terminal_outcome,
            "pendingRole": "—"
            if f.terminal_outcome
            else "Bank"
            if f.submitted_at
            else "Coordinator"
            if f.routing_status == "sm_approved"
            else "SM"
            if f.routing_status == "booked"
            else "Case Owner"
            if state["status"] == "returned"
            else "TL",
            "bank": f.bank_name,
            "product": f.product_name,
            "requestedAmount": money(f.requested_amount),
            "routingStatus": state["status"],
            "routingLabel": "Completed/Closed"
            if f.terminal_outcome == "Completed"
            else "Bank Submitted"
            if f.submitted_at
            else state["label"],
            "bankStage": f.terminal_outcome or f.current_stage_name,
            "statusLabel": "Completed/Closed"
            if current_bucket(f) == "completed"
            else "Pending TL Booking"
            if current_bucket(f) == "tl_booking"
            else "Pending SM Approval"
            if current_bucket(f) == "sm"
            else "With Coordinator"
            if current_bucket(f) == "coordinator"
            else current_labels[current_bucket(f)],
            "currentBucket": current_bucket(f),
            "bankNumber": f.bank_case_number,
            "tatSeconds": max(
                0, int((_aware(f.tat_stopped_at or now) - _aware(f.created_at)).total_seconds())
            ),
            "delayed": bool(f.active_delay_type),
            "updatedAt": (f.updated_at or f.created_at).isoformat(),
            "reason": state["reason"],
            "canReview": can_book(f),
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
                "hasPhoto": bool(users[user_id].profile_photo_key),
                "photoUpdatedAt": users[user_id].updated_at.isoformat(),
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
                "conversion": ratio(
                    sum(
                        f.current_owner_id == user_id
                        and f.terminal_outcome == "Completed"
                        and in_window(f.terminal_at, window)
                        for f in facts
                    ),
                    metrics["submitted"]["count"],
                ),
                "earnings": await employee_metrics(session, actor, user_id, window=window),
                "attendance": await personal_attendance_snapshot(session, users[user_id]),
                "pendingReview": sum(
                    f.current_owner_id == user_id
                    and states[f.id]["status"] in {"pending_review", "resubmitted"}
                    for f in facts
                ),
                "openCases": sum(
                    f.current_owner_id == user_id and not f.terminal_outcome for f in facts
                ),
                "completed": sum(
                    f.current_owner_id == user_id
                    and f.terminal_outcome == "Completed"
                    and in_window(f.terminal_at, window)
                    for f in facts
                ),
                "pendingApproval": sum(
                    f.current_owner_id == user_id
                    and not f.terminal_outcome
                    and (
                        f.routing_status == "booked"
                        or states[f.id]["status"] in {"pending_review", "resubmitted"}
                    )
                    for f in facts
                ),
                "delayed": sum(
                    f.current_owner_id == user_id
                    and not f.terminal_outcome
                    and bool(f.active_delay_type)
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
        if s.workflow_id == f.workflow_id
        and s.status == "active"
        and not (f.product_code == "CC" and s.system_key == "fund_released")
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
    clawback_case_ids = set(
        await session.scalars(
            select(CaseEarning.application_id)
            .join(CaseEarningReversal, CaseEarningReversal.earning_id == CaseEarning.id)
            .where(
                CaseEarning.case_owner_id.in_(allowed),
                CaseEarningReversal.reversed_at >= window.start,
                CaseEarningReversal.reversed_at <= window.end,
            )
            .distinct()
        )
    )
    queues["clawback"] = [f for f in selected if f.id in clawback_case_ids]
    rows = latest(
        [
            f
            for f in queues[queue]
            if (owner_id is None or f.current_owner_id == owner_id)
            and (product_id is None or f.product_id == product_id)
            and (stage_id is None or f.current_stage_id == stage_id)
            and (not outcome or (f.terminal_outcome or "in_progress") == outcome)
            and (
                not search.strip()
                or search.strip().casefold()
                in " ".join(
                    (
                        f.code,
                        f.customer_name,
                        users[f.current_owner_id].full_name,
                        f.bank_case_number or "",
                    )
                ).casefold()
            )
        ]
    )
    size = 8
    office, team = offices.get(actor.office_id), teams.get(actor.team_id)
    own_earnings = await employee_metrics(session, actor, actor.id, window=window)
    manager = users.get(actor.reporting_manager_id)
    if manager and (not has_user_type(manager, "SM") or manager.office_id != actor.office_id):
        manager = None
    earnings = list(
        await session.scalars(select(CaseEarning).where(CaseEarning.case_owner_id.in_(allowed)))
    )
    clawbacks = []
    clawback_events = []
    for earning in earnings:
        reversals = list(
            await session.scalars(
                select(CaseEarningReversal)
                .where(CaseEarningReversal.earning_id == earning.id)
                .order_by(CaseEarningReversal.reversed_at)
            )
        )
        if not reversals:
            continue
        fact = next((f for f in facts if f.id == earning.application_id), None)
        running = earning.amount
        for reversal in reversals:
            previous = running
            running -= reversal.amount
            if fact in timeline_facts and in_window(reversal.reversed_at, window):
                approver = await session.get(User, reversal.approved_by_id)
                clawback_events.append(
                    {
                        "id": str(reversal.id),
                        "fileNumber": fact.code,
                        "applicationId": str(earning.application_id),
                        "event": "Clawback approved",
                        "at": reversal.reversed_at.isoformat(),
                        "reason": None,
                        "actor": approver.full_name if approver else "Unavailable actor",
                        "source": "Case earning reversal ledger",
                        "previousState": money(previous),
                        "newState": money(running),
                        "details": {
                            "caseOwnerName": users[earning.case_owner_id].full_name,
                            "ownerRole": "TL" if earning.case_owner_id == actor.id else "SE",
                            "earningType": "Card Points"
                            if earning.earning_type == "card_points"
                            else "Commission",
                            "original": money(earning.amount),
                            "deducted": money(reversal.amount),
                            "net": money(running),
                        },
                    }
                )
        if not any(in_window(r.reversed_at, window) for r in reversals):
            continue
        deducted = sum((r.amount for r in reversals), Decimal("0"))
        clawbacks.append(
            {
                "case": fact.code if fact else str(earning.application_id),
                "ownerId": str(earning.case_owner_id),
                "owner": users[earning.case_owner_id].full_name,
                "ownerRole": "TL" if earning.case_owner_id == actor.id else "SE",
                "type": earning.earning_type,
                "original": money(earning.amount),
                "deducted": money(deducted),
                "net": money(earning.amount - deducted),
            }
        )
    financial_fields = (
        "pointsEarned",
        "pointsReversed",
        "pointsNet",
        "loanAmount",
        "commissionEarned",
        "commissionReversed",
        "commissionNet",
    )
    count_fields = ("cardsBooked", "loansBooked", "pendingCases", "closedCases")
    team_earnings = {
        key: money(sum((Decimal(str(person["earnings"][key])) for person in staff), Decimal("0")))
        for key in financial_fields
    }
    team_earnings.update(
        {key: sum(person["earnings"][key] for person in staff) for key in count_fields}
    )

    def status_counts(cohort):
        return {
            "Created": sum(in_window(f.created_at, window) for f in cohort),
            "TL Booked": sum(in_window(f.booked_at, window) for f in cohort),
            "Pending SM Approval": sum(
                not f.terminal_outcome and f.routing_status == "booked" for f in cohort
            ),
            "On Hold/Returned": sum(
                not f.terminal_outcome and states[f.id]["status"] == "returned" for f in cohort
            ),
            "With Coordinator": sum(
                not f.terminal_outcome and not f.submitted_at and f.routing_status == "sm_approved"
                for f in cohort
            ),
            "Bank Submitted": sum(in_window(f.submitted_at, window) for f in cohort),
            "Completed/Closed": sum(
                f.terminal_outcome == "Completed" and in_window(f.terminal_at, window)
                for f in cohort
            ),
            "Clawback": len(
                {
                    row["case"]
                    for row in clawbacks
                    if row["ownerId"] in {str(f.current_owner_id) for f in cohort}
                }
            ),
        }

    def current_summary(cohort):
        return {
            "total": len(cohort),
            "open": sum(not f.terminal_outcome for f in cohort),
            "booking": sum(can_book(f) for f in cohort),
            "overdue": sum(not f.terminal_outcome and bool(f.active_delay_type) for f in cohort),
            "clawback": sum(f.id in clawback_case_ids for f in cohort),
            "stages": {
                key: sum(current_bucket(f) == key for f in cohort) for key in current_labels
            },
        }

    return {
        "office": office.name if office else "Office not assigned",
        "team": team.name if team else "Team not assigned",
        "updatedAt": now.isoformat(),
        "period": period,
        "view": view,
        "ownTotal": sum(f.current_owner_id == actor.id for f in facts),
        "teamTotal": sum(f.current_owner_id != actor.id for f in facts),
        "ownStatus": status_counts([f for f in facts if f.current_owner_id == actor.id]),
        "teamStatus": status_counts([f for f in facts if f.current_owner_id != actor.id]),
        "currentWork": {
            "own": current_summary([f for f in facts if f.current_owner_id == actor.id]),
            "team": current_summary([f for f in facts if f.current_owner_id != actor.id]),
        },
        "pendingBookingItems": [item(f) for f in latest([f for f in facts if can_book(f)])[:5]],
        "ownEarnings": own_earnings,
        "teamEarnings": team_earnings,
        "hierarchy": {
            "salesManager": manager.full_name if manager else None,
            "teamLeader": actor.full_name,
        },
        "filterOptions": {
            "owners": [
                {"id": str(uid), "name": users[uid].full_name}
                for uid in sorted(allowed, key=lambda uid: users[uid].full_name)
            ],
            "products": [
                {"id": str(pid), "name": name}
                for pid, name in sorted(
                    {f.product_id: f.product_name for f in facts}.items(), key=lambda row: row[1]
                )
            ],
            "stages": stages,
            "outcomes": sorted({f.terminal_outcome for f in facts if f.terminal_outcome}),
            "cases": [
                {"id": str(f.id), "name": f.code, "ownerId": str(f.current_owner_id)}
                for f in timeline_facts
            ],
        },
        "clawbacks": clawbacks,
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
        "activity": sorted(
            [
                {
                    "id": str(e.id),
                    "fileNumber": f.code,
                    "applicationId": str(f.id),
                    "event": e.event_type,
                    "at": e.bos_updated_at.isoformat(),
                    "reason": e.reason,
                    "actor": users[e.actor_id].full_name
                    if e.actor_id in users
                    else str(e.actor_id),
                    "source": "Application event",
                    "previousState": f.stages[e.previous_stage_id].name
                    if e.previous_stage_id in f.stages
                    else (e.payload or {}).get("previousStatus"),
                    "newState": "Completed/Closed"
                    if e.event_type == "completed"
                    else f.stages[e.new_stage_id].name
                    if e.new_stage_id in f.stages
                    else (e.payload or {}).get("status"),
                    "details": timeline_details(e.payload),
                }
                for f, e in sorted(
                    [
                        (f, e)
                        for f in timeline_facts
                        for e in f.events
                        if in_window(e.bos_updated_at, window)
                    ],
                    key=lambda pair: pair[1].bos_updated_at,
                    reverse=True,
                )
            ]
            + clawback_events,
            key=lambda event: event["at"],
            reverse=True,
        ),
        "personalPerformance": await _personal_performance_payload(
            session, actor, selected_window=window, facts=facts, access=access
        ),
        "personalAttendance": await personal_attendance_snapshot(session, actor),
    }
