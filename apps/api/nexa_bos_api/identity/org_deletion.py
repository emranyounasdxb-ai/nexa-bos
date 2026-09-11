"""OWNER-only permanent deletion of unused masters, with retained immutable evidence."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import String, Uuid, and_, cast, delete, func, not_, or_, select, text, update
from sqlalchemy.dialects.postgresql import JSONB, JSONPATH
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from nexa_bos_api.core.exceptions import AppError
from nexa_bos_api.db.base import Base
from nexa_bos_api.identity.access import is_owner, user_load_options
from nexa_bos_api.identity.audit import record_audit
from nexa_bos_api.identity.enums import AccountStatus, UserTypeStatus
from nexa_bos_api.identity.models import (
    BusinessUnit,
    BusinessUnitNameHistory,
    Department,
    DepartmentNameHistory,
    Designation,
    DesignationNameHistory,
    Office,
    OfficeNameHistory,
    OrganizationMasterDeletion,
    OwnerSingleton,
    Team,
    TeamNameHistory,
    User,
    new_uuid,
)
from nexa_bos_api.identity.org_service import utcnow

MASTERS = {
    "office": (Office, OfficeNameHistory, "office_id"),
    "department": (Department, DepartmentNameHistory, "department_id"),
    "business_unit": (BusinessUnit, BusinessUnitNameHistory, "business_unit_id"),
    "team": (Team, TeamNameHistory, "team_id"),
    "designation": (Designation, DesignationNameHistory, "designation_id"),
}


async def require_owner(session: AsyncSession, actor: User) -> None:
    current = await session.scalar(
        select(User)
        .where(User.id == actor.id)
        .options(*user_load_options())
        .execution_options(populate_existing=True)
    )
    singleton = await session.get(OwnerSingleton, 1, populate_existing=True)
    if (
        current is None
        or not is_owner(current)
        or current.account_status != AccountStatus.ACTIVE
        or current.user_type.status != UserTypeStatus.ACTIVE
        or singleton is None
        or singleton.user_id != actor.id
    ):
        raise AppError(
            status_code=403,
            code="OWNER_REQUIRED",
            message="Only OWNER can delete organization masters",
        )


def _json(value):
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _reference_queries(kind: str, record_id: UUID):
    """Include both relational references and immutable JSON/string snapshots.

    Initial creation/rename audit and the master's own name history are evidence,
    not usage. Every other exact ID reference fails closed, including past usage.
    Identifiers come exclusively from trusted SQLAlchemy metadata, never request input.
    """
    model, history, _ = MASTERS[kind]
    for table in sorted(Base.metadata.tables.values(), key=lambda item: item.name):
        if table.name in {model.__tablename__, history.__tablename__}:
            continue
        predicates = []
        for column in table.c:
            if column.primary_key:
                continue
            if isinstance(column.type, Uuid):
                predicates.append(column == record_id)
            elif isinstance(column.type, JSONB):
                predicates.append(
                    func.jsonb_path_exists(
                        column,
                        cast("$.** ? (@ == $id)", JSONPATH),
                        func.jsonb_build_object("id", str(record_id)),
                    )
                )
            elif isinstance(column.type, String):
                predicates.append(column == str(record_id))
        if not predicates:
            continue
        condition = or_(*predicates)
        if table.name == "audit_events":
            condition = and_(
                condition,
                not_(
                    and_(
                        table.c.entity_type == kind,
                        table.c.entity_id == str(record_id),
                        table.c.action.in_((f"{kind}.create", f"{kind}.rename")),
                    )
                ),
            )
        yield table, select(func.count()).select_from(table).where(condition)


async def deletion_preview(session: AsyncSession, actor: User, kind: str, record_id: UUID):
    await require_owner(session, actor)
    model, _, _ = MASTERS[kind]
    row = await session.get(model, record_id)
    if row is None:
        raise AppError(
            status_code=404, code="MASTER_NOT_FOUND", message="Organization master not found"
        )
    dependencies = []
    for table, query in _reference_queries(kind, record_id):
        count = int(await session.scalar(query) or 0)
        if count:
            dependencies.append({"type": table.name, "count": count})
    # A leader is also real usage even if malformed legacy history is absent.
    if isinstance(row, Team) and row.team_leader_id is not None:
        dependencies.append({"type": "assigned_team_leader", "count": 1})
    return {
        "id": str(row.id),
        "name": row.name,
        "code": row.code,
        "dependencies": dependencies,
        "canDelete": not dependencies,
    }


async def lock_master_references(session: AsyncSession, kind: str, record_id: UUID):
    """Serialize a rare unused-master change against relational and snapshot writers."""
    model, history, _ = MASTERS[kind]
    tables = {table.name for table, _ in _reference_queries(kind, record_id)}
    tables.update((model.__tablename__, history.__tablename__))
    preparer = session.bind.dialect.identifier_preparer
    names = ", ".join(preparer.quote(name) for name in sorted(tables))
    await session.execute(text(f"LOCK TABLE {names} IN SHARE ROW EXCLUSIVE MODE NOWAIT"))
    # A snapshot-only writer may have read the master without acquiring any write
    # lock yet. Refuse those readers too; later readers see the committed deletion
    # rather than validating a record that is about to disappear.
    master_name = preparer.quote(model.__tablename__)
    await session.execute(text(f"LOCK TABLE {master_name} IN ACCESS EXCLUSIVE MODE NOWAIT"))


async def delete_unused_master(
    session: AsyncSession, actor: User, kind: str, record_id: UUID, reason: str, confirmation: str
):
    await require_owner(session, actor)
    reason = reason.strip()
    if confirmation != "DELETE" or not reason or len(reason) > 1000:
        raise AppError(
            status_code=422,
            code="DELETE_CONFIRMATION_REQUIRED",
            message="Enter exact DELETE and a reason of 1 to 1000 characters",
        )
    model, history, live_key = MASTERS[kind]
    try:
        # Snapshot-only references lack foreign keys. Short NOWAIT table locks prevent
        # concurrent writers invalidating this check; contention refuses deletion.
        await lock_master_references(session, kind, record_id)
        await session.refresh(actor)
        preview = await deletion_preview(session, actor, kind, record_id)
        if preview["dependencies"]:
            raise AppError(
                status_code=409,
                code="MASTER_IN_USE",
                message=(
                    "This record has current or historical dependencies. "
                    "Use Deactivate where permitted."
                ),
                details=preview["dependencies"],
            )
        row = await session.get(model, record_id, populate_existing=True)
        snapshot = {
            column.name: _json(getattr(row, column.name)) for column in model.__table__.columns
        }
        histories = list(
            (
                await session.scalars(
                    select(history)
                    .where(getattr(history, live_key) == record_id)
                    .order_by(history.effective_from, history.id)
                )
            ).all()
        )
        name_history = [
            {column.name: _json(getattr(item, column.name)) for column in history.__table__.columns}
            for item in histories
        ]
        archived = OrganizationMasterDeletion(
            id=new_uuid(),
            record_id=record_id,
            record_type=kind,
            code=row.code,
            name=row.name,
            snapshot=snapshot,
            name_history=name_history,
            reason=reason,
            actor_id=actor.id,
            deleted_at=utcnow(),
        )
        session.add(archived)
        await session.flush()
        await session.execute(
            update(history).where(getattr(history, live_key) == record_id).values({live_key: None})
        )
        await record_audit(
            session,
            action=f"{kind}.delete",
            entity_type=kind,
            entity_id=str(record_id),
            actor_id=actor.id,
            old_values=snapshot,
            new_values={"deletionEvidenceId": str(archived.id), "nameHistory": name_history},
            note=reason,
        )
        await session.execute(delete(model).where(model.id == record_id))
        await session.commit()
        return {"deleted": True, "id": str(record_id), "deletionEvidenceId": str(archived.id)}
    except AppError:
        await session.rollback()
        raise
    except DBAPIError as exc:
        await session.rollback()
        raise AppError(
            status_code=409,
            code="MASTER_DELETE_CONFLICT",
            message=(
                "Deletion was rolled back because a dependency or concurrent operation "
                "changed. No record or history was removed."
            ),
        ) from exc
    except Exception:
        await session.rollback()
        raise
