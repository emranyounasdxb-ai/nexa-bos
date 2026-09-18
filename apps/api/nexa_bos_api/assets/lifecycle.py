"""Read-only lifecycle projection from immutable audits and saved custody dates.

Employee/office custody dates are calendar dates, not fabricated midnight timestamps.
Stock and repair durations use recorded state transitions and retain unknown gaps.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any


def build_lifecycle(asset: Any, events: list[Any], names: dict[str, dict[str, str | None]], actors: dict[str, dict[str, object]]) -> dict[str, object]:
    as_of = datetime.now(UTC)
    timeline: list[dict[str, object]] = []
    operational: list[dict[str, object]] = []
    state: str | None = None
    office_id: str | None = None
    employee_id: str | None = None
    condition: str | None = None
    current: dict[str, object] | None = None
    saw_creation = False
    gaps = False
    assignments_seen = 0
    last_issued_employee: str | None = None

    def identity(kind: str, key: object) -> str | None:
        return names.get(kind, {}).get(str(key)) if key else None

    def close_period(end: datetime, end_context: dict[str, object] | None = None) -> None:
        nonlocal current
        if current is None:
            return
        start = current.pop("_start", None)
        current["to"] = end.isoformat()
        current["active"] = False
        current["durationSeconds"] = (end - start).total_seconds() if start is not None and end >= start else None
        current["durationDays"] = current["durationSeconds"] / 86400 if current["durationSeconds"] is not None else None
        if end_context:
            current.update(endActor=end_context.get("actor"), endCondition=end_context.get("condition"), endNote=end_context.get("note"), endReason=end_context.get("reason"), endActionCode=end_context.get("actionCode"))
        operational.append(current)
        current = None

    for event in sorted(events, key=lambda row: (row.created_at, str(row.id))):
        new = event.new_values if isinstance(event.new_values, dict) else {}
        old = event.old_values if isinstance(event.old_values, dict) else {}
        snap = new.get("lifecycle") if isinstance(new.get("lifecycle"), dict) else {}
        old_state = old.get("status")
        next_state = snap.get("status", new.get("status", state))
        if event.action == "asset.employee.transfer":
            next_state = "Allocated"
        next_office = snap.get("officeId", new.get("officeId", office_id))
        next_employee = snap.get("custodianId", new.get("activeEmployeeId", new.get("employeeId", employee_id)))
        next_condition = snap.get("condition", new.get("condition", new.get("conditionAtIssue", new.get("returnCondition", condition))))
        effective = snap.get("effectiveDate") or new.get("issueDate") or new.get("returnDate") or new.get("transferDate")
        event_employee = snap.get("employeeId") or event.target_user_id or old.get("activeEmployeeId") or next_employee
        event_employee_name = snap.get("employeeName") or (snap.get("custodianName") if str(event_employee) == str(snap.get("custodianId")) else None) or identity("employees", event_employee)
        event_office_name = snap.get("officeName") or identity("offices", next_office)
        actor = dict(snap["actor"]) if isinstance(snap.get("actor"), dict) else dict(actors.get(str(event.actor_id), {"id": str(event.actor_id) if event.actor_id else None}))
        actor["actionAt"] = event.created_at.isoformat()
        if not isinstance(snap.get("actor"), dict):
            actor["source"] = "Legacy: current saved user details; historical designation/office not recorded"
            if snap.get("performedBy"):
                actor["name"] = snap["performedBy"]
        performed = actor.get("name")
        title = {
            "asset.create": "Added to system",
            "asset.allocate": "Reissued to another employee" if assignments_seen and last_issued_employee and str(event_employee) != last_issued_employee else "Reissued to employee" if assignments_seen else "Issued to employee",
            "asset.return": "Received from repair / employee custody closed" if old_state == "Under Repair" else "Returned by employee",
            "asset.employee.transfer": "Reissued to another employee / custody transferred",
            "asset.office.transfer": "Office transfer",
            "asset.condition.correct": "Condition changed",
            "asset.identifier.correct": "Identifiers corrected",
            "asset.master.update": "Master data updated",
            "asset.status.change": "Sent for repair" if next_state == "Under Repair" and old_state != "Under Repair" else "Received from repair" if old_state == "Under Repair" and next_state == "In Stock" else "Status changed",
        }.get(event.action, event.action)
        if event.action in ("asset.allocate", "asset.employee.transfer"):
            assignments_seen += 1
            last_issued_employee = str(event_employee) if event_employee else None
        reason_action = event.action in ("asset.status.change", "asset.condition.correct", "asset.identifier.correct") or (event.action == "asset.return" and old_state == "Under Repair")
        context = {
            "office": event_office_name,
            "employee": event_employee_name,
            "employeeCode": snap.get("employeeCode") or (snap.get("custodianCode") if str(event_employee) == str(snap.get("custodianId")) else None) or identity("codes", event_employee),
            "performedBy": performed, "actor": actor, "actionCode": event.action,
            "employeeId": str(next_employee) if next_employee else None,
            "allocationId": snap.get("allocationId"),
            "condition": next_condition,
            "status": next_state,
            "reason": snap.get("reason", event.note if reason_action else None),
            "note": snap.get("note", event.note if not reason_action else None),
            "location": snap.get("repairLocation") if next_state == "Under Repair" else event_office_name,
            "contextSource": "Immutable snapshot" if snap else "Legacy recorded IDs; names resolved from current saved records",
        }
        timeline.append({"id": str(event.id), "kind": "event", "title": title, "from": event.created_at.isoformat(), "to": None, "recordedAt": event.created_at.isoformat(), "effectiveDate": effective, "precision": "timestamp", "active": False, "durationSeconds": 0, "durationDays": 0, **context, "endCondition": next_condition})
        if event.action == "asset.create":
            saw_creation = True
        # An old status without its opening event proves a period existed, but not when it began.
        if old_state and state is not None and old_state != state:
            if current:
                current.pop("_start", None)
                current.update(to=None, active=False, durationSeconds=None)
                operational.append(current)
                current = None
            state = None
            gaps = True
        if state is None and old_state in ("In Stock", "Under Repair", "Allocated"):
            current = {"id": f"gap-{event.id}", "kind": "stock" if old_state == "In Stock" else "employee" if old_state == "Allocated" else "repair", "title": "In stock / store" if old_state == "In Stock" else "Employee custody" if old_state == "Allocated" else "Under repair", "from": None, "_start": None, "precision": "timestamp", "durationDays": None, "status": old_state, "office": None, "employee": None, "employeeCode": None, "condition": old.get("condition"), "performedBy": None, "reason": None, "note": None, "location": None}
            state = old_state
            gaps = True
        split = next_state != state or (office_id is not None and next_office != office_id) or (condition is not None and next_condition != condition) or (state == "Allocated" and next_employee != employee_id)
        if split:
            close_period(event.created_at, context)
            if next_state in ("In Stock", "Under Repair", "Allocated"):
                transition = event.action in ("asset.create", "asset.return", "asset.status.change", "asset.allocate", "asset.employee.transfer") and next_state != state
                start = asset.created_at if event.action == "asset.create" else event.created_at if state is not None or transition else None
                if start is None:
                    gaps = True
                current = {"id": f"period-{event.id}", "kind": "stock" if next_state == "In Stock" else "employee" if next_state == "Allocated" else "repair", "title": "Returned to stock" if next_state == "In Stock" and event.action != "asset.create" else "Stored / In stock" if next_state == "In Stock" else "Assigned to employee" if next_state == "Allocated" else "Under repair", "from": start.isoformat() if start else None, "_start": start, "precision": "timestamp", "durationDays": None, "effectiveDate": effective, **context, "employee": (snap.get("custodianName") or identity("employees", next_employee)) if next_state == "Allocated" else None, "employeeCode": (snap.get("custodianCode") or identity("codes", next_employee)) if next_state == "Allocated" else None}
        if current and not split:
            current.update(office=event_office_name, condition=next_condition)
        state, office_id, employee_id, condition = next_state, next_office, next_employee, next_condition

    if state is not None and state != asset.status:
        # Do not extrapolate stale audits through a missing status transition.
        if current:
            current.pop("_start", None)
            current.update(to=None, active=False, durationSeconds=None)
            operational.append(current)
            current = None
        gaps = True
    if current:
        start = current.pop("_start", None)
        current.update(to=None, active=True, endCondition=asset.condition, durationSeconds=(as_of - start).total_seconds() if start and as_of >= start else None)
        current["durationDays"] = current["durationSeconds"] / 86400 if current["durationSeconds"] is not None else None
        operational.append(current)
    elif asset.status in ("In Stock", "Under Repair"):
        operational.append({"id": "current-unknown", "kind": "stock" if asset.status == "In Stock" else "repair", "title": "In stock / store" if asset.status == "In Stock" else "Under repair", "from": None, "to": None, "precision": "timestamp", "active": True, "durationSeconds": None, "durationDays": None, "status": asset.status, "condition": asset.condition, "office": asset.office.name if asset.office else None, "employee": None, "performedBy": None, "reason": None, "note": None, "location": asset.office.name if asset.status == "In Stock" and asset.office else None})
        gaps = True
    assigned_complete = True
    assigned_calendar_days: set[object] = set()
    for index, allocation in enumerate(sorted(asset.allocations, key=lambda row: (row.created_at, str(row.id))), 1):
        matched = [row for row in operational if row.get("allocationId") == str(allocation.id) or (row.get("employeeId") == str(allocation.employee_id) and row.get("effectiveDate") == allocation.issue_date.isoformat())]
        if matched:
            continue  # The sequential timestamp periods already represent this custody.
        end = allocation.return_date or as_of.date()
        precise = allocation.created_at is not None and allocation.issue_date == allocation.created_at.date() and (allocation.return_date is None or (allocation.closed_at is not None and allocation.return_date == allocation.closed_at.date()))
        seconds = ((allocation.closed_at or as_of) - allocation.created_at).total_seconds() if precise else None
        if seconds is not None and seconds < 0:
            seconds = None
            precise = False
        days = seconds / 86400 if precise else (end - allocation.issue_date).days + 1 if allocation.issue_date and end >= allocation.issue_date else None
        overlap = any(row.get("from") and row.get("durationSeconds") is not None and str(row["from"])[:10] <= end.isoformat() and str(row.get("to") or as_of.isoformat())[:10] >= allocation.issue_date.isoformat() for row in operational)
        assigned_complete = assigned_complete and days is not None and not overlap
        if days is not None and not overlap and not precise:
            assigned_calendar_days.update(allocation.issue_date + timedelta(days=offset) for offset in range(int(days)))
        timeline.append({"id": f"custody-{allocation.id}", "kind": "employee", "title": f"Employee custody · assignment {index}", "from": allocation.created_at.isoformat() if precise else allocation.issue_date.isoformat() if allocation.issue_date else None, "to": allocation.closed_at.isoformat() if precise and allocation.closed_at else allocation.return_date.isoformat() if allocation.return_date else None, "precision": "timestamp" if precise else "date", "active": allocation.return_date is None, "durationDays": days, "durationSeconds": seconds, "employee": allocation.employee.full_name if allocation.employee else None, "employeeCode": (allocation.employee.employee_code or allocation.employee.user_code) if allocation.employee else None, "office": None, "location": None, "actor": {**actors.get(str(allocation.issued_by_id), {"id": str(allocation.issued_by_id)}), "actionAt": allocation.created_at.isoformat()}, "endActor": {**actors.get(str(allocation.received_by_id), {"id": str(allocation.received_by_id)}), "actionAt": allocation.closed_at.isoformat() if allocation.closed_at else None} if allocation.received_by_id else None, "condition": allocation.condition_at_issue, "endCondition": allocation.return_condition, "status": "Employee custody", "reason": None, "note": allocation.issue_remarks, "endNote": allocation.return_remarks, "excludedFromTotals": overlap, "contextSource": "Legacy date-only custody; overlapping records are not summed" if overlap else "Legacy recorded custody; current saved actor details"})
        if precise and not overlap:
            operational.append(timeline.pop())  # A known timestamp interval, counted once.
    # Office responsibility overlaps all asset states: represent transfers as events, never extra duration periods.
    for custody in asset.office_history:
        if any(row.action in ("asset.office.transfer", "asset.create") and isinstance(row.new_values, dict) and str(row.new_values.get("officeId")) == str(custody.office_id) and (row.new_values.get("transferDate") == custody.started_on.isoformat() or row.action == "asset.create") for row in events):
            continue
        timeline.append({"id": f"office-{custody.id}", "kind": "event", "title": "Office custody recorded", "from": custody.started_on.isoformat() if custody.started_on else None, "to": custody.started_on.isoformat() if custody.started_on else None, "precision": "date", "active": False, "durationDays": 0, "durationSeconds": None, "office": custody.office.name if custody.office else None, "employee": None, "location": custody.office.name if custody.office else None, "actor": {**actors.get(str(custody.transferred_by_id), {"id": str(custody.transferred_by_id)}), "actionAt": custody.created_at.isoformat()}, "condition": None, "status": None, "reason": custody.reason, "note": None})
    if not saw_creation:
        timeline.append({"id": "registration", "kind": "event", "title": "Added to system", "from": asset.created_at.isoformat(), "to": asset.created_at.isoformat(), "precision": "timestamp", "active": False, "durationDays": 0, "durationSeconds": 0, "actor": {**actors.get(str(asset.created_by_id), {"id": str(asset.created_by_id) if asset.created_by_id else None}), "actionAt": asset.created_at.isoformat()}, "office": None, "condition": None, "status": None})
    timeline.extend(operational)
    def total(kind: str) -> dict[str, object]:
        rows = [row for row in operational if row["kind"] == kind]
        return {"seconds": sum(row.get("durationSeconds") or 0 for row in rows), "complete": (assigned_complete if kind == "employee" else True) and saw_creation and not gaps and all(row.get("durationSeconds") is not None for row in rows)}
    timeline.sort(key=lambda item: (not bool(item.get("from")), str(item.get("from") or ""), str(item["id"])))
    return {"registeredAt": asset.created_at.isoformat(), "asOf": as_of.isoformat(), "assignments": len(asset.allocations), "assignedDays": len(assigned_calendar_days), "assignedComplete": assigned_complete, "assigned": total("employee"), "stock": total("stock"), "repair": total("repair"), "hasLegacyGaps": not saw_creation or gaps or not assigned_complete, "timeline": timeline}
