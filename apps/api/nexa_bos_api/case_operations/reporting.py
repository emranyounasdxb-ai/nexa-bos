from __future__ import annotations

from datetime import UTC, date, datetime, time
from decimal import Decimal
from io import BytesIO
from uuid import UUID

from openpyxl import Workbook
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.applications.models import Application, ApplicationOwnerHistory
from nexa_bos_api.applications.service import serialize_applications
from nexa_bos_api.applications.visibility import visible_case_owner_ids
from nexa_bos_api.case_operations.models import CaseEarning, CaseEarningReversal
from nexa_bos_api.catalog.models import Product
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.customers.models import Customer
from nexa_bos_api.identity.access import has_user_type, tl_team_owner_ids
from nexa_bos_api.identity.models import User, UserType


def _money(value: Decimal | None) -> str:
    return format(value or Decimal("0"), ".2f")


async def scoped_case_statement(session: AsyncSession, actor: User):
    stmt = select(Application)
    if has_user_type(actor, "COD"):
        return stmt.where(Application.routed_coordinator_id == actor.id)
    if has_user_type(actor, "SM"):
        return stmt.where(Application.routed_sales_manager_id == actor.id)
    if has_user_type(actor, "TL"):
        return stmt.where(Application.case_owner_id.in_(await tl_team_owner_ids(session, actor)))
    if has_user_type(actor, "SE"):
        return stmt.where(Application.case_owner_id == actor.id)
    if has_user_type(actor, "BDM", "GM", "OWNER"):
        return stmt
    return stmt.where(False)


async def case_report(
    session: AsyncSession,
    actor: User,
    *,
    booking_from: date | None,
    booking_to: date | None,
) -> dict[str, object]:
    stmt = await scoped_case_statement(session, actor)
    if booking_from:
        stmt = stmt.where(
            Application.booked_at >= datetime.combine(booking_from, time.min, tzinfo=UTC)
        )
    if booking_to:
        stmt = stmt.where(
            Application.booked_at <= datetime.combine(booking_to, time.max, tzinfo=UTC)
        )
    applications = list(
        await session.scalars(stmt.order_by(Application.booked_at.desc().nullslast()))
    )
    serialized = await serialize_applications(session, applications)
    items: list[dict[str, object]] = []
    for application, payload in zip(applications, serialized, strict=True):
        customer = await session.get(Customer, application.customer_id)
        owner = await session.get(User, application.case_owner_id)
        home = await session.scalar(
            select(ApplicationOwnerHistory)
            .where(ApplicationOwnerHistory.application_id == application.id)
            .order_by(ApplicationOwnerHistory.effective_from)
            .limit(1)
        )
        earning = await session.scalar(
            select(CaseEarning).where(CaseEarning.application_id == application.id)
        )
        reversed_amount = Decimal("0")
        if earning:
            reversed_amount = (
                await session.scalar(
                    select(func.coalesce(func.sum(CaseEarningReversal.amount), 0)).where(
                        CaseEarningReversal.earning_id == earning.id
                    )
                )
            ) or Decimal("0")
        overdue = payload.get("overdue")
        items.append(
            {
                "caseId": application.application_code,
                "customerReference": customer.customer_code if customer else None,
                "caseOwner": owner.full_name if owner else None,
                "office": home.office_name if home else None,
                "homeDepartment": home.department_name if home else None,
                "homeTeam": home.team_name if home else None,
                "productLane": payload["productName"],
                "bank": payload["bankName"],
                "product": payload["productName"],
                "variant": payload["productVariantName"],
                "bookingDate": payload["bookedAt"],
                "submissionDate": payload["submittedAt"],
                "bankFileNumber": payload["bankCaseNumber"],
                "currentStage": payload["currentStage"],
                "stageEntryDate": payload.get("currentStageEnteredAt"),
                "overdue": overdue,
                "overdueState": "Overdue" if overdue else "On time",
                "overdueDurationHours": overdue.get("overdueHours") if overdue else None,
                "closure": payload["terminalOutcome"],
                "points": (
                    _money(earning.amount)
                    if earning and earning.earning_type == "card_points"
                    else "0.00"
                ),
                "loanAmount": payload["bookedAmount"],
                "commission": (
                    _money(earning.amount)
                    if earning and earning.earning_type == "pf_commission"
                    else "0.00"
                ),
                "clawbacks": _money(reversed_amount),
            }
        )
    return {"items": items, "total": len(items), "generatedAt": datetime.now(UTC).isoformat()}


REPORT_COLUMNS = (
    ("caseId", "Case ID"),
    ("customerReference", "Customer Reference"),
    ("caseOwner", "Case Owner"),
    ("office", "Office"),
    ("homeDepartment", "Home Department"),
    ("homeTeam", "Home Team"),
    ("productLane", "Product Lane"),
    ("bank", "Bank"),
    ("variant", "Variant"),
    ("bookingDate", "Booking Date"),
    ("submissionDate", "Submission Date"),
    ("bankFileNumber", "Bank File Number"),
    ("currentStage", "Current Stage"),
    ("stageEntryDate", "Stage Entry Date"),
    ("overdueState", "Overdue State"),
    ("overdueDurationHours", "Overdue Duration (Hours)"),
    ("closure", "Closure"),
    ("points", "Points"),
    ("loanAmount", "Loan Amount"),
    ("commission", "Commission"),
    ("clawbacks", "Clawbacks"),
)


def case_report_xlsx(payload: dict[str, object]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Case Operations"
    sheet.append([label for _, label in REPORT_COLUMNS])
    for item in payload["items"]:
        sheet.append([item.get(key) for key, _ in REPORT_COLUMNS])
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


async def employee_metrics(
    session: AsyncSession,
    actor: User,
    employee_id: UUID,
) -> dict[str, object]:
    allowed_ids = await visible_case_owner_ids(session, actor)
    if allowed_ids is not None and employee_id not in allowed_ids:
        raise AppError(status_code=404, code="USER_NOT_FOUND", message="User not found")
    applications = list(
        await session.scalars(select(Application).where(Application.case_owner_id == employee_id))
    )
    product_ids = {row.product_id for row in applications}
    products = {
        row.id: row
        for row in (
            list(await session.scalars(select(Product).where(Product.id.in_(product_ids))))
            if product_ids
            else []
        )
    }
    app_ids = [row.id for row in applications]
    earnings = (
        list(
            await session.scalars(
                select(CaseEarning).where(CaseEarning.application_id.in_(app_ids))
            )
        )
        if app_ids
        else []
    )
    card = [row for row in earnings if row.earning_type == "card_points"]
    pf = [row for row in earnings if row.earning_type == "pf_commission"]

    async def reversed_for(rows: list[CaseEarning]) -> Decimal:
        if not rows:
            return Decimal("0")
        return (
            await session.scalar(
                select(func.coalesce(func.sum(CaseEarningReversal.amount), 0)).where(
                    CaseEarningReversal.earning_id.in_([row.id for row in rows])
                )
            )
        ) or Decimal("0")

    points_reversed = await reversed_for(card)
    commission_reversed = await reversed_for(pf)
    points = sum((row.amount for row in card), Decimal("0"))
    commission = sum((row.amount for row in pf), Decimal("0"))
    return {
        "employeeId": str(employee_id),
        "cardsBooked": sum(
            1
            for row in applications
            if row.booked_at
            and products.get(row.product_id)
            and products[row.product_id].code == "CC"
        ),
        "pointsEarned": _money(points),
        "pointsReversed": _money(points_reversed),
        "pointsNet": _money(points - points_reversed),
        "loansBooked": sum(
            1
            for row in applications
            if row.booked_at
            and products.get(row.product_id)
            and products[row.product_id].code == "PF"
        ),
        "loanAmount": _money(
            sum(
                (
                    row.booked_amount or Decimal("0")
                    for row in applications
                    if products.get(row.product_id) and products[row.product_id].code == "PF"
                ),
                Decimal("0"),
            )
        ),
        "commissionEarned": _money(commission),
        "commissionReversed": _money(commission_reversed),
        "commissionNet": _money(commission - commission_reversed),
        "pendingCases": sum(1 for row in applications if row.terminal_outcome is None),
        "closedCases": sum(1 for row in applications if row.terminal_outcome is not None),
    }


async def team_metrics(
    session: AsyncSession,
    actor: User,
    team_id: UUID,
) -> dict[str, object]:
    users = list(
        await session.scalars(
            select(User)
            .join(UserType, User.user_type_id == UserType.id)
            .where(User.team_id == team_id, UserType.code == "SE")
            .order_by(User.full_name)
        )
    )
    rows: list[dict[str, object]] = []
    for user in users:
        try:
            metrics = await employee_metrics(session, actor, user.id)
        except AppError as exc:
            if exc.status_code == 404:
                continue
            raise
        rows.append({"employeeName": user.full_name, **metrics})
    money_fields = (
        "pointsEarned",
        "pointsReversed",
        "pointsNet",
        "loanAmount",
        "commissionEarned",
        "commissionReversed",
        "commissionNet",
    )
    count_fields = ("cardsBooked", "loansBooked", "pendingCases", "closedCases")
    totals: dict[str, object] = {key: sum(int(row[key]) for row in rows) for key in count_fields}
    totals.update(
        {
            key: _money(sum((Decimal(str(row[key])) for row in rows), Decimal("0")))
            for key in money_fields
        }
    )
    return {"items": rows, "totals": totals}
