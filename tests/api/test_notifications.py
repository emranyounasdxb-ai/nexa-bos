from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from helpers import (
    authenticate,
    create_activated_user,
    office_id,
    owner_client,
    spawned_client,
    unique_tag,
)
from httpx import AsyncClient
from nexa_bos_api.attendance.calc import business_today
from nexa_bos_api.attendance.models import (
    HolidayReminder,
    HolidayReminderDismissal,
    OfficialHoliday,
)
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.db.session import create_engine, create_session_factory
from nexa_bos_api.identity.models import AuditEvent
from nexa_bos_api.notifications.enums import NotificationEventType
from nexa_bos_api.notifications.models import (
    Notification,
    NotificationDelivery,
    NotificationRule,
    NotificationRuleTarget,
)
from nexa_bos_api.notifications.service import dispatch_source_event
from sqlalchemy import delete, func, select
from test_applications import _catalog, _create_app, _customer
from test_tat_delay import _move


async def _clear_notifications() -> None:
    engine = create_engine(get_settings())
    factory = create_session_factory(engine)
    try:
        async with factory() as session:
            await session.execute(delete(NotificationDelivery))
            await session.execute(delete(Notification))
            await session.execute(delete(NotificationRuleTarget))
            await session.execute(delete(NotificationRule))
            test_holiday_ids = select(OfficialHoliday.id).where(
                OfficialHoliday.name.like("Notify %")
            )
            test_reminder_ids = select(HolidayReminder.id).where(
                HolidayReminder.holiday_id.in_(test_holiday_ids)
            )
            await session.execute(
                delete(HolidayReminderDismissal).where(
                    HolidayReminderDismissal.reminder_id.in_(test_reminder_ids)
                )
            )
            await session.execute(
                delete(HolidayReminder).where(HolidayReminder.holiday_id.in_(test_holiday_ids))
            )
            await session.execute(
                delete(OfficialHoliday).where(OfficialHoliday.id.in_(test_holiday_ids))
            )
            await session.commit()
    finally:
        await engine.dispose()


@asynccontextmanager
async def _notification_session() -> AsyncIterator[object]:
    engine = create_engine(get_settings())
    factory = create_session_factory(engine)
    try:
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()


@pytest.fixture(autouse=True)
async def isolate_notifications() -> None:
    await _clear_notifications()
    yield
    await _clear_notifications()


async def _notification_user(
    owner: AsyncClient,
    *,
    permissions: list[str],
    scope: str = "own",
    office: str | None = None,
    department: str | None = None,
    team: str | None = None,
    manager: str | None = None,
    can_manage: bool = False,
    can_own: bool = False,
) -> tuple[dict, dict]:
    tag = unique_tag().upper()
    created = await owner.post(
        "/api/v1/user-types",
        json={
            "name": f"Notify {tag}",
            "code": f"N{tag[:8]}",
            "can_be_reporting_manager": can_manage,
            "can_be_case_owner": can_own,
        },
    )
    assert created.status_code == 200, created.text
    user_type = created.json()
    assert (await owner.post(f"/api/v1/user-types/{user_type['id']}/activate")).status_code == 200
    assigned = await owner.put(
        f"/api/v1/user-types/{user_type['id']}/permissions",
        json={"permissions": permissions},
    )
    assert assigned.status_code == 200, assigned.text
    scoped = await owner.put(
        f"/api/v1/user-types/{user_type['id']}/scope",
        json={"visibility_scope": scope},
    )
    assert scoped.status_code == 200, scoped.text
    user = await create_activated_user(
        owner,
        user_type_code=user_type["code"],
        office_id=office,
        department_id=department,
        team_id=team,
        manager_id=manager,
    )
    return user, user_type


async def _team(owner: AsyncClient, office: str) -> tuple[str, str]:
    tag = unique_tag().upper()
    department = await owner.post(
        "/api/v1/departments",
        json={"office_id": office, "name": f"Notify {tag}", "code": f"ND{tag[:6]}"},
    )
    assert department.status_code == 200, department.text
    team = await owner.post(
        "/api/v1/teams",
        json={
            "office_id": office,
            "department_id": department.json()["id"],
            "name": f"Notify Team {tag}",
            "code": f"NT{tag[:6]}",
        },
    )
    assert team.status_code == 200, team.text
    return department.json()["id"], team.json()["id"]


def _urgent_payload(
    title: str,
    targets: list[dict[str, object]],
    *,
    affected_user_id: str | None = None,
    acknowledgement_required: bool = False,
    category: str = "operations",
) -> dict[str, object]:
    return {
        "category": category,
        "title": title,
        "message": f"{title} message",
        "acknowledgement_required": acknowledgement_required,
        "affected_user_id": affected_user_id,
        "targets": targets,
    }


def _rule_payload(name: str, target: dict[str, object]) -> dict[str, object]:
    return {
        "name": name,
        "event_type": "operations.application_stage_changed",
        "severity": "warning",
        "title": f"{name} title",
        "message": f"{name} message",
        "acknowledgement_required": False,
        "targets": [target],
    }


def _assert_rule_not_found(response) -> None:
    assert response.status_code == 404, response.text
    assert response.json()["error"] == {
        "code": "NOTIFICATION_RULE_NOT_FOUND",
        "message": "Notification rule was not found",
        "details": [],
        "requestId": response.json()["error"]["requestId"],
    }


@pytest.mark.asyncio
async def test_rule_update_preserves_an_unchanged_target(client: AsyncClient) -> None:
    owner, _ = await owner_client(client)
    target = {"target_type": "company", "target_id": None}
    original = _rule_payload(f"Stable target {unique_tag()}", target)
    created = await owner.post("/api/v1/notifications/rules", json=original)
    assert created.status_code == 200, created.text

    edited = {**original, "name": f"Edited stable target {unique_tag()}"}
    updated = await owner.put(
        f"/api/v1/notifications/rules/{created.json()['id']}",
        json=edited,
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == edited["name"]
    assert updated.json()["targets"] == [{"targetType": "company", "targetId": None, "label": None}]


@pytest.mark.asyncio
async def test_notification_center_read_ack_permissions_csrf_and_idor(
    client: AsyncClient,
) -> None:
    owner, _owner = await owner_client(client)
    manager, _ = await _notification_user(
        owner,
        permissions=["Notifications.View"],
        can_manage=True,
    )
    affected, _ = await _notification_user(
        owner,
        permissions=["Notifications.View"],
        manager=manager["id"],
    )
    sent = await owner.post(
        "/api/v1/notifications/urgent",
        json=_urgent_payload(
            "Action required",
            [
                {"target_type": "affected_user", "target_id": None},
                {"target_type": "reporting_manager", "target_id": None},
            ],
            affected_user_id=affected["id"],
            acknowledgement_required=True,
        ),
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["recipientCount"] == 2

    async with await spawned_client() as affected_client, await spawned_client() as manager_client:
        await authenticate(affected_client, affected["email"], "UserPass1!")
        await authenticate(manager_client, manager["email"], "UserPass1!")
        assert (await affected_client.get("/api/v1/notifications/unread-count")).json() == {
            "unreadCount": 1
        }
        affected_item = (await affected_client.get("/api/v1/notifications")).json()["items"][0]
        manager_item = (await manager_client.get("/api/v1/notifications")).json()["items"][0]
        assert affected_item["severity"] == "urgent"
        assert affected_item["acknowledgementRequired"] is True
        manager_ack = await manager_client.post(
            f"/api/v1/notifications/{manager_item['id']}/acknowledge"
        )
        assert manager_ack.status_code == 200, manager_ack.text
        assert manager_ack.json()["acknowledged"] is True
        assert manager_ack.json()["unread"] is True
        read = await affected_client.post(f"/api/v1/notifications/{affected_item['id']}/read")
        assert read.status_code == 200
        assert read.json()["unread"] is False
        assert read.json()["acknowledged"] is False
        acknowledged = await affected_client.post(
            f"/api/v1/notifications/{affected_item['id']}/acknowledge"
        )
        assert acknowledged.status_code == 200, acknowledged.text
        assert acknowledged.json()["acknowledged"] is True
        assert acknowledged.json()["readAt"] is not None
        hidden_ack = await affected_client.post(
            f"/api/v1/notifications/{manager_item['id']}/acknowledge"
        )
        assert hidden_ack.status_code == 404
        assert hidden_ack.json()["error"]["code"] == "NOTIFICATION_NOT_FOUND"
        assert (await affected_client.get("/api/v1/notifications/rules")).status_code == 403
        assert (
            await affected_client.post(
                "/api/v1/notifications/urgent",
                json=_urgent_payload(
                    "Forbidden",
                    [{"target_type": "affected_user", "target_id": None}],
                    affected_user_id=affected["id"],
                ),
            )
        ).status_code == 403
        assert (await affected_client.get("/api/v1/notifications/audit")).status_code == 403
        assert (
            await affected_client.delete(f"/api/v1/notifications/{affected_item['id']}")
        ).status_code in {404, 405}

        affected_client.headers.pop("X-CSRF-Token")
        csrf = await affected_client.post(f"/api/v1/notifications/{affected_item['id']}/read")
        assert csrf.status_code == 403
        assert csrf.json()["error"]["code"] == "CSRF_INVALID"

        second = await owner.post(
            "/api/v1/notifications/urgent",
            json=_urgent_payload(
                "Second notification",
                [{"target_type": "affected_user", "target_id": None}],
                affected_user_id=affected["id"],
            ),
        )
        assert second.status_code == 200, second.text
        current = await affected_client.get("/api/v1/auth/me")
        affected_client.headers["X-CSRF-Token"] = current.json()["csrfToken"]
        assert (await affected_client.get("/api/v1/notifications/unread-count")).json() == {
            "unreadCount": 1
        }
        read_all = await affected_client.post("/api/v1/notifications/read-all")
        assert read_all.status_code == 200
        assert read_all.json() == {"markedRead": 1}

    anonymous = await spawned_client()
    assert (await anonymous.get("/api/v1/notifications")).status_code == 401
    await anonymous.aclose()
    mass_assignment = await owner.post(
        "/api/v1/notifications/urgent",
        json={
            **_urgent_payload(
                "Mass assignment",
                [{"target_type": "company", "target_id": None}],
            ),
            "recipient_ids": [affected["id"]],
        },
    )
    assert mass_assignment.status_code == 422
    audit = await owner.get("/api/v1/notifications/audit")
    assert audit.status_code == 200
    actions = {row["action"] for row in audit.json()["items"]}
    assert {"notification.urgent.send", "notification.acknowledge"} <= actions


@pytest.mark.asyncio
async def test_recipient_types_and_scope_tampering_are_server_controlled(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    dxb = await office_id(owner, "DXB")
    auh = await office_id(owner, "AUH")
    department, team = await _team(owner, dxb)
    first, viewer_type = await _notification_user(
        owner,
        permissions=["Notifications.View"],
        scope="company",
        office=dxb,
        department=department,
        team=team,
    )
    second = await create_activated_user(
        owner,
        user_type_code=viewer_type["code"],
        office_id=dxb,
        department_id=department,
        team_id=team,
    )
    other_office, _ = await _notification_user(
        owner,
        permissions=["Notifications.View"],
        office=auh,
    )

    cases = (
        ("User type delivery", {"target_type": "user_type", "target_id": viewer_type["id"]}),
        ("Office delivery", {"target_type": "office", "target_id": dxb}),
        ("Team delivery", {"target_type": "team", "target_id": team}),
        ("Company delivery", {"target_type": "company", "target_id": None}),
    )
    for title, target in cases:
        response = await owner.post(
            "/api/v1/notifications/urgent",
            json=_urgent_payload(title, [target]),
        )
        assert response.status_code == 200, response.text

    for user in (first, second):
        async with await spawned_client() as scoped:
            await authenticate(scoped, user["email"], "UserPass1!")
            response = await scoped.get("/api/v1/notifications")
            titles = {item["title"] for item in response.json()["items"]}
            assert {title for title, _target in cases} <= titles
    async with await spawned_client() as scoped:
        await authenticate(scoped, other_office["email"], "UserPass1!")
        response = await scoped.get("/api/v1/notifications")
        titles = {item["title"] for item in response.json()["items"]}
        assert "Company delivery" in titles
        assert "Office delivery" not in titles
        assert "Team delivery" not in titles

    sender, _ = await _notification_user(
        owner,
        permissions=["Notifications.View", "Notifications.SendUrgent"],
        scope="office",
        office=dxb,
    )
    async with await spawned_client() as scoped:
        await authenticate(scoped, sender["email"], "UserPass1!")
        for target in (
            {"target_type": "company", "target_id": None},
            {"target_type": "user_type", "target_id": viewer_type["id"]},
            {"target_type": "office", "target_id": auh},
        ):
            blocked = await scoped.post(
                "/api/v1/notifications/urgent",
                json=_urgent_payload("Blocked scope", [target]),
            )
            assert blocked.status_code == 403
            assert blocked.json()["error"]["code"] == "NOTIFICATION_TARGET_OUT_OF_SCOPE"
        hidden = await scoped.post(
            "/api/v1/notifications/urgent",
            json=_urgent_payload(
                "Hidden user",
                [{"target_type": "affected_user", "target_id": None}],
                affected_user_id=other_office["id"],
            ),
        )
        assert hidden.status_code == 404
        random_target = await scoped.post(
            "/api/v1/notifications/urgent",
            json=_urgent_payload(
                "Random office",
                [{"target_type": "office", "target_id": str(uuid4())}],
            ),
        )
        assert random_target.status_code == 404
        manipulated = await scoped.post(
            "/api/v1/notifications/urgent",
            json=_urgent_payload(
                "Manipulated",
                [{"target_type": "affected_user", "target_id": other_office["id"]}],
            ),
        )
        assert manipulated.status_code == 422
        allowed = await scoped.post(
            "/api/v1/notifications/urgent",
            json=_urgent_payload(
                "Own office",
                [{"target_type": "office", "target_id": dxb}],
            ),
        )
        assert allowed.status_code == 200, allowed.text


@pytest.mark.asyncio
async def test_company_rule_cannot_be_taken_over_by_office_admin(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    dxb = await office_id(owner, "DXB")
    permissions = ["Notifications.View", "Notifications.ManageRules", "Users.View"]
    company_admin, _ = await _notification_user(
        owner,
        permissions=permissions,
        scope="company",
        office=dxb,
    )
    office_admin, _ = await _notification_user(
        owner,
        permissions=permissions,
        scope="office",
        office=dxb,
    )

    async with await spawned_client() as company_client, await spawned_client() as office_client:
        await authenticate(company_client, company_admin["email"], "UserPass1!")
        await authenticate(office_client, office_admin["email"], "UserPass1!")
        assert (await office_client.get(f"/api/v1/users/{company_admin['id']}")).status_code == 200

        original = _rule_payload(
            "Company controlled rule",
            {"target_type": "company", "target_id": None},
        )
        created = await company_client.post("/api/v1/notifications/rules", json=original)
        assert created.status_code == 200, created.text
        rule_id = created.json()["id"]
        activated = await company_client.post(f"/api/v1/notifications/rules/{rule_id}/activate")
        assert activated.status_code == 200, activated.text

        async with _notification_session() as session:
            await dispatch_source_event(
                session,
                event_type=NotificationEventType.APPLICATION_STAGE_CHANGED,
                source_event_key=f"bola:{uuid4()}",
                affected_user_id=None,
                linked_entity_type=None,
                linked_entity_id=None,
                contextual_link=None,
                actor_id=UUID(company_admin["id"]),
            )
            await session.commit()
            deliveries_before = set(
                (
                    await session.execute(
                        select(
                            NotificationDelivery.id,
                            NotificationDelivery.notification_id,
                            NotificationDelivery.recipient_id,
                            NotificationDelivery.read_at,
                            NotificationDelivery.acknowledged_at,
                        )
                        .join(Notification)
                        .where(Notification.rule_id == UUID(rule_id))
                    )
                ).all()
            )
            audits_before = set(
                (
                    await session.execute(
                        select(AuditEvent.id, AuditEvent.action).where(
                            AuditEvent.entity_type == "notification_rule",
                            AuditEvent.entity_id == rule_id,
                        )
                    )
                ).all()
            )
        assert deliveries_before

        listed = await office_client.get("/api/v1/notifications/rules")
        assert listed.status_code == 200, listed.text
        assert rule_id not in {row["id"] for row in listed.json()["items"]}
        _assert_rule_not_found(await office_client.get(f"/api/v1/notifications/rules/{rule_id}"))
        narrowed = _rule_payload(
            "Office takeover attempt",
            {"target_type": "office", "target_id": dxb},
        )
        _assert_rule_not_found(
            await office_client.put(
                f"/api/v1/notifications/rules/{rule_id}",
                json=narrowed,
            )
        )
        _assert_rule_not_found(
            await office_client.post(f"/api/v1/notifications/rules/{rule_id}/activate")
        )
        _assert_rule_not_found(
            await office_client.post(f"/api/v1/notifications/rules/{rule_id}/deactivate")
        )

        unchanged = await company_client.get(f"/api/v1/notifications/rules/{rule_id}")
        assert unchanged.status_code == 200, unchanged.text
        assert unchanged.json()["name"] == original["name"]
        assert unchanged.json()["status"] == "active"
        assert unchanged.json()["targets"] == [
            {"targetType": "company", "targetId": None, "label": None}
        ]
        async with _notification_session() as session:
            deliveries_after = set(
                (
                    await session.execute(
                        select(
                            NotificationDelivery.id,
                            NotificationDelivery.notification_id,
                            NotificationDelivery.recipient_id,
                            NotificationDelivery.read_at,
                            NotificationDelivery.acknowledged_at,
                        )
                        .join(Notification)
                        .where(Notification.rule_id == UUID(rule_id))
                    )
                ).all()
            )
            audits_after = set(
                (
                    await session.execute(
                        select(AuditEvent.id, AuditEvent.action).where(
                            AuditEvent.entity_type == "notification_rule",
                            AuditEvent.entity_id == rule_id,
                        )
                    )
                ).all()
            )
        assert deliveries_after == deliveries_before
        assert audits_after == audits_before

        assert (
            await company_client.post(f"/api/v1/notifications/rules/{rule_id}/deactivate")
        ).status_code == 200
        assert (
            await company_client.post(f"/api/v1/notifications/rules/{rule_id}/activate")
        ).status_code == 200


@pytest.mark.asyncio
async def test_rule_management_uses_complete_target_reach_not_creator_visibility(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    dxb = await office_id(owner, "DXB")
    auh = await office_id(owner, "AUH")
    department, team = await _team(owner, dxb)
    _auh_department, auh_team = await _team(owner, auh)
    permissions = ["Notifications.View", "Notifications.ManageRules", "Users.View"]
    company_admin, company_type = await _notification_user(
        owner,
        permissions=permissions,
        scope="company",
        office=dxb,
        department=department,
        team=team,
    )
    office_admin, _ = await _notification_user(
        owner,
        permissions=permissions,
        scope="office",
        office=dxb,
        department=department,
        team=team,
    )
    targets = {
        "Company reach": {"target_type": "company", "target_id": None},
        "User Type reach": {"target_type": "user_type", "target_id": company_type["id"]},
        "Office reach": {"target_type": "office", "target_id": dxb},
        "Team reach": {"target_type": "team", "target_id": team},
        "Other office reach": {"target_type": "office", "target_id": auh},
        "Other team reach": {"target_type": "team", "target_id": auh_team},
        "Affected user reach": {"target_type": "affected_user", "target_id": None},
        "Reporting manager reach": {
            "target_type": "reporting_manager",
            "target_id": None,
        },
    }

    async with await spawned_client() as company_client, await spawned_client() as office_client:
        await authenticate(company_client, company_admin["email"], "UserPass1!")
        await authenticate(office_client, office_admin["email"], "UserPass1!")
        assert (await office_client.get(f"/api/v1/users/{company_admin['id']}")).status_code == 200
        created: dict[str, str] = {}
        for name, target in targets.items():
            response = await company_client.post(
                "/api/v1/notifications/rules",
                json=_rule_payload(name, target),
            )
            assert response.status_code == 200, response.text
            created[name] = response.json()["id"]

        company_rows = await company_client.get("/api/v1/notifications/rules")
        assert set(created.values()) <= {row["id"] for row in company_rows.json()["items"]}
        office_rows = await office_client.get("/api/v1/notifications/rules")
        visible_ids = {row["id"] for row in office_rows.json()["items"]}
        assert created["Office reach"] in visible_ids
        assert created["Team reach"] in visible_ids
        for name in ("Office reach", "Team reach"):
            allowed = await office_client.get(f"/api/v1/notifications/rules/{created[name]}")
            assert allowed.status_code == 200, allowed.text
        hidden_names = {
            "Company reach",
            "User Type reach",
            "Other office reach",
            "Other team reach",
            "Affected user reach",
            "Reporting manager reach",
        }
        assert {created[name] for name in hidden_names}.isdisjoint(visible_ids)
        for name in hidden_names:
            _assert_rule_not_found(
                await office_client.get(f"/api/v1/notifications/rules/{created[name]}")
            )


@pytest.mark.asyncio
async def test_rules_all_categories_severities_source_link_and_duplicate_suppression(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    manager, _ = await _notification_user(
        owner,
        permissions=["Notifications.View"],
        can_manage=True,
    )
    case_owner, _ = await _notification_user(
        owner,
        permissions=["Notifications.View"],
        manager=manager["id"],
        can_own=True,
    )
    rule_body = {
        "name": "Application stage alert",
        "event_type": "operations.application_stage_changed",
        "severity": "critical",
        "title": "Application stage changed",
        "message": "An application assigned to you changed stage.",
        "acknowledgement_required": True,
        "targets": [
            {"target_type": "affected_user", "target_id": None},
            {"target_type": "reporting_manager", "target_id": None},
        ],
    }
    created = await owner.post("/api/v1/notifications/rules", json=rule_body)
    assert created.status_code == 200, created.text
    assert created.json()["category"] == "operations"
    activated = await owner.post(f"/api/v1/notifications/rules/{created.json()['id']}/activate")
    assert activated.status_code == 200, activated.text

    dib, _eib, pf, _cc = await _catalog(owner)
    application = await _create_app(
        owner,
        customer_id=(await _customer(owner, "Notify"))["id"],
        bank_id=dib["id"],
        product_id=pf["id"],
        case_owner_id=case_owner["id"],
    )
    submitted = await owner.post(
        f"/api/v1/applications/{application['id']}/case-number",
        json={"bank_case_number": f"NOT-{unique_tag()}"},
    )
    assert submitted.status_code == 200, submitted.text
    await _move(owner, application, "approved", {"approved_amount": "1000.00"})

    async with await spawned_client() as scoped:
        await authenticate(scoped, case_owner["email"], "UserPass1!")
        item = (await scoped.get("/api/v1/notifications")).json()["items"][0]
        assert item["category"] == "operations"
        assert item["severity"] == "critical"
        assert item["contextualLink"] == f"/applications/{application['id']}"
        assert application["applicationCode"] not in item["message"]
        destination = await scoped.get(f"/api/v1/applications/{application['id']}")
        assert destination.status_code == 403

    async with _notification_session() as session:
        notification = (
            await session.execute(
                select(Notification).where(Notification.rule_id == UUID(created.json()["id"]))
            )
        ).scalar_one()
        before = await session.scalar(
            select(func.count())
            .select_from(NotificationDelivery)
            .where(NotificationDelivery.notification_id == notification.id)
        )
        await dispatch_source_event(
            session,
            event_type=NotificationEventType.APPLICATION_STAGE_CHANGED,
            source_event_key=notification.source_event_key,
            affected_user_id=UUID(case_owner["id"]),
            linked_entity_type="application",
            linked_entity_id=application["id"],
            contextual_link=f"/applications/{application['id']}",
            actor_id=None,
        )
        await session.commit()
        after = await session.scalar(
            select(func.count())
            .select_from(NotificationDelivery)
            .where(NotificationDelivery.notification_id == notification.id)
        )
        assert before == after == 2

    event_cases = (
        ("performance.target_status_changed", "info", "Performance"),
        ("finance.period_status_changed", "warning", "Finance"),
        ("attendance.record_corrected", "critical", "Attendance"),
        ("security.user_status_changed", "urgent", "Security"),
    )
    for event_type, severity, title in event_cases:
        body = {
            "name": f"{title} rule",
            "event_type": event_type,
            "severity": severity,
            "title": f"{title} alert",
            "message": f"{title} source event occurred.",
            "acknowledgement_required": severity in {"critical", "urgent"},
            "targets": [{"target_type": "company", "target_id": None}],
        }
        rule = await owner.post("/api/v1/notifications/rules", json=body)
        assert rule.status_code == 200, rule.text
        activate = await owner.post(f"/api/v1/notifications/rules/{rule.json()['id']}/activate")
        assert activate.status_code == 200
        async with _notification_session() as session:
            await dispatch_source_event(
                session,
                event_type=NotificationEventType(event_type),
                source_event_key=f"test:{uuid4()}",
                affected_user_id=UUID(case_owner["id"]),
                linked_entity_type=None,
                linked_entity_id=None,
                contextual_link=None,
                actor_id=None,
            )
            await session.commit()
    owner_items = (await owner.get("/api/v1/notifications")).json()["items"]
    assert {item["category"] for item in owner_items} >= {
        "performance",
        "finance",
        "attendance_holiday",
        "security_admin",
    }
    assert {item["severity"] for item in owner_items} >= {
        "info",
        "warning",
        "critical",
        "urgent",
    }

    manager_rule = await owner.post(
        "/api/v1/notifications/rules",
        json={
            "name": "Manager account status rule",
            "event_type": "security.user_status_changed",
            "severity": "warning",
            "title": "Direct report account status changed",
            "message": "A direct report account status changed.",
            "acknowledgement_required": False,
            "targets": [{"target_type": "reporting_manager", "target_id": None}],
        },
    )
    assert manager_rule.status_code == 200, manager_rule.text
    manager_activation = await owner.post(
        f"/api/v1/notifications/rules/{manager_rule.json()['id']}/activate"
    )
    assert manager_activation.status_code == 200, manager_activation.text
    deactivated = await owner.post(f"/api/v1/users/{case_owner['id']}/deactivate")
    assert deactivated.status_code == 200, deactivated.text
    async with await spawned_client() as scoped:
        await authenticate(scoped, manager["email"], "UserPass1!")
        manager_titles = {
            item["title"] for item in (await scoped.get("/api/v1/notifications")).json()["items"]
        }
        assert "Direct report account status changed" in manager_titles


@pytest.mark.asyncio
async def test_holiday_window_urgent_dedup_and_existing_dismissal_integration(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    existing = await owner.get("/api/v1/attendance/holidays")
    assert existing.status_code == 200, existing.text
    occupied = {row["holidayDate"] for row in existing.json()["items"]}
    days_until = next(
        offset
        for offset in range(8)
        if (business_today() + timedelta(days=offset)).isoformat() not in occupied
    )
    holiday_date = business_today() + timedelta(days=days_until)
    holiday_name = f"Notify {unique_tag()}"
    holiday = await owner.post(
        "/api/v1/attendance/holidays",
        json={"holiday_date": holiday_date.isoformat(), "name": holiday_name},
    )
    assert holiday.status_code == 200, holiday.text
    first_user, _ = await _notification_user(
        owner,
        permissions=["Notifications.View", "Attendance.View"],
    )
    second_user, _ = await _notification_user(
        owner,
        permissions=["Notifications.View", "Attendance.View"],
    )
    async with await spawned_client() as first_client, await spawned_client() as second_client:
        await authenticate(first_client, first_user["email"], "UserPass1!")
        await authenticate(second_client, second_user["email"], "UserPass1!")
        first, second = await asyncio.gather(
            first_client.get("/api/v1/attendance/reminders"),
            second_client.get("/api/v1/attendance/reminders"),
        )
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    reminder = next(
        row for row in first.json()["items"] if row["holiday"]["id"] == holiday.json()["id"]
    )
    assert reminder["daysUntil"] == days_until
    notification_items = (await owner.get("/api/v1/notifications")).json()["items"]
    assert (
        len(
            [
                row
                for row in notification_items
                if row["title"] == "Upcoming holiday" and holiday_name in row["message"]
            ]
        )
        == 1
    )
    await owner.get("/api/v1/attendance/reminders")
    repeated = (await owner.get("/api/v1/notifications")).json()["items"]
    assert (
        len(
            [
                row
                for row in repeated
                if row["title"] == "Upcoming holiday" and holiday_name in row["message"]
            ]
        )
        == 1
    )

    dismissed = await owner.post(f"/api/v1/attendance/reminders/{reminder['id']}/dismiss")
    assert dismissed.status_code == 200
    center = await owner.get("/api/v1/notifications")
    automatic = next(
        row
        for row in center.json()["items"]
        if row["title"] == "Upcoming holiday" and holiday_name in row["message"]
    )
    assert automatic["unread"] is False

    urgent = await owner.post(f"/api/v1/attendance/holidays/{holiday.json()['id']}/urgent-reminder")
    assert urgent.status_code == 200, urgent.text
    repeated_urgent = await owner.post(
        f"/api/v1/attendance/holidays/{holiday.json()['id']}/urgent-reminder"
    )
    assert repeated_urgent.status_code == 200
    center = (await owner.get("/api/v1/notifications")).json()["items"]
    urgent_rows = [
        row
        for row in center
        if row["title"] == "Urgent holiday reminder" and holiday_name in row["message"]
    ]
    assert len(urgent_rows) == 1
    assert urgent_rows[0]["severity"] == "urgent"
    assert urgent_rows[0]["contextualLink"] == "/attendance/holidays"

    no_urgent, _ = await _notification_user(
        owner,
        permissions=["Notifications.View", "Attendance.View"],
    )
    async with await spawned_client() as scoped:
        await authenticate(scoped, no_urgent["email"], "UserPass1!")
        forbidden = await scoped.post(
            f"/api/v1/attendance/holidays/{holiday.json()['id']}/urgent-reminder"
        )
        assert forbidden.status_code == 403
