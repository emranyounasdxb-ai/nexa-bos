from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from nexa_bos_api.applications.models import (
    Application,
    ApplicationDelay,
    ApplicationEvent,
    ApplicationOwnerHistory,
    ApplicationStageOccupancy,
    WorkflowStage,
)
from nexa_bos_api.attendance.service import employee_attendance_summary
from nexa_bos_api.catalog.models import Bank, Product
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.customers.models import Customer
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.models import Department, Office, Team, User
from nexa_bos_api.identity.permissions import ATTENDANCE_REPORTS, ATTENDANCE_VIEW
from nexa_bos_api.reporting.periods import PeriodWindow, in_window, resolve_period
from nexa_bos_api.reporting.scope import ReportingAccess, empty_payload, load_reporting_access

ZERO = Decimal("0.00")
PF = "PF"
CC = "CC"

RANKING_METRICS = ("submitted_value", "booked_value", "funded_value", "case_count")
DRILL_METRICS = frozenset(
    {
        "applications_owned",
        "submitted",
        "submitted_value",
        "approved",
        "approved_value",
        "booked",
        "booked_value",
        "funded",
        "funded_value",
        "pending",
        "returned",
        "resubmitted",
        "final_rejected",
        "cancelled",
        "withdrawn",
        "completed",
        "pf_count",
        "pf_value",
        "cc_count",
        "total_business_value",
        "delay_active",
        "delay_bank",
        "delay_customer",
        "delay_internal",
        "delay_other",
        "stage",
        "conversion_submitted_approved",
        "conversion_approved_booked",
        "conversion_booked_funded",
        "conversion_submitted_rejected",
        "conversion_submitted_cancelled_withdrawn",
    }
)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def money(value: Decimal | int | float | None) -> str | None:
    if value is None:
        return None
    amount = value if isinstance(value, Decimal) else Decimal(str(value))
    return f"{amount.quantize(Decimal('0.01')):.2f}"


def money0(value: Decimal | None) -> str:
    return money(value if value is not None else ZERO) or "0.00"


def ratio(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round((numerator / denominator) * 100, 2)


def pct_change(current: Decimal, previous: Decimal) -> float | None:
    if previous == 0:
        return None
    return round(float((current - previous) / previous * 100), 2)


@dataclass
class Attribution:
    owner_id: UUID | None
    office_id: UUID | None
    department_id: UUID | None
    team_id: UUID | None
    office_name: str | None
    team_name: str | None


@dataclass
class AppFact:
    id: UUID
    code: str
    customer_id: UUID
    customer_name: str
    bank_id: UUID
    bank_code: str
    product_id: UUID
    product_code: str
    created_at: datetime
    submitted_at: datetime | None
    approved_at: datetime | None
    booked_at: datetime | None
    funded_at: datetime | None
    terminal_at: datetime | None
    terminal_outcome: str | None
    requested_amount: Decimal | None
    approved_amount: Decimal | None
    booked_amount: Decimal | None
    funded_amount: Decimal | None
    current_stage_id: UUID
    current_stage_name: str
    current_stage_key: str | None
    current_owner_id: UUID
    created: Attribution
    submitted: Attribution
    approved: Attribution
    booked: Attribution
    funded: Attribution
    terminal: Attribution
    current_attr: Attribution
    occupancies: list[ApplicationStageOccupancy]
    stages: dict[UUID, WorkflowStage]
    history: list[ApplicationOwnerHistory]
    returned_at: list[tuple[datetime, Attribution]] = field(default_factory=list)
    resubmitted_at: list[tuple[datetime, Attribution]] = field(default_factory=list)
    active_delay_type: str | None = None

    def owner_at(self, moment: datetime | None) -> Attribution:
        return attribution_at(self.history, moment, self.current_owner_id)

    def stage_at(self, moment: datetime) -> tuple[UUID | None, str | None]:
        return stage_at_cutoff(self.occupancies, self.stages, moment, self.current_stage_id)


@dataclass
class ReportFilters:
    office_id: UUID | None = None
    department_id: UUID | None = None
    team_id: UUID | None = None
    employee_id: UUID | None = None
    bank_id: UUID | None = None
    product_id: UUID | None = None
    stage_id: UUID | None = None
    terminal_outcome: str | None = None
    delay_type: str | None = None


def serialize_period(window: PeriodWindow) -> dict[str, object]:
    return {
        "key": window.key,
        "label": window.label,
        "from": window.date_from.isoformat(),
        "to": window.date_to.isoformat(),
    }


def attribution_at(
    rows: list[ApplicationOwnerHistory],
    moment: datetime | None,
    fallback_owner: UUID,
) -> Attribution:
    if moment is None:
        current = next(
            (row for row in rows if row.effective_to is None), rows[-1] if rows else None
        )
        if current is None:
            return Attribution(fallback_owner, None, None, None, None, None)
        return Attribution(
            current.owner_id,
            current.office_id,
            current.department_id,
            current.team_id,
            current.office_name,
            current.team_name,
        )
    instant = _aware(moment)
    match = None
    for row in rows:
        start = _aware(row.effective_from)
        end = _aware(row.effective_to) if row.effective_to else None
        if start <= instant and (end is None or instant < end):
            match = row
            break
    if match is None:
        earlier = [row for row in rows if _aware(row.effective_from) <= instant]
        match = earlier[-1] if earlier else (rows[0] if rows else None)
    if match is None:
        return Attribution(fallback_owner, None, None, None, None, None)
    return Attribution(
        match.owner_id,
        match.office_id,
        match.department_id,
        match.team_id,
        match.office_name,
        match.team_name,
    )


def stage_at_cutoff(
    occupancies: list[ApplicationStageOccupancy],
    stages: dict[UUID, WorkflowStage],
    cutoff: datetime,
    current_id: UUID,
) -> tuple[UUID | None, str | None]:
    instant = _aware(cutoff)
    for row in occupancies:
        entered = _aware(row.entered_at)
        exited = _aware(row.exited_at) if row.exited_at else None
        if entered <= instant and (exited is None or instant < exited):
            stage = stages.get(row.stage_id)
            return row.stage_id, stage.name if stage else None
    stage = stages.get(current_id)
    return current_id, stage.name if stage else None


async def load_facts(
    session: AsyncSession,
) -> tuple[list[AppFact], dict[UUID, User], dict[UUID, Office], dict[UUID, Team]]:
    stage = aliased(WorkflowStage)
    rows = (
        await session.execute(
            select(Application, Product, Bank, stage, Customer)
            .join(Product, Application.product_id == Product.id)
            .join(Bank, Application.bank_id == Bank.id)
            .join(stage, Application.current_stage_id == stage.id)
            .join(Customer, Application.customer_id == Customer.id)
        )
    ).all()
    app_ids = [app.id for app, *_ in rows]
    histories: dict[UUID, list[ApplicationOwnerHistory]] = {}
    occupancies: dict[UUID, list[ApplicationStageOccupancy]] = {}
    events: dict[UUID, list[ApplicationEvent]] = {}
    delays: dict[UUID, ApplicationDelay] = {}
    stages: dict[UUID, WorkflowStage] = {}
    if app_ids:
        for row in (
            await session.execute(
                select(ApplicationOwnerHistory)
                .where(ApplicationOwnerHistory.application_id.in_(app_ids))
                .order_by(ApplicationOwnerHistory.effective_from.asc())
            )
        ).scalars():
            histories.setdefault(row.application_id, []).append(row)
        for row in (
            await session.execute(
                select(ApplicationStageOccupancy).where(
                    ApplicationStageOccupancy.application_id.in_(app_ids)
                )
            )
        ).scalars():
            occupancies.setdefault(row.application_id, []).append(row)
        for row in (
            await session.execute(
                select(ApplicationEvent)
                .where(ApplicationEvent.application_id.in_(app_ids))
                .order_by(ApplicationEvent.bos_updated_at.asc())
            )
        ).scalars():
            events.setdefault(row.application_id, []).append(row)
        for row in (
            await session.execute(
                select(ApplicationDelay).where(
                    ApplicationDelay.application_id.in_(app_ids),
                    ApplicationDelay.ended_at.is_(None),
                )
            )
        ).scalars():
            delays[row.application_id] = row
        for row in (await session.execute(select(WorkflowStage))).scalars():
            stages[row.id] = row
    users = {
        row.id: row
        for row in (
            await session.execute(
                select(User).options(
                    selectinload(User.office),
                    selectinload(User.department),
                    selectinload(User.team),
                    selectinload(User.designation),
                )
            )
        ).scalars()
    }
    offices = {row.id: row for row in (await session.execute(select(Office))).scalars()}
    teams = {row.id: row for row in (await session.execute(select(Team))).scalars()}
    facts: list[AppFact] = []
    for app, product, bank, current_stage, customer in rows:
        hist = histories.get(app.id, [])
        occ = occupancies.get(app.id, [])
        evs = events.get(app.id, [])
        terminal_at = app.completed_at
        if terminal_at is None:
            terminal_events = [
                event
                for event in evs
                if event.event_type in {"completed", "final_rejected", "cancelled", "withdrawn"}
            ]
            if terminal_events:
                terminal_at = terminal_events[0].bos_updated_at
        returned = [
            (event.bos_updated_at, attribution_at(hist, event.bos_updated_at, app.case_owner_id))
            for event in evs
            if event.event_type == "returned_requirement_pending"
        ]
        resubmitted = [
            (event.bos_updated_at, attribution_at(hist, event.bos_updated_at, app.case_owner_id))
            for event in evs
            if event.event_type == "resubmission"
        ]
        delay = delays.get(app.id)
        facts.append(
            AppFact(
                id=app.id,
                code=app.application_code,
                customer_id=app.customer_id,
                customer_name=customer.full_name or customer.company_name or customer.customer_code,
                bank_id=app.bank_id,
                bank_code=bank.code,
                product_id=app.product_id,
                product_code=product.code,
                created_at=app.created_at,
                submitted_at=app.submitted_at,
                approved_at=app.approved_at,
                booked_at=app.booked_at,
                funded_at=app.fund_released_at,
                terminal_at=terminal_at,
                terminal_outcome=app.terminal_outcome,
                requested_amount=app.requested_amount,
                approved_amount=app.approved_amount,
                booked_amount=app.booked_amount,
                funded_amount=app.funded_amount,
                current_stage_id=app.current_stage_id,
                current_stage_name=current_stage.name,
                current_stage_key=current_stage.system_key,
                current_owner_id=app.case_owner_id,
                created=attribution_at(hist, app.created_at, app.case_owner_id),
                submitted=attribution_at(hist, app.submitted_at, app.case_owner_id),
                approved=attribution_at(hist, app.approved_at, app.case_owner_id),
                booked=attribution_at(hist, app.booked_at, app.case_owner_id),
                funded=attribution_at(hist, app.fund_released_at, app.case_owner_id),
                terminal=attribution_at(hist, terminal_at, app.case_owner_id),
                current_attr=attribution_at(hist, None, app.case_owner_id),
                occupancies=occ,
                stages=stages,
                history=hist,
                returned_at=returned,
                resubmitted_at=resubmitted,
                active_delay_type=delay.delay_type if delay else None,
            )
        )
    return facts, users, offices, teams


def _visible_event(
    access: ReportingAccess,
    attr: Attribution,
    at: datetime | None,
    filters: ReportFilters,
) -> bool:
    if at is None:
        return False
    if not access.owner_visible(attr.owner_id, at, attr.office_id):
        return False
    return _attr_matches_filters(attr, filters)


def _attr_matches_filters(attr: Attribution, filters: ReportFilters) -> bool:
    if filters.employee_id and attr.owner_id != filters.employee_id:
        return False
    if filters.office_id and attr.office_id != filters.office_id:
        return False
    if filters.department_id and attr.department_id != filters.department_id:
        return False
    if filters.team_id and attr.team_id != filters.team_id:
        return False
    return True


def _app_matches_catalog(fact: AppFact, filters: ReportFilters) -> bool:
    if filters.bank_id and fact.bank_id != filters.bank_id:
        return False
    if filters.product_id and fact.product_id != filters.product_id:
        return False
    if filters.terminal_outcome and fact.terminal_outcome != filters.terminal_outcome:
        return False
    return True


def _pending_at_cutoff(fact: AppFact, window: PeriodWindow) -> bool:
    created = _aware(fact.created_at)
    if created > window.end:
        return False
    if fact.terminal_at is None:
        return True
    return _aware(fact.terminal_at) > window.end


def _cc_amount(fact: AppFact) -> Decimal | None:
    for value in (
        fact.funded_amount,
        fact.booked_amount,
        fact.approved_amount,
        fact.requested_amount,
    ):
        if value is not None:
            return value
    return None


class MetricEngine:
    def __init__(
        self,
        facts: list[AppFact],
        access: ReportingAccess,
        window: PeriodWindow,
        filters: ReportFilters,
    ) -> None:
        self.facts = facts
        self.access = access
        self.window = window
        self.filters = filters

    def owned(self) -> list[AppFact]:
        return [
            fact
            for fact in self.facts
            if _app_matches_catalog(fact, self.filters)
            and in_window(fact.created_at, self.window)
            and _visible_event(self.access, fact.created, fact.created_at, self.filters)
        ]

    def milestone(self, attr_name: str, when_name: str) -> list[AppFact]:
        matches: list[AppFact] = []
        for fact in self.facts:
            if not _app_matches_catalog(fact, self.filters):
                continue
            when = getattr(fact, when_name)
            attr = getattr(fact, attr_name)
            if in_window(when, self.window) and _visible_event(
                self.access, attr, when, self.filters
            ):
                matches.append(fact)
        return matches

    def terminal(self, outcome: str) -> list[AppFact]:
        return [
            fact
            for fact in self.milestone("terminal", "terminal_at")
            if fact.terminal_outcome == outcome
        ]

    def pending(self) -> list[AppFact]:
        matches: list[AppFact] = []
        for fact in self.facts:
            if not _app_matches_catalog(fact, self.filters):
                continue
            if not _pending_at_cutoff(fact, self.window):
                continue
            cutoff_owner = fact.owner_at(self.window.end)
            if not _visible_event(self.access, cutoff_owner, self.window.end, self.filters):
                continue
            cutoff_stage_id, _name = fact.stage_at(self.window.end)
            if self.filters.stage_id and cutoff_stage_id != self.filters.stage_id:
                continue
            matches.append(fact)
        return matches

    def repeated(self, field: str) -> list[AppFact]:
        matches: list[AppFact] = []
        seen: set[UUID] = set()
        for fact in self.facts:
            if not _app_matches_catalog(fact, self.filters):
                continue
            for when, attr in getattr(fact, field):
                if in_window(when, self.window) and _visible_event(
                    self.access, attr, when, self.filters
                ):
                    if fact.id not in seen:
                        matches.append(fact)
                        seen.add(fact.id)
                    break
        return matches

    def delays(self, delay_type: str | None = None) -> list[AppFact]:
        matches: list[AppFact] = []
        for fact in self.facts:
            if not _app_matches_catalog(fact, self.filters):
                continue
            if fact.active_delay_type is None:
                continue
            if delay_type and fact.active_delay_type != delay_type:
                continue
            if self.filters.delay_type and fact.active_delay_type != self.filters.delay_type:
                continue
            if not _visible_event(self.access, fact.current_attr, datetime.now(UTC), self.filters):
                continue
            matches.append(fact)
        return matches

    def for_metric(self, metric: str) -> list[AppFact]:
        if metric not in DRILL_METRICS:
            raise AppError(status_code=422, code="INVALID_METRIC", message="Unknown report metric")
        mapping: dict[str, list[AppFact]] = {
            "applications_owned": self.owned(),
            "submitted": self.milestone("submitted", "submitted_at"),
            "submitted_value": self.milestone("submitted", "submitted_at"),
            "approved": self.milestone("approved", "approved_at"),
            "approved_value": self.milestone("approved", "approved_at"),
            "booked": self.milestone("booked", "booked_at"),
            "booked_value": self.milestone("booked", "booked_at"),
            "funded": self.milestone("funded", "funded_at"),
            "funded_value": self.milestone("funded", "funded_at"),
            "pending": self.pending(),
            "returned": self.repeated("returned_at"),
            "resubmitted": self.repeated("resubmitted_at"),
            "final_rejected": self.terminal("Final Rejected"),
            "cancelled": self.terminal("Cancelled"),
            "withdrawn": self.terminal("Withdrawn"),
            "completed": self.terminal("Completed"),
            "pf_count": [f for f in self.owned() if f.product_code == PF],
            "pf_value": [f for f in self.milestone("funded", "funded_at") if f.product_code == PF],
            "cc_count": [f for f in self.owned() if f.product_code == CC],
            "total_business_value": self.milestone("funded", "funded_at"),
            "delay_active": self.delays(),
            "delay_bank": self.delays("Bank"),
            "delay_customer": self.delays("Customer"),
            "delay_internal": self.delays("Internal"),
            "delay_other": self.delays("Other"),
            "stage": self.pending(),
            "conversion_submitted_approved": self.milestone("approved", "approved_at"),
            "conversion_approved_booked": self.milestone("booked", "booked_at"),
            "conversion_booked_funded": self.milestone("funded", "funded_at"),
            "conversion_submitted_rejected": self.terminal("Final Rejected"),
            "conversion_submitted_cancelled_withdrawn": [
                *self.terminal("Cancelled"),
                *self.terminal("Withdrawn"),
            ],
        }
        items = mapping[metric]
        if metric == "stage" and self.filters.stage_id:
            items = [
                item for item in items if item.stage_at(self.window.end)[0] == self.filters.stage_id
            ]
        return items

    def kpis(self) -> dict[str, object]:
        submitted = self.milestone("submitted", "submitted_at")
        approved = self.milestone("approved", "approved_at")
        booked = self.milestone("booked", "booked_at")
        funded = self.milestone("funded", "funded_at")
        owned = self.owned()
        pf_owned = [item for item in owned if item.product_code == PF]
        cc_owned = [item for item in owned if item.product_code == CC]
        pf_funded = [item for item in funded if item.product_code == PF]
        cc_values = [_cc_amount(item) for item in cc_owned]
        cc_has_amount = any(value is not None for value in cc_values)
        return {
            "applicationsOwned": {"count": len(owned)},
            "submitted": {
                "count": len(submitted),
                "value": money0(
                    sum(((item.requested_amount or ZERO) for item in submitted), start=ZERO)
                ),
            },
            "approved": {
                "count": len(approved),
                "value": money0(
                    sum(((item.approved_amount or ZERO) for item in approved), start=ZERO)
                ),
            },
            "booked": {
                "count": len(booked),
                "value": money0(sum(((item.booked_amount or ZERO) for item in booked), start=ZERO)),
            },
            "funded": {
                "count": len(funded),
                "value": money0(sum(((item.funded_amount or ZERO) for item in funded), start=ZERO)),
            },
            "pending": {"count": len(self.pending())},
            "returnedRequirementPending": {"count": len(self.repeated("returned_at"))},
            "resubmitted": {"count": len(self.repeated("resubmitted_at"))},
            "finalRejected": {"count": len(self.terminal("Final Rejected"))},
            "cancelled": {"count": len(self.terminal("Cancelled"))},
            "withdrawn": {"count": len(self.terminal("Withdrawn"))},
            "completed": {"count": len(self.terminal("Completed"))},
            "personalFinance": {
                "count": len(pf_owned),
                "value": money0(
                    sum(((item.funded_amount or ZERO) for item in pf_funded), start=ZERO)
                ),
            },
            "creditCard": {
                "count": len(cc_owned),
                "value": (
                    money0(sum(((value or ZERO) for value in cc_values), start=ZERO))
                    if cc_has_amount
                    else None
                ),
            },
            "totalBusinessValue": money0(
                sum(((item.funded_amount or ZERO) for item in funded), start=ZERO)
            ),
        }

    def conversions(self) -> dict[str, float | None]:
        submitted = len(self.milestone("submitted", "submitted_at"))
        approved = len(self.milestone("approved", "approved_at"))
        booked = len(self.milestone("booked", "booked_at"))
        funded = len(self.milestone("funded", "funded_at"))
        rejected = len(self.terminal("Final Rejected"))
        cancelled = len(self.terminal("Cancelled")) + len(self.terminal("Withdrawn"))
        return {
            "submittedToApproved": ratio(approved, submitted),
            "approvedToBooked": ratio(booked, approved),
            "bookedToFunded": ratio(funded, booked),
            "submittedToFinalRejected": ratio(rejected, submitted),
            "submittedToCancelledWithdrawn": ratio(cancelled, submitted),
        }

    def stage_breakdown(self) -> list[dict[str, object]]:
        counts: dict[tuple[UUID | None, str], int] = {}
        for fact in self.pending():
            stage_id, stage_name = fact.stage_at(self.window.end)
            key = (stage_id, stage_name or "Unknown")
            counts[key] = counts.get(key, 0) + 1
        return [
            {"stageId": str(stage_id) if stage_id else None, "name": name, "count": count}
            for (stage_id, name), count in sorted(counts.items(), key=lambda item: item[0][1])
        ]

    def delay_breakdown(self) -> dict[str, int]:
        counts = {"Bank": 0, "Customer": 0, "Internal": 0, "Other": 0}
        for fact in self.delays():
            if fact.active_delay_type in counts:
                counts[fact.active_delay_type] += 1
        return {**counts, "total": sum(counts.values())}


def _rank_rows(rows: list[dict[str, object]], value_key: str = "value") -> list[dict[str, object]]:
    ranked: list[dict[str, object]] = []
    rank = 1
    previous: Decimal | int | None = None
    for index, row in enumerate(rows):
        current = row[value_key]
        comparable: Decimal | int
        if isinstance(current, str):
            comparable = Decimal(current)
        else:
            comparable = int(current)
        if previous is not None and comparable != previous:
            rank = index + 1
        ranked.append({**row, "rank": rank})
        previous = comparable
    return ranked


def ranking_value(fact: AppFact, metric: str) -> Decimal:
    if metric == "submitted_value":
        return fact.requested_amount or ZERO
    if metric == "booked_value":
        return fact.booked_amount or ZERO
    if metric == "funded_value":
        return fact.funded_amount or ZERO
    return Decimal(1)


def ranking_facts(engine: MetricEngine, metric: str) -> list[AppFact]:
    if metric == "submitted_value":
        return engine.milestone("submitted", "submitted_at")
    if metric == "booked_value":
        return engine.milestone("booked", "booked_at")
    if metric == "funded_value":
        return engine.milestone("funded", "funded_at")
    return engine.owned()


def build_rankings(
    engine: MetricEngine,
    users: dict[UUID, User],
    offices: dict[UUID, Office],
    teams: dict[UUID, Team],
    metric: str,
) -> dict[str, list[dict[str, object]]]:
    if metric not in RANKING_METRICS:
        raise AppError(status_code=422, code="INVALID_METRIC", message="Unknown ranking metric")
    facts = ranking_facts(engine, metric)
    employees: dict[UUID, Decimal] = {}
    employee_counts: dict[UUID, int] = {}
    team_values: dict[UUID, Decimal] = {}
    team_names: dict[UUID, str] = {}
    office_values: dict[UUID, Decimal] = {}
    office_names: dict[UUID, str] = {}
    bank_values: dict[tuple[UUID, UUID, str, str], Decimal] = {}
    attr_for = {
        "submitted_value": lambda fact: (fact.submitted, fact.submitted_at),
        "booked_value": lambda fact: (fact.booked, fact.booked_at),
        "funded_value": lambda fact: (fact.funded, fact.funded_at),
        "case_count": lambda fact: (fact.created, fact.created_at),
    }[metric]
    for fact in facts:
        attr, _when = attr_for(fact)
        value = ranking_value(fact, metric)
        if attr.owner_id:
            employees[attr.owner_id] = employees.get(attr.owner_id, ZERO) + value
            employee_counts[attr.owner_id] = employee_counts.get(attr.owner_id, 0) + 1
        if attr.team_id:
            team_values[attr.team_id] = team_values.get(attr.team_id, ZERO) + value
            team_names[attr.team_id] = attr.team_name or (
                teams[attr.team_id].name if attr.team_id in teams else "Team"
            )
        if attr.office_id:
            office_values[attr.office_id] = office_values.get(attr.office_id, ZERO) + value
            office_names[attr.office_id] = attr.office_name or (
                offices[attr.office_id].name if attr.office_id in offices else "Office"
            )
        bank_key = (fact.bank_id, fact.product_id, fact.bank_code, fact.product_code)
        bank_values[bank_key] = bank_values.get(bank_key, ZERO) + value

    def value_rows(
        mapping: dict[UUID, Decimal], names: dict[UUID, str], kind: str
    ) -> list[dict[str, object]]:
        rows = []
        for entity_id, value in mapping.items():
            rows.append(
                {
                    "id": str(entity_id),
                    "name": names.get(entity_id, str(entity_id)),
                    "value": money0(value) if metric != "case_count" else int(value),
                    "count": int(value) if metric == "case_count" else None,
                    "dimension": kind,
                }
            )
        rows.sort(
            key=lambda row: (
                Decimal(row["value"]) if isinstance(row["value"], str) else int(row["value"]),
                row["name"],
            ),
            reverse=True,
        )
        # name is secondary ascending while value is descending - split sort
        rows.sort(key=lambda row: row["name"])
        rows.sort(
            key=lambda row: (
                Decimal(row["value"]) if isinstance(row["value"], str) else int(row["value"])
            ),
            reverse=True,
        )
        return _rank_rows(rows, "value")

    employee_rows = []
    for user_id, value in employees.items():
        user = users.get(user_id)
        employee_rows.append(
            {
                "id": str(user_id),
                "name": user.full_name if user else str(user_id),
                "employeeCode": user.employee_code if user else None,
                "value": money0(value) if metric != "case_count" else employee_counts[user_id],
                "count": employee_counts[user_id],
                "dimension": "employee",
            }
        )
    employee_rows.sort(key=lambda row: row["name"])
    employee_rows.sort(
        key=lambda row: (
            Decimal(row["value"]) if isinstance(row["value"], str) else int(row["value"])
        ),
        reverse=True,
    )
    bank_rows = []
    for (bank_id, product_id, bank_code, product_code), value in bank_values.items():
        bank_rows.append(
            {
                "id": f"{bank_id}:{product_id}",
                "bankId": str(bank_id),
                "productId": str(product_id),
                "name": f"{bank_code} / {product_code}",
                "value": money0(value) if metric != "case_count" else int(value),
                "count": int(value) if metric == "case_count" else None,
                "dimension": "bank_product",
            }
        )
    bank_rows.sort(key=lambda row: row["name"])
    bank_rows.sort(
        key=lambda row: (
            Decimal(row["value"]) if isinstance(row["value"], str) else int(row["value"])
        ),
        reverse=True,
    )
    return {
        "metric": metric,
        "employees": _rank_rows(employee_rows, "value"),
        "teams": value_rows(team_values, team_names, "team"),
        "offices": value_rows(office_values, office_names, "office"),
        "bankProducts": _rank_rows(bank_rows, "value"),
    }


def serialize_application(fact: AppFact) -> dict[str, object]:
    return {
        "id": str(fact.id),
        "applicationCode": fact.code,
        "customerName": fact.customer_name,
        "bankCode": fact.bank_code,
        "productCode": fact.product_code,
        "currentStage": fact.current_stage_name,
        "terminalOutcome": fact.terminal_outcome,
        "requestedAmount": money(fact.requested_amount),
        "approvedAmount": money(fact.approved_amount),
        "bookedAmount": money(fact.booked_amount),
        "fundedAmount": money(fact.funded_amount),
        "submittedAt": fact.submitted_at.isoformat() if fact.submitted_at else None,
        "approvedAt": fact.approved_at.isoformat() if fact.approved_at else None,
        "bookedAt": fact.booked_at.isoformat() if fact.booked_at else None,
        "fundedAt": fact.funded_at.isoformat() if fact.funded_at else None,
        "createdAt": fact.created_at.isoformat(),
        "activeDelayType": fact.active_delay_type,
    }


def trend_points(
    facts: list[AppFact], access: ReportingAccess, filters: ReportFilters
) -> list[dict[str, object]]:
    buckets: dict[str, dict[str, int | Decimal]] = {}
    for fact in facts:
        if not _app_matches_catalog(fact, filters):
            continue
        if fact.submitted_at and _visible_event(access, fact.submitted, fact.submitted_at, filters):
            key = _aware(fact.submitted_at).date().replace(day=1).isoformat()
            bucket = buckets.setdefault(key, {"submitted": 0, "funded": 0, "fundedValue": ZERO})
            bucket["submitted"] = int(bucket["submitted"]) + 1
        if fact.funded_at and _visible_event(access, fact.funded, fact.funded_at, filters):
            key = _aware(fact.funded_at).date().replace(day=1).isoformat()
            bucket = buckets.setdefault(key, {"submitted": 0, "funded": 0, "fundedValue": ZERO})
            bucket["funded"] = int(bucket["funded"]) + 1
            bucket["fundedValue"] = Decimal(str(bucket["fundedValue"])) + (
                fact.funded_amount or ZERO
            )
    points = []
    for month in sorted(buckets)[-6:]:
        bucket = buckets[month]
        points.append(
            {
                "month": month,
                "submitted": int(bucket["submitted"]),
                "funded": int(bucket["funded"]),
                "fundedValue": money0(Decimal(str(bucket["fundedValue"]))),
            }
        )
    return points


async def resolve_window(
    access: ReportingAccess,
    *,
    period: str,
    date_from: date | None,
    date_to: date | None,
    employee_id: UUID | None,
    users: dict[UUID, User],
) -> PeriodWindow:
    joining: date | None = None
    if period == "since_joining":
        target_id = employee_id or access.actor.id
        target = users.get(target_id)
        if target is None:
            raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
        joining = target.joining_date
    return resolve_period(period, date_from=date_from, date_to=date_to, joining_date=joining)


async def _profile_targets_kpi(
    session: AsyncSession,
    actor: User,
    employee_id: UUID,
    *,
    window: PeriodWindow,
    facts: list[AppFact],
    access: ReportingAccess,
) -> dict[str, object] | None:
    from nexa_bos_api.targets.service import profile_targets_kpi

    return await profile_targets_kpi(
        session, actor, employee_id, window=window, facts=facts, access=access
    )


async def _dashboard_targets(
    session: AsyncSession,
    actor: User,
    *,
    window: PeriodWindow,
    facts: list[AppFact],
    access: ReportingAccess,
) -> dict[str, object] | None:
    from nexa_bos_api.targets.service import dashboard_targets_summary

    return await dashboard_targets_summary(
        session, actor, window=window, facts=facts, access=access
    )


async def dashboard_payload(
    session: AsyncSession,
    actor: User,
    *,
    period: str,
    date_from: date | None,
    date_to: date | None,
    filters: ReportFilters,
    ranking_metric: str = "funded_value",
) -> dict[str, object]:
    access = await load_reporting_access(session, actor)
    facts, users, offices, teams = await load_facts(session)
    window = await resolve_window(
        access,
        period=period,
        date_from=date_from,
        date_to=date_to,
        employee_id=filters.employee_id,
        users=users,
    )
    period_payload = serialize_period(window)
    if access.scope is None:
        return empty_payload(access, period_payload)
    engine = MetricEngine(facts, access, window, filters)
    kpis = engine.kpis()
    return {
        "reportingScope": access.label,
        "currency": "AED",
        "period": period_payload,
        "empty": False,
        "kpis": kpis,
        "conversions": engine.conversions(),
        "stageBreakdown": engine.stage_breakdown(),
        "activeDelays": engine.delay_breakdown(),
        "rankings": build_rankings(engine, users, offices, teams, ranking_metric),
        "trend": trend_points(facts, access, filters),
        "targetsSummary": await _dashboard_targets(
            session, actor, window=window, facts=facts, access=access
        ),
        "generatedAt": datetime.now(UTC).isoformat(),
    }


async def drilldown_payload(
    session: AsyncSession,
    actor: User,
    *,
    metric: str,
    period: str,
    date_from: date | None,
    date_to: date | None,
    filters: ReportFilters,
) -> dict[str, object]:
    access = await load_reporting_access(session, actor)
    facts, users, _offices, _teams = await load_facts(session)
    window = await resolve_window(
        access,
        period=period,
        date_from=date_from,
        date_to=date_to,
        employee_id=filters.employee_id,
        users=users,
    )
    period_payload = serialize_period(window)
    if access.scope is None:
        empty = empty_payload(access, period_payload)
        empty["metric"] = metric
        return empty
    engine = MetricEngine(facts, access, window, filters)
    items = engine.for_metric(metric)
    return {
        "reportingScope": access.label,
        "currency": "AED",
        "period": period_payload,
        "metric": metric,
        "total": len(items),
        "items": [serialize_application(item) for item in items],
        "generatedAt": datetime.now(UTC).isoformat(),
    }


async def rankings_payload(
    session: AsyncSession,
    actor: User,
    *,
    period: str,
    date_from: date | None,
    date_to: date | None,
    filters: ReportFilters,
    ranking_metric: str,
) -> dict[str, object]:
    access = await load_reporting_access(session, actor)
    facts, users, offices, teams = await load_facts(session)
    window = await resolve_window(
        access,
        period=period,
        date_from=date_from,
        date_to=date_to,
        employee_id=filters.employee_id,
        users=users,
    )
    period_payload = serialize_period(window)
    if access.scope is None:
        empty = empty_payload(access, period_payload)
        empty["rankings"] = {
            "metric": ranking_metric,
            "employees": [],
            "teams": [],
            "offices": [],
            "bankProducts": [],
        }
        return empty
    engine = MetricEngine(facts, access, window, filters)
    return {
        "reportingScope": access.label,
        "currency": "AED",
        "period": period_payload,
        "rankings": build_rankings(engine, users, offices, teams, ranking_metric),
        "generatedAt": datetime.now(UTC).isoformat(),
    }


def _entity_kpis(
    facts: list[AppFact],
    access: ReportingAccess,
    window: PeriodWindow,
    dimension: str,
    entity_id: UUID,
) -> dict[str, object]:
    filters = ReportFilters()
    if dimension == "employee":
        filters.employee_id = entity_id
    elif dimension == "team":
        filters.team_id = entity_id
    elif dimension == "office":
        filters.office_id = entity_id
    elif dimension == "bank":
        filters.bank_id = entity_id
    elif dimension == "product":
        filters.product_id = entity_id
    else:
        raise AppError(
            status_code=422, code="INVALID_DIMENSION", message="Unknown comparison dimension"
        )
    return MetricEngine(facts, access, window, filters).kpis()


def _kpi_number(kpis: dict[str, object], path: str) -> Decimal:
    submitted = kpis["submitted"]
    booked = kpis["booked"]
    funded = kpis["funded"]
    if path == "submitted_value":
        return Decimal(str(submitted["value"]))  # type: ignore[index]
    if path == "booked_value":
        return Decimal(str(booked["value"]))  # type: ignore[index]
    if path == "funded_value":
        return Decimal(str(funded["value"]))  # type: ignore[index]
    if path == "case_count":
        return Decimal(str(kpis["applicationsOwned"]["count"]))  # type: ignore[index]
    return Decimal(str(funded["value"]))  # type: ignore[index]


def compare_pair(
    left: dict[str, object],
    right: dict[str, object],
    metric: str,
) -> dict[str, object]:
    current = _kpi_number(left, metric)
    previous = _kpi_number(right, metric)
    return {
        "metric": metric,
        "current": money0(current) if metric != "case_count" else int(current),
        "previous": money0(previous) if metric != "case_count" else int(previous),
        "absoluteDifference": money0(current - previous)
        if metric != "case_count"
        else int(current - previous),
        "percentageChange": pct_change(current, previous),
        "currentKpis": left,
        "previousKpis": right,
    }


async def comparison_payload(
    session: AsyncSession,
    actor: User,
    *,
    kind: str,
    dimension: str | None,
    left_id: UUID | None,
    right_id: UUID | None,
    period: str,
    date_from: date | None,
    date_to: date | None,
    compare_from: date | None,
    compare_to: date | None,
    metric: str,
    filters: ReportFilters,
) -> dict[str, object]:
    from nexa_bos_api.reporting.periods import comparison_windows

    access = await load_reporting_access(session, actor)
    facts, users, _offices, _teams = await load_facts(session)
    if access.scope is None:
        return {
            "reportingScope": None,
            "empty": True,
            "items": [],
        }
    if kind == "entity":
        if dimension is None or left_id is None or right_id is None:
            raise AppError(
                status_code=422,
                code="INVALID_COMPARISON",
                message="Entity comparison requires a dimension and two entity ids",
            )
        window = await resolve_window(
            access,
            period=period,
            date_from=date_from,
            date_to=date_to,
            employee_id=filters.employee_id,
            users=users,
        )
        left = _entity_kpis(facts, access, window, dimension, left_id)
        right = _entity_kpis(facts, access, window, dimension, right_id)
        result = compare_pair(left, right, metric)
        result.update(
            {
                "kind": "entity",
                "dimension": dimension,
                "leftId": str(left_id),
                "rightId": str(right_id),
                "reportingScope": access.label,
                "period": serialize_period(window),
                "currency": "AED",
            }
        )
        return result
    current_window, previous_window = comparison_windows(
        period,
        date_from=date_from,
        date_to=date_to,
        compare_from=compare_from,
        compare_to=compare_to,
    )
    left = MetricEngine(facts, access, current_window, filters).kpis()
    right = MetricEngine(facts, access, previous_window, filters).kpis()
    result = compare_pair(left, right, metric)
    result.update(
        {
            "kind": "period",
            "reportingScope": access.label,
            "currentPeriod": serialize_period(current_window),
            "previousPeriod": serialize_period(previous_window),
            "currency": "AED",
        }
    )
    return result


async def employee_profile_payload(
    session: AsyncSession,
    actor: User,
    employee_id: UUID,
    *,
    period: str,
    date_from: date | None,
    date_to: date | None,
    ranking_metric: str = "funded_value",
) -> dict[str, object]:
    access = await load_reporting_access(session, actor)
    facts, users, offices, teams = await load_facts(session)
    employee = users.get(employee_id)
    if employee is None:
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    if access.scope is None or not access.owner_visible(
        employee.id, datetime.now(UTC), employee.office_id
    ):
        raise AppError(status_code=404, code="NOT_FOUND", message="Employee was not found")
    window = await resolve_window(
        access,
        period=period,
        date_from=date_from,
        date_to=date_to,
        employee_id=employee_id,
        users=users,
    )
    filters = ReportFilters(employee_id=employee_id)
    engine = MetricEngine(facts, access, window, filters)
    rankings = build_rankings(
        MetricEngine(facts, access, window, ReportFilters()),
        users,
        offices,
        teams,
        ranking_metric,
    )
    rank_row = next((row for row in rankings["employees"] if row["id"] == str(employee_id)), None)
    manager = users.get(employee.reporting_manager_id) if employee.reporting_manager_id else None
    attendance_summary = None
    if has_permission(actor, ATTENDANCE_VIEW) or has_permission(actor, ATTENDANCE_REPORTS):
        attendance_summary = await employee_attendance_summary(
            session,
            actor,
            employee_id,
            date_from=window.date_from,
            date_to=window.date_to,
        )
    return {
        "reportingScope": access.label,
        "currency": "AED",
        "period": serialize_period(window),
        "employee": {
            "id": str(employee.id),
            "employeeCode": employee.employee_code,
            "fullName": employee.full_name,
            "userCode": employee.user_code,
            "designation": employee.designation.name if employee.designation else None,
            "office": employee.office.name if employee.office else None,
            "department": employee.department.name if employee.department else None,
            "team": employee.team.name if employee.team else None,
            "reportingManager": manager.full_name if manager else None,
            "joiningDate": employee.joining_date.isoformat(),
            "employmentStatus": employee.employment_status,
        },
        "kpis": engine.kpis(),
        "conversions": engine.conversions(),
        "stageBreakdown": engine.stage_breakdown(),
        "ranking": rank_row,
        "applications": [serialize_application(item) for item in engine.owned()],
        "attendanceSummary": attendance_summary,
        "targetsKpi": await _profile_targets_kpi(
            session, actor, employee_id, window=window, facts=facts, access=access
        ),
        "generatedAt": datetime.now(UTC).isoformat(),
    }


async def filter_options_payload(session: AsyncSession, actor: User) -> dict[str, object]:
    access = await load_reporting_access(session, actor)
    if access.scope is None:
        return {
            "reportingScope": None,
            "offices": [],
            "departments": [],
            "teams": [],
            "employees": [],
            "banks": [],
            "products": [],
            "stages": [],
        }
    facts, users, offices, teams = await load_facts(session)
    visible_users: set[UUID] = set()
    visible_offices: set[UUID] = set()
    visible_depts: set[UUID] = set()
    visible_teams: set[UUID] = set()
    now = datetime.now(UTC)
    for user in users.values():
        if access.owner_visible(user.id, now, user.office_id):
            visible_users.add(user.id)
            if user.office_id:
                visible_offices.add(user.office_id)
            if user.department_id:
                visible_depts.add(user.department_id)
            if user.team_id:
                visible_teams.add(user.team_id)
    departments = {row.id: row for row in (await session.execute(select(Department))).scalars()}
    banks = {row.id: row for row in (await session.execute(select(Bank))).scalars()}
    products = {row.id: row for row in (await session.execute(select(Product))).scalars()}
    stages = {(fact.current_stage_id, fact.current_stage_name) for fact in facts}
    return {
        "reportingScope": access.label,
        "periods": [
            {"key": "today", "label": "Today"},
            {"key": "mtd", "label": "MTD"},
            {"key": "previous_month", "label": "Previous Month"},
            {"key": "qtd", "label": "QTD"},
            {"key": "previous_quarter", "label": "Previous Quarter"},
            {"key": "half_year", "label": "Half-Year"},
            {"key": "ytd", "label": "YTD"},
            {"key": "since_joining", "label": "Since Joining"},
            {"key": "custom", "label": "Custom"},
        ],
        "offices": [
            {"id": str(row.id), "name": row.name, "code": row.code}
            for row_id, row in offices.items()
            if row_id in visible_offices
        ],
        "departments": [
            {"id": str(row.id), "name": row.name, "code": row.code}
            for row_id, row in departments.items()
            if row_id in visible_depts
        ],
        "teams": [
            {"id": str(row.id), "name": row.name, "code": row.code}
            for row_id, row in teams.items()
            if row_id in visible_teams
        ],
        "employees": [
            {
                "id": str(user.id),
                "name": user.full_name,
                "employeeCode": user.employee_code,
                "userCode": user.user_code,
            }
            for user_id, user in users.items()
            if user_id in visible_users
        ],
        "banks": [
            {"id": str(row.id), "name": row.name, "code": row.code} for row in banks.values()
        ],
        "products": [
            {"id": str(row.id), "name": row.name, "code": row.code} for row in products.values()
        ],
        "stages": [
            {"id": str(stage_id), "name": name}
            for stage_id, name in sorted(stages, key=lambda item: item[1])
        ],
        "terminalOutcomes": ["Completed", "Final Rejected", "Cancelled", "Withdrawn"],
    }
