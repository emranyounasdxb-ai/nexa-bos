from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from nexa_bos_api.attendance.calc import business_today
from nexa_bos_api.attendance.service import (
    employee_attendance_summary,
    load_holiday_dates,
    load_working_weekdays,
)
from nexa_bos_api.catalog.models import Bank, Product
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.core.pagination import PageResult
from nexa_bos_api.identity.access import has_permission
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import VisibilityScope
from nexa_bos_api.identity.models import Office, Team, User
from nexa_bos_api.identity.permissions import ATTENDANCE_REPORTS, ATTENDANCE_VIEW, TARGETS_VIEW
from nexa_bos_api.reporting.periods import (
    PeriodWindow,
    half_year_start,
    quarter_start,
    resolve_period,
)
from nexa_bos_api.reporting.periods import month_end as reporting_month_end
from nexa_bos_api.reporting.scope import ReportingAccess, load_reporting_access
from nexa_bos_api.reporting.service import (
    AppFact,
    MetricEngine,
    ReportFilters,
    load_facts,
)
from nexa_bos_api.targets.calc import (
    HUNDRED,
    ZERO,
    achievement_pct,
    daily_run_rate,
    default_measurement,
    directed_achievement,
    money,
    month_start,
    prorate_target,
    quantize,
    weighted_contribution,
    working_dates,
)
from nexa_bos_api.targets.enums import (
    BLOCKED_EMPLOYMENT,
    CURRENCY,
    KPI_METRIC_CATALOG,
    KPI_METRIC_CODES,
    KPI_STATUS_ACTIVE,
    KPI_STATUS_DRAFT,
    KPI_STATUS_INACTIVE,
    MEASUREMENT_AMOUNT,
    MEASUREMENT_COUNT,
    MILESTONE_AMOUNT_FIELD,
    MILESTONE_ATTR,
    PERIOD_HALF_YEAR,
    PERIOD_MONTH,
    PERIOD_QTD,
    PERIOD_YTD,
    STATUS_ACTIVE,
    STATUS_INACTIVE,
    TARGET_LEVEL_EMPLOYEE,
    TARGET_LEVEL_OFFICE,
    TARGET_LEVEL_TEAM,
    TARGET_PERIODS,
)
from nexa_bos_api.targets.models import (
    KpiScorecard,
    KpiScorecardMetric,
    PerformanceTarget,
    TargetChange,
    TargetPeriodLock,
    TargetPeriodReopen,
    new_uuid,
)
from nexa_bos_api.targets.schemas import (
    KpiMetricInput,
    KpiScorecardCreateRequest,
    KpiScorecardUpdateRequest,
    TargetCreateRequest,
    TargetUpdateRequest,
)

CONVERSION_KEYS = {
    "submitted_to_approved": "submittedToApproved",
    "approved_to_booked": "approvedToBooked",
    "booked_to_funded": "bookedToFunded",
    "submitted_to_final_rejected": "submittedToFinalRejected",
    "submitted_to_cancelled_withdrawn": "submittedToCancelledWithdrawn",
}

MILESTONE_KPI = {
    "submitted_count": ("submitted", MEASUREMENT_COUNT),
    "submitted_value": ("submitted", MEASUREMENT_AMOUNT),
    "approved_count": ("approved", MEASUREMENT_COUNT),
    "approved_value": ("approved", MEASUREMENT_AMOUNT),
    "booked_count": ("booked", MEASUREMENT_COUNT),
    "booked_value": ("booked", MEASUREMENT_AMOUNT),
    "funded_count": ("funded", MEASUREMENT_COUNT),
    "funded_value": ("funded", MEASUREMENT_AMOUNT),
}


def utcnow() -> datetime:
    return datetime.now(UTC)


def _as_month(value: date) -> date:
    return month_start(value)


async def _locked_months(session: AsyncSession) -> set[date]:
    rows = (await session.execute(select(TargetPeriodLock.period_month))).all()
    return {row[0] for row in rows}


def _require_unlocked(month: date, locked: set[date]) -> None:
    if month in locked:
        raise AppError(
            status_code=409,
            code="TARGET_PERIOD_LOCKED",
            message="This target period is locked and cannot be edited",
        )


def _period_bounds(period: str, month: date, today: date) -> tuple[date, date]:
    key = (period or PERIOD_MONTH).strip().lower()
    if key not in TARGET_PERIODS:
        raise AppError(status_code=422, code="INVALID_PERIOD", message="Unknown target period")
    anchor_end = reporting_month_end(month.year, month.month)
    if month.year == today.year and month.month == today.month:
        anchor_end = min(anchor_end, today)
    if key == PERIOD_MONTH:
        return month, anchor_end
    if key == PERIOD_QTD:
        return quarter_start(month), anchor_end
    if key == PERIOD_HALF_YEAR:
        return half_year_start(month), anchor_end
    if key == PERIOD_YTD:
        return date(month.year, 1, 1), anchor_end
    return date(month.year, 1, 1), anchor_end


def _entity_visible(
    access: ReportingAccess,
    *,
    level: str,
    entity_id: UUID,
    users: dict[UUID, User],
    teams: dict[UUID, Team],
    offices: dict[UUID, Office],
) -> bool:
    if access.scope is None:
        return False
    at = utcnow()
    if level == TARGET_LEVEL_EMPLOYEE:
        user = users.get(entity_id)
        if user is None:
            return False
        return access.owner_visible(user.id, at, user.office_id)
    if level == TARGET_LEVEL_TEAM:
        team = teams.get(entity_id)
        if team is None:
            return False
        if access.scope is VisibilityScope.COMPANY:
            return True
        if access.scope is VisibilityScope.OFFICE:
            return team.office_id == access.actor.office_id
        if access.scope is VisibilityScope.OWN:
            return access.actor.team_id == team.id
        if access.actor.team_id == team.id:
            return True
        if access.actor.id == team.team_leader_id:
            return True
        return any(users[uid].team_id == team.id for uid in access.descendant_ids if uid in users)
    office = offices.get(entity_id)
    if office is None:
        return False
    if access.scope is VisibilityScope.COMPANY:
        return True
    return access.actor.office_id == office.id


def _filters_for_target(target: PerformanceTarget) -> ReportFilters:
    filters = ReportFilters(
        product_id=target.product_id,
        bank_id=target.bank_id,
    )
    if target.level == TARGET_LEVEL_EMPLOYEE:
        filters.employee_id = target.entity_id
    elif target.level == TARGET_LEVEL_TEAM:
        filters.team_id = target.entity_id
    else:
        filters.office_id = target.entity_id
    return filters


def _amount_for(fact: AppFact, milestone: str) -> Decimal | None:
    field = MILESTONE_AMOUNT_FIELD[milestone]
    value = getattr(fact, field)
    return value if value is not None else None


def _actual_from_facts(facts: list[AppFact], measurement: str, milestone: str) -> Decimal:
    if measurement == MEASUREMENT_COUNT:
        return Decimal(len(facts))
    total = ZERO
    for fact in facts:
        amount = _amount_for(fact, milestone)
        if amount is not None:
            total += amount
    return quantize(total)


async def _calendar_context(
    session: AsyncSession,
) -> tuple[set[int], set[date]]:
    weekdays = await load_working_weekdays(session)
    holidays = set((await load_holiday_dates(session)).keys())
    return weekdays, holidays


def _month_working(
    month: date, weekdays: set[int], holidays: set[date], through: date | None = None
) -> list[date]:
    start = month
    end = reporting_month_end(month.year, month.month)
    if through is not None:
        end = min(end, through)
    return working_dates(start, end, weekdays, holidays)


def _effective_target(
    configured: Decimal,
    *,
    prorate: bool,
    month: date,
    today: date,
    weekdays: set[int],
    holidays: set[date],
    window_start: date,
    window_end: date,
) -> Decimal:
    month_end_date = reporting_month_end(month.year, month.month)
    overlap_start = max(month, window_start)
    overlap_end = min(month_end_date, window_end)
    if overlap_start > overlap_end:
        return ZERO
    full_days = _month_working(month, weekdays, holidays)
    elapsed = working_dates(overlap_start, overlap_end, weekdays, holidays)
    apply = prorate and month.year == today.year and month.month == today.month
    if not apply:
        if month > month_start(today):
            return ZERO
        return quantize(configured)
    return prorate_target(
        configured,
        prorate=True,
        elapsed_working_days=len(elapsed),
        month_working_days=len(full_days),
    )


def _run_rate(
    *,
    effective: Decimal,
    actual: Decimal,
    month: date,
    today: date,
    weekdays: set[int],
    holidays: set[date],
) -> tuple[Decimal | None, int]:
    month_end_date = reporting_month_end(month.year, month.month)
    remaining_target = quantize(effective - actual)
    if today > month_end_date:
        remaining_days = working_dates(today, today, weekdays, holidays)
        return daily_run_rate(remaining_target, 0), 0
    remaining_days = working_dates(today, month_end_date, weekdays, holidays)
    return daily_run_rate(remaining_target, len(remaining_days)), len(remaining_days)


def _serialize_result(
    *,
    configured: Decimal,
    effective: Decimal,
    actual: Decimal,
    measurement: str,
    remaining_days: int,
    run_rate: Decimal | None,
    period: str,
    date_from: date,
    date_to: date,
    prorate: bool,
) -> dict[str, object]:
    remaining = quantize(effective - actual)
    return {
        "currency": CURRENCY,
        "measurement": measurement,
        "period": period,
        "from": date_from.isoformat(),
        "to": date_to.isoformat(),
        "target": money(configured),
        "effectiveTarget": money(effective),
        "actual": money(actual),
        "achievementPct": achievement_pct(actual, effective),
        "gap": money(remaining),
        "exceeded": remaining < 0,
        "prorate": prorate,
        "remainingWorkingDays": remaining_days,
        "dailyRequiredRunRate": money(run_rate) if run_rate is not None else None,
    }


async def _compute_result(
    session: AsyncSession,
    actor: User,
    target: PerformanceTarget,
    *,
    period: str,
    facts: list[AppFact] | None = None,
    access: ReportingAccess | None = None,
    weekdays: set[int] | None = None,
    holidays: set[date] | None = None,
    siblings: list[PerformanceTarget] | None = None,
) -> dict[str, object]:
    today = business_today()
    month = target.period_month
    start, end = _period_bounds(period, month, today)
    if facts is None:
        facts, *_rest = await load_facts(session)
    if access is None:
        access = await load_reporting_access(session, actor)
    if weekdays is None or holidays is None:
        weekdays, holidays = await _calendar_context(session)
    window = resolve_period("custom", date_from=start, date_to=end)
    if period != PERIOD_MONTH or siblings is None:
        bank_clause = (
            PerformanceTarget.bank_id.is_(None)
            if target.bank_id is None
            else PerformanceTarget.bank_id == target.bank_id
        )
        rows = list(
            (
                await session.execute(
                    select(PerformanceTarget).where(
                        PerformanceTarget.level == target.level,
                        PerformanceTarget.entity_id == target.entity_id,
                        PerformanceTarget.product_id == target.product_id,
                        PerformanceTarget.milestone == target.milestone,
                        PerformanceTarget.status == STATUS_ACTIVE,
                        bank_clause,
                    )
                )
            ).scalars()
        )
    else:
        rows = siblings
    applicable = [
        row
        for row in rows
        if row.level == target.level
        and row.entity_id == target.entity_id
        and row.product_id == target.product_id
        and row.milestone == target.milestone
        and row.bank_id == target.bank_id
        and row.status == STATUS_ACTIVE
        and start <= reporting_month_end(row.period_month.year, row.period_month.month)
        and row.period_month <= end
    ]
    if period == PERIOD_MONTH:
        applicable = [row for row in applicable if row.period_month == month] or [target]
    configured = sum((quantize(row.target_value) for row in applicable), start=ZERO)
    effective = ZERO
    for row in applicable:
        effective += _effective_target(
            quantize(row.target_value),
            prorate=row.prorate,
            month=row.period_month,
            today=today,
            weekdays=weekdays or set(),
            holidays=holidays or set(),
            window_start=start,
            window_end=end,
        )
    engine = MetricEngine(facts, access, window, _filters_for_target(target))
    attr_name, when_name = MILESTONE_ATTR[target.milestone]
    matches = engine.milestone(attr_name, when_name)
    actual = _actual_from_facts(matches, target.measurement, target.milestone)
    run_rate, remaining_days = _run_rate(
        effective=effective,
        actual=actual,
        month=month if period == PERIOD_MONTH else month_start(today),
        today=today,
        weekdays=weekdays or set(),
        holidays=holidays or set(),
    )
    if period != PERIOD_MONTH:
        last = month_start(end)
        run_rate, remaining_days = _run_rate(
            effective=effective,
            actual=actual,
            month=last,
            today=today,
            weekdays=weekdays or set(),
            holidays=holidays or set(),
        )
    return _serialize_result(
        configured=quantize(configured),
        effective=effective,
        actual=actual,
        measurement=target.measurement,
        remaining_days=remaining_days,
        run_rate=run_rate,
        period=period,
        date_from=start,
        date_to=end,
        prorate=target.prorate,
    )


async def _load_catalog(
    session: AsyncSession,
) -> tuple[
    dict[UUID, User], dict[UUID, Team], dict[UUID, Office], dict[UUID, Product], dict[UUID, Bank]
]:
    users = {row.id: row for row in (await session.execute(select(User))).scalars()}
    teams = {row.id: row for row in (await session.execute(select(Team))).scalars()}
    offices = {row.id: row for row in (await session.execute(select(Office))).scalars()}
    products = {row.id: row for row in (await session.execute(select(Product))).scalars()}
    banks = {row.id: row for row in (await session.execute(select(Bank))).scalars()}
    return users, teams, offices, products, banks


def _entity_name(
    level: str,
    entity_id: UUID,
    users: dict[UUID, User],
    teams: dict[UUID, Team],
    offices: dict[UUID, Office],
) -> str | None:
    if level == TARGET_LEVEL_EMPLOYEE:
        user = users.get(entity_id)
        return user.full_name if user else None
    if level == TARGET_LEVEL_TEAM:
        team = teams.get(entity_id)
        return team.name if team else None
    office = offices.get(entity_id)
    return office.name if office else None


def _serialize_change(row: TargetChange) -> dict[str, object]:
    return {
        "id": str(row.id),
        "reason": row.reason,
        "oldValues": row.old_values,
        "newValues": row.new_values,
        "actorId": str(row.actor_id),
        "createdAt": row.created_at.isoformat(),
    }


def serialize_target(
    target: PerformanceTarget,
    *,
    users: dict[UUID, User],
    teams: dict[UUID, Team],
    offices: dict[UUID, Office],
    products: dict[UUID, Product],
    banks: dict[UUID, Bank],
    locked: set[date],
    result: dict[str, object] | None = None,
    include_history: bool = False,
) -> dict[str, object]:
    product = products.get(target.product_id)
    bank = banks.get(target.bank_id) if target.bank_id else None
    payload: dict[str, object] = {
        "id": str(target.id),
        "level": target.level,
        "entityId": str(target.entity_id),
        "entityName": _entity_name(target.level, target.entity_id, users, teams, offices),
        "periodMonth": target.period_month.isoformat(),
        "productId": str(target.product_id),
        "productCode": product.code if product else None,
        "productName": product.name if product else None,
        "bankId": str(target.bank_id) if target.bank_id else None,
        "bankCode": bank.code if bank else None,
        "bankName": bank.name if bank else None,
        "milestone": target.milestone,
        "measurement": target.measurement,
        "targetValue": money(target.target_value),
        "prorate": target.prorate,
        "status": target.status,
        "locked": target.period_month in locked,
        "currency": CURRENCY,
        "createdAt": target.created_at.isoformat(),
        "updatedAt": target.updated_at.isoformat(),
        "result": result,
    }
    if include_history:
        payload["history"] = [_serialize_change(row) for row in target.changes]
    return payload


async def _get_target(session: AsyncSession, target_id: UUID) -> PerformanceTarget:
    row = (
        await session.execute(
            select(PerformanceTarget)
            .options(selectinload(PerformanceTarget.changes))
            .where(PerformanceTarget.id == target_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError(status_code=404, code="TARGET_NOT_FOUND", message="Target was not found")
    return row


async def _assert_visible(
    session: AsyncSession,
    actor: User,
    target: PerformanceTarget,
    *,
    access: ReportingAccess | None = None,
    users: dict[UUID, User] | None = None,
    teams: dict[UUID, Team] | None = None,
    offices: dict[UUID, Office] | None = None,
) -> tuple[ReportingAccess, dict[UUID, User], dict[UUID, Team], dict[UUID, Office]]:
    if access is None:
        access = await load_reporting_access(session, actor)
    if users is None or teams is None or offices is None:
        users, teams, offices, _products, _banks = await _load_catalog(session)
    if not _entity_visible(
        access,
        level=target.level,
        entity_id=target.entity_id,
        users=users,
        teams=teams,
        offices=offices,
    ):
        raise AppError(status_code=404, code="TARGET_NOT_FOUND", message="Target was not found")
    return access, users, teams, offices


async def _ensure_unique(
    session: AsyncSession,
    *,
    level: str,
    entity_id: UUID,
    period_month: date,
    product_id: UUID,
    milestone: str,
    bank_id: UUID | None,
    exclude_id: UUID | None = None,
) -> None:
    stmt = select(PerformanceTarget).where(
        PerformanceTarget.level == level,
        PerformanceTarget.entity_id == entity_id,
        PerformanceTarget.period_month == period_month,
        PerformanceTarget.product_id == product_id,
        PerformanceTarget.milestone == milestone,
        PerformanceTarget.status == STATUS_ACTIVE,
    )
    if bank_id is None:
        stmt = stmt.where(PerformanceTarget.bank_id.is_(None))
    else:
        stmt = stmt.where(PerformanceTarget.bank_id == bank_id)
    if exclude_id is not None:
        stmt = stmt.where(PerformanceTarget.id != exclude_id)
    existing = (await session.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        raise AppError(
            status_code=409,
            code="TARGET_DUPLICATE",
            message="An active target already exists for this combination",
        )


async def create_target(
    session: AsyncSession, actor: User, payload: TargetCreateRequest
) -> dict[str, object]:
    access = await load_reporting_access(session, actor)
    users, teams, offices, products, banks = await _load_catalog(session)
    month = _as_month(payload.period_month)
    locked = await _locked_months(session)
    _require_unlocked(month, locked)
    if not _entity_visible(
        access,
        level=payload.level.value,
        entity_id=payload.entity_id,
        users=users,
        teams=teams,
        offices=offices,
    ):
        raise AppError(
            status_code=403,
            code="TARGET_SCOPE_DENIED",
            message="Target entity is outside authorized reporting scope",
        )
    product = products.get(payload.product_id)
    if product is None:
        raise AppError(status_code=404, code="PRODUCT_NOT_FOUND", message="Product was not found")
    if payload.bank_id is not None and payload.bank_id not in banks:
        raise AppError(status_code=404, code="BANK_NOT_FOUND", message="Bank was not found")
    if payload.level.value == TARGET_LEVEL_EMPLOYEE:
        employee = users.get(payload.entity_id)
        if employee is None:
            raise AppError(
                status_code=404, code="EMPLOYEE_NOT_FOUND", message="Employee was not found"
            )
        if employee.employment_status in BLOCKED_EMPLOYMENT:
            raise AppError(
                status_code=422,
                code="EMPLOYMENT_STATUS_BLOCKED",
                message=(
                    "New targets cannot be created for inactive, resigned, or terminated employees"
                ),
            )
    elif payload.level.value == TARGET_LEVEL_TEAM and payload.entity_id not in teams:
        raise AppError(status_code=404, code="TEAM_NOT_FOUND", message="Team was not found")
    elif payload.level.value == TARGET_LEVEL_OFFICE and payload.entity_id not in offices:
        raise AppError(status_code=404, code="OFFICE_NOT_FOUND", message="Office was not found")
    measurement = payload.measurement.value if payload.measurement else default_measurement(product)
    await _ensure_unique(
        session,
        level=payload.level.value,
        entity_id=payload.entity_id,
        period_month=month,
        product_id=payload.product_id,
        milestone=payload.milestone.value,
        bank_id=payload.bank_id,
    )
    now = utcnow()
    target = PerformanceTarget(
        id=new_uuid(),
        level=payload.level.value,
        entity_id=payload.entity_id,
        period_month=month,
        product_id=payload.product_id,
        bank_id=payload.bank_id,
        milestone=payload.milestone.value,
        measurement=measurement,
        target_value=quantize(payload.target_value),
        prorate=payload.prorate,
        status=STATUS_ACTIVE,
        created_at=now,
        updated_at=now,
        created_by_id=actor.id,
        updated_by_id=actor.id,
    )
    session.add(target)
    await record_audit(
        session,
        action="target.create",
        entity_type="performance_target",
        entity_id=str(target.id),
        actor_id=actor.id,
        new_values={
            "level": target.level,
            "entityId": str(target.entity_id),
            "periodMonth": month.isoformat(),
            "productId": str(target.product_id),
            "bankId": str(target.bank_id) if target.bank_id else None,
            "milestone": target.milestone,
            "measurement": target.measurement,
            "targetValue": money(target.target_value),
            "prorate": target.prorate,
        },
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="TARGET_DUPLICATE",
            message="An active target already exists for this combination",
        ) from exc
    return await get_target(session, actor, target.id)


async def list_targets(
    session: AsyncSession,
    actor: User,
    *,
    level: str | None = None,
    entity_id: UUID | None = None,
    period_month: date | None = None,
    product_id: UUID | None = None,
    bank_id: UUID | None = None,
    milestone: str | None = None,
    status: str | None = None,
    period: str = PERIOD_MONTH,
    page: int,
    page_size: int,
) -> dict[str, object]:
    access = await load_reporting_access(session, actor)
    users, teams, offices, products, banks = await _load_catalog(session)
    locked = await _locked_months(session)
    stmt = select(PerformanceTarget).options(selectinload(PerformanceTarget.changes))
    if level:
        stmt = stmt.where(PerformanceTarget.level == level)
    if entity_id:
        stmt = stmt.where(PerformanceTarget.entity_id == entity_id)
    if period_month:
        stmt = stmt.where(PerformanceTarget.period_month == _as_month(period_month))
    if product_id:
        stmt = stmt.where(PerformanceTarget.product_id == product_id)
    if bank_id:
        stmt = stmt.where(PerformanceTarget.bank_id == bank_id)
    if milestone:
        stmt = stmt.where(PerformanceTarget.milestone == milestone)
    if status:
        stmt = stmt.where(PerformanceTarget.status == status)
    visible_employees = [
        entity_id
        for entity_id in users
        if _entity_visible(
            access,
            level=TARGET_LEVEL_EMPLOYEE,
            entity_id=entity_id,
            users=users,
            teams=teams,
            offices=offices,
        )
    ]
    visible_teams = [
        entity_id
        for entity_id in teams
        if _entity_visible(
            access,
            level=TARGET_LEVEL_TEAM,
            entity_id=entity_id,
            users=users,
            teams=teams,
            offices=offices,
        )
    ]
    visible_offices = [
        entity_id
        for entity_id in offices
        if _entity_visible(
            access,
            level=TARGET_LEVEL_OFFICE,
            entity_id=entity_id,
            users=users,
            teams=teams,
            offices=offices,
        )
    ]
    stmt = stmt.where(
        or_(
            and_(
                PerformanceTarget.level == TARGET_LEVEL_EMPLOYEE,
                PerformanceTarget.entity_id.in_(visible_employees),
            ),
            and_(
                PerformanceTarget.level == TARGET_LEVEL_TEAM,
                PerformanceTarget.entity_id.in_(visible_teams),
            ),
            and_(
                PerformanceTarget.level == TARGET_LEVEL_OFFICE,
                PerformanceTarget.entity_id.in_(visible_offices),
            ),
        )
    )
    count_stmt = select(func.count()).select_from(
        stmt.with_only_columns(PerformanceTarget.id).order_by(None).subquery()
    )
    total = int((await session.scalar(count_stmt)) or 0)
    visible = list(
        (
            await session.execute(
                stmt.order_by(PerformanceTarget.period_month.desc(), PerformanceTarget.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).scalars()
    )
    facts, *_rest = await load_facts(session)
    weekdays, holidays = await _calendar_context(session)
    items = []
    for row in visible:
        result = await _compute_result(
            session,
            actor,
            row,
            period=period,
            facts=facts,
            access=access,
            weekdays=weekdays,
            holidays=holidays,
            siblings=visible,
        )
        items.append(
            serialize_target(
                row,
                users=users,
                teams=teams,
                offices=offices,
                products=products,
                banks=banks,
                locked=locked,
                result=result,
            )
        )
    return {
        "items": items,
        "currency": CURRENCY,
        "lockedMonths": sorted(m.isoformat() for m in locked),
        "pagination": PageResult(items=[], page=page, page_size=page_size, total=total).metadata(),
    }


async def get_target(
    session: AsyncSession, actor: User, target_id: UUID, *, period: str = PERIOD_MONTH
) -> dict[str, object]:
    target = await _get_target(session, target_id)
    access, users, teams, offices = await _assert_visible(session, actor, target)
    _users, _teams, _offices, products, banks = await _load_catalog(session)
    locked = await _locked_months(session)
    siblings = list(
        (
            await session.execute(
                select(PerformanceTarget).where(
                    PerformanceTarget.level == target.level,
                    PerformanceTarget.entity_id == target.entity_id,
                    PerformanceTarget.product_id == target.product_id,
                    PerformanceTarget.milestone == target.milestone,
                    PerformanceTarget.status == STATUS_ACTIVE,
                    PerformanceTarget.bank_id.is_(None)
                    if target.bank_id is None
                    else PerformanceTarget.bank_id == target.bank_id,
                )
            )
        ).scalars()
    )
    result = await _compute_result(
        session, actor, target, period=period, access=access, siblings=siblings
    )
    return serialize_target(
        target,
        users=users,
        teams=teams,
        offices=offices,
        products=products,
        banks=banks,
        locked=locked,
        result=result,
        include_history=True,
    )


def _snapshot(target: PerformanceTarget) -> dict[str, object]:
    return {
        "targetValue": money(target.target_value),
        "prorate": target.prorate,
        "measurement": target.measurement,
        "status": target.status,
    }


async def update_target(
    session: AsyncSession, actor: User, target_id: UUID, payload: TargetUpdateRequest
) -> dict[str, object]:
    reason = payload.reason.strip()
    if not reason:
        raise AppError(
            status_code=422,
            code="REASON_REQUIRED",
            message="A reason is required to edit a target",
        )
    target = await _get_target(session, target_id)
    await _assert_visible(session, actor, target)
    locked = await _locked_months(session)
    _require_unlocked(target.period_month, locked)
    old = _snapshot(target)
    if payload.target_value is not None:
        target.target_value = quantize(payload.target_value)
    if payload.prorate is not None:
        target.prorate = payload.prorate
    if payload.measurement is not None:
        target.measurement = payload.measurement.value
    new = _snapshot(target)
    if old == new:
        raise AppError(status_code=422, code="NO_CHANGES", message="No target values were changed")
    now = utcnow()
    target.updated_at = now
    target.updated_by_id = actor.id
    session.add(
        TargetChange(
            id=new_uuid(),
            target_id=target.id,
            actor_id=actor.id,
            reason=reason,
            old_values=old,
            new_values=new,
            created_at=now,
        )
    )
    await record_audit(
        session,
        action="target.edit",
        entity_type="performance_target",
        entity_id=str(target.id),
        actor_id=actor.id,
        old_values=old,
        new_values=new,
        note=reason,
    )
    await session.commit()
    session.expire(target, ["changes"])
    return await get_target(session, actor, target.id)


async def set_target_status(
    session: AsyncSession, actor: User, target_id: UUID, *, active: bool
) -> dict[str, object]:
    target = await _get_target(session, target_id)
    await _assert_visible(session, actor, target)
    locked = await _locked_months(session)
    _require_unlocked(target.period_month, locked)
    new_status = STATUS_ACTIVE if active else STATUS_INACTIVE
    if target.status == new_status:
        return await get_target(session, actor, target.id)
    if active:
        await _ensure_unique(
            session,
            level=target.level,
            entity_id=target.entity_id,
            period_month=target.period_month,
            product_id=target.product_id,
            milestone=target.milestone,
            bank_id=target.bank_id,
            exclude_id=target.id,
        )
    old = {"status": target.status}
    target.status = new_status
    target.updated_at = utcnow()
    target.updated_by_id = actor.id
    await record_audit(
        session,
        action="target.activate" if active else "target.deactivate",
        entity_type="performance_target",
        entity_id=str(target.id),
        actor_id=actor.id,
        old_values=old,
        new_values={"status": target.status},
    )
    from nexa_bos_api.notifications.enums import NotificationEventType
    from nexa_bos_api.notifications.service import dispatch_source_event

    await dispatch_source_event(
        session,
        event_type=NotificationEventType.TARGET_STATUS_CHANGED,
        source_event_key=(f"{target.id}:{target.status}:{target.updated_at.isoformat()}"),
        affected_user_id=target.entity_id if target.level == TARGET_LEVEL_EMPLOYEE else None,
        linked_entity_type="performance_target",
        linked_entity_id=str(target.id),
        contextual_link="/targets",
        actor_id=actor.id,
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="TARGET_DUPLICATE",
            message="An active target already exists for this combination",
        ) from exc
    return await get_target(session, actor, target.id)


async def lock_period(session: AsyncSession, actor: User, month: date) -> dict[str, object]:
    period = _as_month(month)
    existing = await session.get(TargetPeriodLock, period)
    if existing is not None:
        return {"periodMonth": period.isoformat(), "locked": True}
    session.add(TargetPeriodLock(period_month=period, locked_at=utcnow(), locked_by_id=actor.id))
    await record_audit(
        session,
        action="target.period_lock",
        entity_type="target_period",
        entity_id=period.isoformat(),
        actor_id=actor.id,
        new_values={"locked": True, "periodMonth": period.isoformat()},
    )
    await session.commit()
    return {"periodMonth": period.isoformat(), "locked": True}


async def reopen_period(
    session: AsyncSession, actor: User, month: date, reason: str
) -> dict[str, object]:
    note = reason.strip()
    if not note:
        raise AppError(
            status_code=422,
            code="REASON_REQUIRED",
            message="A reason is required to reopen a locked target period",
        )
    period = _as_month(month)
    existing = await session.get(TargetPeriodLock, period)
    if existing is None:
        raise AppError(
            status_code=409,
            code="TARGET_PERIOD_NOT_LOCKED",
            message="This target period is not locked",
        )
    await session.delete(existing)
    session.add(
        TargetPeriodReopen(
            id=new_uuid(),
            period_month=period,
            reason=note,
            actor_id=actor.id,
            created_at=utcnow(),
        )
    )
    await record_audit(
        session,
        action="target.period_reopen",
        entity_type="target_period",
        entity_id=period.isoformat(),
        actor_id=actor.id,
        new_values={"locked": False, "periodMonth": period.isoformat()},
        note=note,
    )
    await session.commit()
    return {"periodMonth": period.isoformat(), "locked": False, "reason": note}


async def list_periods(session: AsyncSession) -> dict[str, object]:
    locked = await _locked_months(session)
    reopens = list(
        (
            await session.execute(
                select(TargetPeriodReopen).order_by(TargetPeriodReopen.created_at.desc())
            )
        ).scalars()
    )
    return {
        "lockedMonths": sorted(item.isoformat() for item in locked),
        "reopens": [
            {
                "id": str(row.id),
                "periodMonth": row.period_month.isoformat(),
                "reason": row.reason,
                "actorId": str(row.actor_id),
                "createdAt": row.created_at.isoformat(),
            }
            for row in reopens
        ],
    }


async def filter_options(session: AsyncSession, actor: User) -> dict[str, object]:
    access = await load_reporting_access(session, actor)
    users, teams, offices, products, banks = await _load_catalog(session)
    employees = [
        {
            "id": str(user.id),
            "fullName": user.full_name,
            "employeeCode": user.employee_code,
            "employmentStatus": user.employment_status,
            "officeId": str(user.office_id) if user.office_id else None,
            "teamId": str(user.team_id) if user.team_id else None,
        }
        for user in users.values()
        if _entity_visible(
            access,
            level=TARGET_LEVEL_EMPLOYEE,
            entity_id=user.id,
            users=users,
            teams=teams,
            offices=offices,
        )
    ]
    team_items = [
        {
            "id": str(team.id),
            "name": team.name,
            "code": team.code,
            "officeId": str(team.office_id),
        }
        for team in teams.values()
        if _entity_visible(
            access,
            level=TARGET_LEVEL_TEAM,
            entity_id=team.id,
            users=users,
            teams=teams,
            offices=offices,
        )
    ]
    office_items = [
        {"id": str(office.id), "name": office.name, "code": office.code}
        for office in offices.values()
        if _entity_visible(
            access,
            level=TARGET_LEVEL_OFFICE,
            entity_id=office.id,
            users=users,
            teams=teams,
            offices=offices,
        )
    ]
    return {
        "currency": CURRENCY,
        "levels": list((TARGET_LEVEL_EMPLOYEE, TARGET_LEVEL_TEAM, TARGET_LEVEL_OFFICE)),
        "milestones": list(MILESTONE_ATTR.keys()),
        "measurements": [MEASUREMENT_COUNT, MEASUREMENT_AMOUNT],
        "periods": list(TARGET_PERIODS),
        "employees": employees,
        "teams": team_items,
        "offices": office_items,
        "products": [
            {
                "id": str(product.id),
                "code": product.code,
                "name": product.name,
                "requestedAmountRequired": product.requested_amount_required,
                "defaultMeasurement": default_measurement(product),
            }
            for product in products.values()
        ],
        "banks": [
            {"id": str(bank.id), "code": bank.code, "name": bank.name} for bank in banks.values()
        ],
        "kpiMetrics": kpi_metric_catalog(),
        "lockedMonths": sorted(item.isoformat() for item in await _locked_months(session)),
    }


def kpi_metric_catalog() -> list[dict[str, str]]:
    return [
        {"code": code, "label": label, "defaultDirection": direction}
        for code, label, direction in KPI_METRIC_CATALOG
    ]


def _weight_total(metrics: list[KpiScorecardMetric] | list[KpiMetricInput]) -> Decimal:
    total = ZERO
    for item in metrics:
        weight = item.weight_percent if hasattr(item, "weight_percent") else item.weight_percent
        total += quantize(weight)
    return quantize(total)


def _metric_requires_baseline(code: str) -> bool:
    return code not in MILESTONE_KPI


def _assert_active_invariant(metrics: list[KpiScorecardMetric] | list[KpiMetricInput]) -> None:
    if _weight_total(metrics) != HUNDRED:
        raise AppError(
            status_code=422,
            code="KPI_WEIGHT_INVALID",
            message="An active KPI scorecard must have weights totaling exactly 100%",
        )
    missing = [
        item.metric_code
        for item in metrics
        if _metric_requires_baseline(item.metric_code)
        and (
            item.baseline is None
            if hasattr(item, "baseline")
            else getattr(item, "baseline", None) is None
        )
    ]
    if missing:
        raise AppError(
            status_code=422,
            code="KPI_BASELINE_REQUIRED",
            message="Each comparison KPI metric requires a configured baseline/target",
            details=missing,
        )


def _validate_metrics(items: list[KpiMetricInput]) -> None:
    seen: set[str] = set()
    for item in items:
        if item.metric_code not in KPI_METRIC_CODES:
            raise AppError(
                status_code=422,
                code="KPI_METRIC_UNKNOWN",
                message=f"Unknown KPI metric: {item.metric_code}",
            )
        if item.metric_code in seen:
            raise AppError(
                status_code=422,
                code="KPI_METRIC_DUPLICATE",
                message="A scorecard cannot contain the same metric twice",
            )
        seen.add(item.metric_code)


def serialize_scorecard(card: KpiScorecard) -> dict[str, object]:
    metrics = [
        {
            "id": str(row.id),
            "metricCode": row.metric_code,
            "weightPercent": money(row.weight_percent),
            "direction": row.direction,
            "baseline": money(row.baseline) if row.baseline is not None else None,
            "sortOrder": row.sort_order,
        }
        for row in sorted(card.metrics, key=lambda item: item.sort_order)
    ]
    total = _weight_total(card.metrics)
    return {
        "id": str(card.id),
        "name": card.name,
        "status": card.status,
        "weightTotal": money(total),
        "weightValid": total == HUNDRED,
        "metrics": metrics,
        "createdAt": card.created_at.isoformat(),
        "updatedAt": card.updated_at.isoformat(),
    }


async def _load_scorecard(session: AsyncSession, scorecard_id: UUID) -> KpiScorecard:
    row = (
        await session.execute(
            select(KpiScorecard)
            .options(selectinload(KpiScorecard.metrics))
            .where(KpiScorecard.id == scorecard_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError(
            status_code=404, code="KPI_SCORECARD_NOT_FOUND", message="KPI scorecard was not found"
        )
    return row


async def get_scorecard(session: AsyncSession, scorecard_id: UUID) -> dict[str, object]:
    return serialize_scorecard(await _load_scorecard(session, scorecard_id))


async def list_scorecards(session: AsyncSession) -> dict[str, object]:
    rows = list(
        (
            await session.execute(
                select(KpiScorecard)
                .options(selectinload(KpiScorecard.metrics))
                .order_by(KpiScorecard.created_at.desc())
            )
        ).scalars()
    )
    return {"items": [serialize_scorecard(row) for row in rows], "metrics": kpi_metric_catalog()}


async def create_scorecard(
    session: AsyncSession, actor: User, payload: KpiScorecardCreateRequest
) -> dict[str, object]:
    _validate_metrics(payload.metrics)
    now = utcnow()
    card = KpiScorecard(
        id=new_uuid(),
        name=payload.name.strip(),
        status=KPI_STATUS_DRAFT,
        created_at=now,
        updated_at=now,
        created_by_id=actor.id,
        updated_by_id=actor.id,
    )
    for index, item in enumerate(payload.metrics):
        card.metrics.append(
            KpiScorecardMetric(
                id=new_uuid(),
                metric_code=item.metric_code,
                weight_percent=quantize(item.weight_percent),
                direction=item.direction.value,
                baseline=quantize(item.baseline) if item.baseline is not None else None,
                sort_order=item.sort_order if item.sort_order is not None else index,
            )
        )
    session.add(card)
    await record_audit(
        session,
        action="kpi.scorecard_create",
        entity_type="kpi_scorecard",
        entity_id=str(card.id),
        actor_id=actor.id,
        new_values={"name": card.name, "metrics": [item.metric_code for item in payload.metrics]},
    )
    await session.commit()
    return serialize_scorecard(await _load_scorecard(session, card.id))


async def update_scorecard(
    session: AsyncSession, actor: User, scorecard_id: UUID, payload: KpiScorecardUpdateRequest
) -> dict[str, object]:
    card = await _load_scorecard(session, scorecard_id)
    old = serialize_scorecard(card)
    if payload.name is not None:
        card.name = payload.name.strip()
    if payload.metrics is not None:
        _validate_metrics(payload.metrics)
        card.metrics.clear()
        await session.flush()
        for index, item in enumerate(payload.metrics):
            card.metrics.append(
                KpiScorecardMetric(
                    id=new_uuid(),
                    metric_code=item.metric_code,
                    weight_percent=quantize(item.weight_percent),
                    direction=item.direction.value,
                    baseline=quantize(item.baseline) if item.baseline is not None else None,
                    sort_order=item.sort_order if item.sort_order is not None else index,
                )
            )
        if card.status == KPI_STATUS_ACTIVE:
            _assert_active_invariant(payload.metrics)
    card.updated_at = utcnow()
    card.updated_by_id = actor.id
    await record_audit(
        session,
        action="kpi.scorecard_edit",
        entity_type="kpi_scorecard",
        entity_id=str(card.id),
        actor_id=actor.id,
        old_values={"name": old["name"], "metrics": old["metrics"]},
        new_values={"name": card.name},
    )
    await session.commit()
    return serialize_scorecard(await _load_scorecard(session, card.id))


async def set_scorecard_status(
    session: AsyncSession, actor: User, scorecard_id: UUID, *, active: bool
) -> dict[str, object]:
    card = await _load_scorecard(session, scorecard_id)
    if active:
        _assert_active_invariant(card.metrics)
        current = (
            await session.execute(
                select(KpiScorecard).where(
                    KpiScorecard.status == KPI_STATUS_ACTIVE, KpiScorecard.id != card.id
                )
            )
        ).scalar_one_or_none()
        if current is not None:
            current.status = KPI_STATUS_INACTIVE
            current.updated_at = utcnow()
            current.updated_by_id = actor.id
            await session.flush()
        card.status = KPI_STATUS_ACTIVE
        action = "kpi.scorecard_activate"
    else:
        card.status = KPI_STATUS_INACTIVE
        action = "kpi.scorecard_deactivate"
    card.updated_at = utcnow()
    card.updated_by_id = actor.id
    await record_audit(
        session,
        action=action,
        entity_type="kpi_scorecard",
        entity_id=str(card.id),
        actor_id=actor.id,
        new_values={"status": card.status},
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="KPI_ACTIVE_DUPLICATE",
            message="Only one KPI scorecard can be active",
        ) from exc
    return serialize_scorecard(await _load_scorecard(session, card.id))


async def _active_scorecard(session: AsyncSession) -> KpiScorecard | None:
    return (
        await session.execute(
            select(KpiScorecard)
            .options(selectinload(KpiScorecard.metrics))
            .where(KpiScorecard.status == KPI_STATUS_ACTIVE)
        )
    ).scalar_one_or_none()


def _milestone_actual(engine: MetricEngine, milestone: str, measurement: str) -> Decimal:
    attr_name, when_name = MILESTONE_ATTR[milestone]
    matches = engine.milestone(attr_name, when_name)
    return _actual_from_facts(matches, measurement, milestone)


async def _employee_kpi_components(
    session: AsyncSession,
    actor: User,
    employee_id: UUID,
    *,
    window: PeriodWindow,
    facts: list[AppFact],
    access: ReportingAccess,
    targets: list[PerformanceTarget],
) -> dict[str, object] | None:
    card = await _active_scorecard(session)
    if card is None:
        return None
    engine = MetricEngine(facts, access, window, ReportFilters(employee_id=employee_id))
    conversions = engine.conversions()
    overall_targets = [
        row
        for row in targets
        if row.level == TARGET_LEVEL_EMPLOYEE
        and row.entity_id == employee_id
        and row.bank_id is None
        and row.status == STATUS_ACTIVE
        and row.period_month >= month_start(window.date_from)
        and row.period_month <= month_start(window.date_to)
    ]
    weekdays, holidays = await _calendar_context(session)
    today = business_today()
    attendance = None
    if has_permission(actor, ATTENDANCE_VIEW) or has_permission(actor, ATTENDANCE_REPORTS):
        attendance = await employee_attendance_summary(
            session,
            actor,
            employee_id,
            date_from=window.date_from,
            date_to=window.date_to,
        )
    components: list[dict[str, object]] = []
    score = ZERO
    for metric in sorted(card.metrics, key=lambda item: item.sort_order):
        actual: Decimal | None = None
        baseline: Decimal | None = None
        label = next(
            (name for code, name, _d in KPI_METRIC_CATALOG if code == metric.metric_code),
            metric.metric_code,
        )
        if metric.metric_code in MILESTONE_KPI:
            milestone, measurement = MILESTONE_KPI[metric.metric_code]
            actual = _milestone_actual(engine, milestone, measurement)
            matching = [
                row
                for row in overall_targets
                if row.milestone == milestone and row.measurement == measurement
            ]
            baseline = ZERO
            for row in matching:
                baseline += _effective_target(
                    quantize(row.target_value),
                    prorate=row.prorate,
                    month=row.period_month,
                    today=today,
                    weekdays=weekdays,
                    holidays=holidays,
                    window_start=window.date_from,
                    window_end=window.date_to,
                )
            if not matching:
                baseline = None
        elif metric.metric_code == "target_achievement":
            pcts: list[float] = []
            for row in overall_targets:
                result = await _compute_result(
                    session,
                    actor,
                    row,
                    period=PERIOD_MONTH,
                    facts=facts,
                    access=access,
                    weekdays=weekdays,
                    holidays=holidays,
                    siblings=targets,
                )
                if result["achievementPct"] is not None:
                    pcts.append(float(result["achievementPct"]))
            actual = (
                quantize(sum((Decimal(str(value)) for value in pcts), start=ZERO) / len(pcts))
                if pcts
                else None
            )
            baseline = quantize(metric.baseline) if metric.baseline is not None else None
        elif metric.metric_code in CONVERSION_KEYS:
            raw = conversions.get(CONVERSION_KEYS[metric.metric_code])
            actual = quantize(raw) if raw is not None else None
            baseline = quantize(metric.baseline) if metric.baseline is not None else None
        elif metric.metric_code == "attendance_score":
            if attendance is None:
                actual = None
            else:
                actual = quantize(attendance["attendanceScore"])
            baseline = quantize(metric.baseline) if metric.baseline is not None else None
        configured = baseline is not None
        achievement = directed_achievement(
            actual if actual is not None else ZERO,
            baseline,
            metric.direction,
        )
        if actual is None or not configured:
            achievement = None
        contribution = weighted_contribution(achievement, quantize(metric.weight_percent))
        score += contribution
        components.append(
            {
                "metric": metric.metric_code,
                "label": label,
                "direction": metric.direction,
                "weightPercent": money(metric.weight_percent),
                "actual": money(actual) if actual is not None else None,
                "baseline": money(baseline) if baseline is not None else None,
                "achievementPct": achievement,
                "weightedContribution": money(contribution),
                "configured": configured,
            }
        )
    return {
        "scorecardId": str(card.id),
        "scorecardName": card.name,
        "score": money(score),
        "components": components,
    }


async def profile_targets_kpi(
    session: AsyncSession,
    actor: User,
    employee_id: UUID,
    *,
    window: PeriodWindow,
    facts: list[AppFact],
    access: ReportingAccess,
) -> dict[str, object] | None:
    if not has_permission(actor, TARGETS_VIEW):
        return None
    users, teams, offices, products, banks = await _load_catalog(session)
    if not _entity_visible(
        access,
        level=TARGET_LEVEL_EMPLOYEE,
        entity_id=employee_id,
        users=users,
        teams=teams,
        offices=offices,
    ):
        return None
    locked = await _locked_months(session)
    rows = list(
        (
            await session.execute(
                select(PerformanceTarget)
                .options(selectinload(PerformanceTarget.changes))
                .where(
                    PerformanceTarget.level == TARGET_LEVEL_EMPLOYEE,
                    PerformanceTarget.entity_id == employee_id,
                    PerformanceTarget.status == STATUS_ACTIVE,
                    PerformanceTarget.period_month >= month_start(window.date_from),
                    PerformanceTarget.period_month <= month_start(window.date_to),
                )
            )
        ).scalars()
    )
    weekdays, holidays = await _calendar_context(session)
    items = []
    for row in rows:
        result = await _compute_result(
            session,
            actor,
            row,
            period=PERIOD_MONTH,
            facts=facts,
            access=access,
            weekdays=weekdays,
            holidays=holidays,
            siblings=rows,
        )
        items.append(
            serialize_target(
                row,
                users=users,
                teams=teams,
                offices=offices,
                products=products,
                banks=banks,
                locked=locked,
                result=result,
            )
        )
    kpi = await _employee_kpi_components(
        session,
        actor,
        employee_id,
        window=window,
        facts=facts,
        access=access,
        targets=rows,
    )
    return {
        "currency": CURRENCY,
        "targets": items,
        "kpi": kpi,
    }


async def dashboard_targets_summary(
    session: AsyncSession,
    actor: User,
    *,
    window: PeriodWindow,
    facts: list[AppFact],
    access: ReportingAccess,
) -> dict[str, object] | None:
    if not has_permission(actor, TARGETS_VIEW) or access.scope is None:
        return None
    users, teams, offices, products, banks = await _load_catalog(session)
    locked = await _locked_months(session)
    month = month_start(window.date_to)
    rows = list(
        (
            await session.execute(
                select(PerformanceTarget).where(
                    PerformanceTarget.period_month == month,
                    PerformanceTarget.status == STATUS_ACTIVE,
                )
            )
        ).scalars()
    )
    visible = [
        row
        for row in rows
        if _entity_visible(
            access,
            level=row.level,
            entity_id=row.entity_id,
            users=users,
            teams=teams,
            offices=offices,
        )
    ]

    def _sort_name(row: PerformanceTarget) -> str:
        if row.level == TARGET_LEVEL_EMPLOYEE:
            user = users.get(row.entity_id)
            return user.full_name.lower() if user else str(row.entity_id)
        if row.level == TARGET_LEVEL_TEAM:
            team = teams.get(row.entity_id)
            return team.name.lower() if team else str(row.entity_id)
        office = offices.get(row.entity_id)
        return office.name.lower() if office else str(row.entity_id)

    visible.sort(
        key=lambda row: (
            row.level,
            _sort_name(row),
            products[row.product_id].code if row.product_id in products else "",
            row.milestone,
            str(row.bank_id or ""),
        )
    )
    weekdays, holidays = await _calendar_context(session)
    items = []
    for row in visible:
        result = await _compute_result(
            session,
            actor,
            row,
            period=PERIOD_MONTH,
            facts=facts,
            access=access,
            weekdays=weekdays,
            holidays=holidays,
            siblings=visible,
        )
        items.append(
            serialize_target(
                row,
                users=users,
                teams=teams,
                offices=offices,
                products=products,
                banks=banks,
                locked=locked,
                result=result,
            )
        )
    return {"currency": CURRENCY, "count": len(visible), "items": items}
