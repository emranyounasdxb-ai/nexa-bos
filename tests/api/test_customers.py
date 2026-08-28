from __future__ import annotations

import pytest
from httpx import AsyncClient

from helpers import owner_client, unique_tag


async def create_individual(
    client: AsyncClient, *, mobile: str | None = None, create_anyway: bool = False, **extra
) -> object:
    tag = unique_tag()
    payload = {
        "customer_type": "individual",
        "full_name": extra.pop("full_name", f"Person {tag}"),
        "mobile": mobile or f"+97150{tag[:8]}",
        "email": extra.pop("email", f"cust-{tag}@example.com"),
        "create_anyway": create_anyway,
        **extra,
    }
    return await client.post("/api/v1/customers", json=payload)


@pytest.mark.asyncio
async def test_customer_code_and_type_rules(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    created = await create_individual(authed)
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["customerCode"].startswith("CUS-")
    assert body["status"] == "Active"
    assert body["customerType"] == "individual"
    listed = await authed.get("/api/v1/customers")
    assert any(item["id"] == body["id"] for item in listed.json()["items"])
    patched = await authed.patch(
        f"/api/v1/customers/{body['id']}", json={"customer_type": "company"}
    )
    assert patched.status_code == 200
    assert patched.json()["customerType"] == "individual"
    deleted = await authed.delete(f"/api/v1/customers/{body['id']}")
    assert deleted.status_code == 405
    assert deleted.json()["error"]["code"] == "CUSTOMER_DELETE_FORBIDDEN"


@pytest.mark.asyncio
async def test_company_required_fields_and_search(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag()
    missing = await authed.post(
        "/api/v1/customers",
        json={"customer_type": "company", "company_name": "Acme", "mobile": "+971500000111"},
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "CUSTOMER_CONTACT_PERSON_REQUIRED"
    created = await authed.post(
        "/api/v1/customers",
        json={
            "customer_type": "company",
            "company_name": f"Acme {tag}",
            "contact_person": "Fatima",
            "mobile": f"+97150{tag[:8]}",
            "trade_license": f"TL-{tag}",
        },
    )
    assert created.status_code == 200, created.text
    found = await authed.get(f"/api/v1/customers?q=TL-{tag}")
    assert found.json()["items"][0]["id"] == created.json()["id"]


@pytest.mark.asyncio
async def test_identifier_unique_across_history(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag().upper()
    first = await create_individual(authed, emirates_id=f"784-{tag}")
    assert first.status_code == 200, first.text
    changed = await authed.patch(
        f"/api/v1/customers/{first.json()['id']}",
        json={"emirates_id": f"784-NEW-{tag}"},
    )
    assert changed.status_code == 200, changed.text
    history = await authed.get(f"/api/v1/customers/{first.json()['id']}/history")
    kinds = {row["kind"] for row in history.json()["identifiers"]}
    assert "emirates_id" in kinds
    second = await create_individual(authed, emirates_id=f"784-{tag}")
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "CUSTOMER_IDENTIFIER_DUPLICATE"


@pytest.mark.asyncio
async def test_duplicate_warning_and_create_anyway(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag()
    mobile = f"+97150{tag[:8]}"
    first = await create_individual(authed, mobile=mobile, full_name=f"Same {tag}")
    assert first.status_code == 200, first.text
    warned = await create_individual(authed, mobile=mobile, full_name=f"Same {tag}")
    assert warned.status_code == 409
    assert warned.json()["error"]["code"] == "CUSTOMER_DUPLICATE_WARNING"
    assert warned.json()["error"]["details"]
    forced = await create_individual(
        authed, mobile=mobile, full_name=f"Same {tag}", create_anyway=True
    )
    assert forced.status_code == 200, forced.text
    assert forced.json()["id"] != first.json()["id"]


@pytest.mark.asyncio
async def test_merge_retires_code_and_is_irreversible(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    source = await create_individual(authed)
    primary = await create_individual(authed)
    assert source.status_code == 200 and primary.status_code == 200
    source_code = source.json()["customerCode"]
    merged = await authed.post(
        f"/api/v1/customers/{source.json()['id']}/merge",
        json={"primary_customer_id": primary.json()["id"]},
    )
    assert merged.status_code == 200, merged.text
    assert merged.json()["status"] == "Merged"
    assert merged.json()["mergedIntoId"] == primary.json()["id"]
    again = await authed.post(
        f"/api/v1/customers/{source.json()['id']}/merge",
        json={"primary_customer_id": primary.json()["id"]},
    )
    assert again.status_code == 422
    assert again.json()["error"]["code"] == "CUSTOMER_MERGED"
    edit = await authed.patch(
        f"/api/v1/customers/{source.json()['id']}", json={"full_name": "Nope"}
    )
    assert edit.status_code == 422
    codes = {item["customerCode"] for item in (await authed.get("/api/v1/customers")).json()["items"]}
    assert source_code in codes
    newest = await create_individual(authed)
    assert newest.json()["customerCode"] != source_code


@pytest.mark.asyncio
async def test_deactivate_allowed_until_applications_exist(client: AsyncClient) -> None:
    """Deactivation blocking against Applications is deferred to Task 5."""
    authed, _owner = await owner_client(client)
    created = await create_individual(authed)
    deactivated = await authed.post(f"/api/v1/customers/{created.json()['id']}/deactivate")
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["status"] == "Inactive"
    activated = await authed.post(f"/api/v1/customers/{created.json()['id']}/activate")
    assert activated.json()["status"] == "Active"
