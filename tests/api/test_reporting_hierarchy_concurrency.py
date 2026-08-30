from __future__ import annotations

import asyncio
from time import monotonic

import pytest
from helpers import create_activated_user, owner_client
from httpx import AsyncClient
from nexa_bos_api.identity.users_service import REPORTING_HIERARCHY_LOCK_KEY
from nexa_bos_api.main import app
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def _wait_for_advisory_lock_waiters(session: AsyncSession, expected: int) -> None:
    class_id = REPORTING_HIERARCHY_LOCK_KEY >> 32
    object_id = REPORTING_HIERARCHY_LOCK_KEY & 0xFFFFFFFF
    deadline = monotonic() + 5
    while monotonic() < deadline:
        waiting = (
            await session.execute(
                text(
                    """
                    SELECT count(*)
                    FROM pg_locks
                    WHERE locktype = 'advisory'
                      AND classid = :class_id
                      AND objid = :object_id
                      AND objsubid = 1
                      AND granted IS FALSE
                    """
                ),
                {"class_id": class_id, "object_id": object_id},
            )
        ).scalar_one()
        if waiting >= expected:
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"Expected {expected} concurrent hierarchy lock waiters")


@pytest.mark.asyncio
async def test_concurrent_reporting_manager_updates_serialize_and_preserve_rejected_state(
    client: AsyncClient,
) -> None:
    owner, owner_user = await owner_client(client)
    first = await create_activated_user(owner, user_type_code="GM")
    second = await create_activated_user(owner, user_type_code="GM")
    assert first["reportingManagerId"] is None
    assert second["reportingManagerId"] is None

    before = {
        user["id"]: {
            "detail": (await owner.get(f"/api/v1/users/{user['id']}")).json(),
            "history": (await owner.get(f"/api/v1/users/{user['id']}/history")).json(),
        }
        for user in (first, second)
    }

    async with app.state.session_factory() as gate_session:
        await gate_session.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": REPORTING_HIERARCHY_LOCK_KEY},
        )
        first_request = asyncio.create_task(
            owner.patch(
                f"/api/v1/users/{first['id']}",
                json={"reporting_manager_id": second["id"]},
            )
        )
        second_request = asyncio.create_task(
            owner.patch(
                f"/api/v1/users/{second['id']}",
                json={"reporting_manager_id": first["id"]},
            )
        )
        wait_error: BaseException | None = None
        try:
            await _wait_for_advisory_lock_waiters(gate_session, expected=2)
        except BaseException as exc:
            wait_error = exc
        finally:
            await gate_session.rollback()

        first_response, second_response = await asyncio.gather(first_request, second_request)
        if wait_error is not None:
            raise wait_error

    responses = [first_response, second_response]
    assert sorted(response.status_code for response in responses) == [200, 422]
    rejected_response = next(response for response in responses if response.status_code == 422)
    assert rejected_response.json()["error"]["code"] == "HIERARCHY_CYCLE"

    rejected_id = first["id"] if first_response.status_code == 422 else second["id"]
    rejected_after = (await owner.get(f"/api/v1/users/{rejected_id}")).json()
    rejected_history_after = (await owner.get(f"/api/v1/users/{rejected_id}/history")).json()
    assert rejected_after == before[rejected_id]["detail"]
    assert rejected_history_after == before[rejected_id]["history"]

    first_after = (await owner.get(f"/api/v1/users/{first['id']}")).json()
    second_after = (await owner.get(f"/api/v1/users/{second['id']}")).json()
    persisted_edges = {
        (first["id"], first_after["reportingManagerId"]),
        (second["id"], second_after["reportingManagerId"]),
    }
    assert (
        sum(
            edge in persisted_edges
            for edge in ((first["id"], second["id"]), (second["id"], first["id"]))
        )
        == 1
    )

    hierarchy = await owner.get("/api/v1/organization/hierarchy")
    assert hierarchy.status_code == 200, hierarchy.text
    hierarchy_nodes = {node["id"]: node for node in hierarchy.json()["nodes"]}
    assert hierarchy_nodes[first["id"]]["reportingManagerId"] == first_after["reportingManagerId"]
    assert hierarchy_nodes[second["id"]]["reportingManagerId"] == second_after["reportingManagerId"]

    subsequent = await owner.patch(
        f"/api/v1/users/{rejected_id}",
        json={"reporting_manager_id": owner_user["id"]},
    )
    assert subsequent.status_code == 200, subsequent.text
    assert subsequent.json()["reportingManagerId"] == owner_user["id"]
