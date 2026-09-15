from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.applications.models import Application, WorkflowStage, WorkflowTransition
from nexa_bos_api.applications.schemas import StageUpdateRequest
from nexa_bos_api.applications.service import update_stage
from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.identity.access import has_user_type
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.models import User

HEADERS = ("case_id", "current_stage", "new_stage", "stage_date", "note")
MAX_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True)
class ValidatedStageRow:
    row_number: int
    application: Application
    target: WorkflowStage
    stage_date: date
    note: str | None


def blank_template() -> bytes:
    output = io.StringIO(newline="")
    csv.writer(output).writerow(HEADERS)
    return output.getvalue().encode("utf-8-sig")


def parse_csv(content: bytes) -> list[dict[str, str]]:
    if len(content) > MAX_BYTES:
        raise AppError(status_code=413, code="CSV_TOO_LARGE", message="CSV must be 2 MB or smaller")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AppError(
            status_code=422, code="CSV_ENCODING_INVALID", message="CSV must use UTF-8"
        ) from exc
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if tuple(reader.fieldnames or ()) != HEADERS:
        raise AppError(
            status_code=422,
            code="CSV_HEADERS_INVALID",
            message=f"CSV headers must be exactly: {', '.join(HEADERS)}",
        )
    rows = [{key: (value or "").strip() for key, value in row.items()} for row in reader]
    if not rows:
        raise AppError(status_code=422, code="CSV_EMPTY", message="CSV contains no case rows")
    return rows


def _error(row: int, field: str, message: str) -> dict[str, object]:
    return {"row": row, "field": field, "message": message}


async def _scoped_application(
    session: AsyncSession, actor: User, value: str, *, lock: bool
) -> Application | None:
    try:
        application_id = UUID(value)
    except ValueError:
        application_id = None
    stmt = select(Application)
    if application_id:
        stmt = stmt.where(Application.id == application_id)
    else:
        stmt = stmt.where(Application.application_code == value)
    if lock:
        stmt = stmt.with_for_update()
    row = await session.scalar(stmt)
    if row is None or row.routed_coordinator_id != actor.id:
        return None
    return row


async def _stage(session: AsyncSession, workflow_id: UUID, value: str) -> WorkflowStage | None:
    try:
        stage_id = UUID(value)
    except ValueError:
        stage_id = None
    stmt = select(WorkflowStage).where(WorkflowStage.workflow_id == workflow_id)
    if stage_id:
        stmt = stmt.where(WorkflowStage.id == stage_id)
    else:
        stmt = stmt.where((WorkflowStage.code.ilike(value)) | (WorkflowStage.name.ilike(value)))
    return await session.scalar(stmt)


async def validate_rows(
    session: AsyncSession,
    actor: User,
    content: bytes,
    *,
    lock: bool = False,
) -> tuple[list[ValidatedStageRow], list[dict[str, object]]]:
    if not has_user_type(actor, "COD"):
        raise AppError(status_code=403, code="FORBIDDEN", message="Coordinator access required")
    source_rows = parse_csv(content)
    validated: list[ValidatedStageRow] = []
    errors: list[dict[str, object]] = []
    seen: set[str] = set()
    for index, source in enumerate(source_rows, start=2):
        case_id = source["case_id"]
        if not case_id:
            errors.append(_error(index, "case_id", "Case ID is required"))
            continue
        if case_id.casefold() in seen:
            errors.append(_error(index, "case_id", "Case appears more than once in this CSV"))
            continue
        seen.add(case_id.casefold())
        application = await _scoped_application(session, actor, case_id, lock=lock)
        if application is None:
            errors.append(_error(index, "case_id", "Case was not found in your assigned scope"))
            continue
        if application.terminal_outcome:
            errors.append(_error(index, "case_id", "Closed or terminal cases cannot be imported"))
            continue
        current = await session.get(WorkflowStage, application.current_stage_id)
        if current is None:
            errors.append(_error(index, "current_stage", "Current stage is unavailable"))
            continue
        supplied_current = source["current_stage"]
        if supplied_current.casefold() not in {
            str(current.id).casefold(),
            current.code.casefold(),
            current.name.casefold(),
        }:
            errors.append(
                _error(index, "current_stage", f"Current stage changed; use {current.name}")
            )
        target = await _stage(session, application.workflow_id, source["new_stage"])
        if target is None:
            errors.append(_error(index, "new_stage", "Stage is not on this case workflow"))
        elif target.id != current.id:
            transition = await session.scalar(
                select(WorkflowTransition.id).where(
                    WorkflowTransition.workflow_id == application.workflow_id,
                    WorkflowTransition.from_stage_id == current.id,
                    WorkflowTransition.to_stage_id == target.id,
                )
            )
            if transition is None:
                errors.append(_error(index, "new_stage", "That stage transition is not configured"))
                target = None
        try:
            stage_date = date.fromisoformat(source["stage_date"])
            if stage_date > date.today():
                raise ValueError
        except ValueError:
            errors.append(_error(index, "stage_date", "Use YYYY-MM-DD, not a future date"))
            stage_date = date.today()
        if target and supplied_current.casefold() in {
            str(current.id).casefold(),
            current.code.casefold(),
            current.name.casefold(),
        }:
            validated.append(
                ValidatedStageRow(
                    row_number=index,
                    application=application,
                    target=target,
                    stage_date=stage_date,
                    note=source["note"] or None,
                )
            )
    return validated, errors


async def validate_stage_csv(
    session: AsyncSession, actor: User, content: bytes
) -> dict[str, object]:
    rows, errors = await validate_rows(session, actor, content)
    return {
        "valid": not errors,
        "recordCount": len(rows) if not errors else 0,
        "preview": [
            {
                "row": row.row_number,
                "caseId": row.application.application_code,
                "newStage": row.target.name,
                "stageDate": row.stage_date.isoformat(),
            }
            for row in rows
        ],
        "errors": errors,
    }


async def import_stage_csv(session: AsyncSession, actor: User, content: bytes) -> dict[str, object]:
    rows, errors = await validate_rows(session, actor, content, lock=True)
    if errors:
        await session.rollback()
        raise AppError(
            status_code=422,
            code="CSV_VALIDATION_FAILED",
            message="No cases were changed. Correct the CSV and validate again.",
            details=errors,
        )
    for row in rows:
        await update_stage(
            session,
            actor,
            row.application,
            StageUpdateRequest(
                stage_id=row.target.id,
                bank_stage_date=row.stage_date,
                stage_note=row.note,
            ),
            commit=False,
            source="CSV",
        )
    await record_audit(
        session,
        action="case_operations.stage_csv.import",
        entity_type="case_stage_import",
        entity_id=f"{actor.id}:{date.today().isoformat()}",
        actor_id=actor.id,
        new_values={"importedCount": len(rows)},
    )
    await session.commit()
    return {"importedCount": len(rows)}


async def current_cases_csv(session: AsyncSession, actor: User) -> bytes:
    if not has_user_type(actor, "COD"):
        raise AppError(status_code=403, code="FORBIDDEN", message="Coordinator access required")
    rows = (
        await session.execute(
            select(Application, WorkflowStage)
            .join(WorkflowStage, WorkflowStage.id == Application.current_stage_id)
            .where(
                Application.routed_coordinator_id == actor.id,
                Application.terminal_outcome.is_(None),
            )
            .order_by(Application.application_code)
        )
    ).all()
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=HEADERS)
    writer.writeheader()
    for application, stage in rows:
        writer.writerow(
            {
                "case_id": application.application_code,
                "current_stage": stage.name,
                "new_stage": "",
                "stage_date": date.today().isoformat(),
                "note": "",
            }
        )
    return output.getvalue().encode("utf-8-sig")
