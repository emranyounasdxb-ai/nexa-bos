from __future__ import annotations

import asyncio

import pytest
from helpers import owner_client, unique_tag
from httpx import AsyncClient


async def _created(client: AsyncClient, path: str, payload: dict[str, object]) -> dict:
    response = await client.post(path, json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["code"]
    return body


@pytest.mark.asyncio
async def test_authenticated_master_creates_generate_collision_safe_immutable_codes(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    tag = unique_tag().upper()

    office = await _created(owner, "/api/v1/offices", {"name": f"Automated Office {tag}"})
    department = await _created(
        owner,
        "/api/v1/departments",
        {"name": f"Automated Department {tag}", "office_id": office["id"]},
    )
    business_unit = await _created(
        owner,
        "/api/v1/business-units",
        {
            "name": f"Automated Business Unit {tag}",
            "office_id": office["id"],
            "department_id": department["id"],
        },
    )
    await _created(
        owner,
        "/api/v1/teams",
        {
            "name": f"Automated Team {tag}",
            "office_id": office["id"],
            "department_id": department["id"],
            "business_unit_id": business_unit["id"],
        },
    )
    await _created(owner, "/api/v1/designations", {"name": f"Automated Designation {tag}"})
    await _created(owner, "/api/v1/user-types", {"name": f"Automated User Type {tag}"})

    bank = await _created(owner, "/api/v1/banks", {"name": f"Automated Bank {tag}"})
    original_code = bank["code"]
    renamed = await owner.patch(f"/api/v1/banks/{bank['id']}", json={"name": f"Renamed Bank {tag}"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["code"] == original_code

    collision_one = await _created(owner, "/api/v1/banks", {"name": f"Collision Bank {tag}"})
    collision_two = await _created(owner, "/api/v1/banks", {"name": f"Collision-Bank {tag}"})
    assert collision_two["code"] == f"{collision_one['code']}_2"

    concurrent_names = [f"Concurrent Bank {tag}", f"Concurrent-Bank {tag}"]
    concurrent_responses = await asyncio.gather(
        *(owner.post("/api/v1/banks", json={"name": name}) for name in concurrent_names)
    )
    assert [response.status_code for response in concurrent_responses] == [200, 200]
    concurrent_codes = {response.json()["code"] for response in concurrent_responses}
    assert concurrent_codes == {
        f"CONCURRENT_BANK_{tag}",
        f"CONCURRENT_BANK_{tag}_2",
    }

    product = await _created(owner, "/api/v1/products", {"name": f"Automated Product {tag}"})
    mapping_response = await owner.post(
        "/api/v1/bank-products",
        json={"bank_id": bank["id"], "product_id": product["id"]},
    )
    assert mapping_response.status_code == 200, mapping_response.text
    mapping = mapping_response.json()
    await _created(
        owner,
        "/api/v1/product-variants",
        {"name": f"Automated Variant {tag}", "bank_product_id": mapping["id"]},
    )

    workflow_response = await owner.post(
        "/api/v1/workflows",
        json={"bank_id": bank["id"], "product_id": product["id"]},
    )
    assert workflow_response.status_code == 200, workflow_response.text
    await _created(
        owner,
        f"/api/v1/workflows/{workflow_response.json()['id']}/stages",
        {"name": f"Automated Review {tag}", "sort_order": 10},
    )

    await _created(
        owner,
        "/api/v1/assets/categories",
        {"name": f"Automated Asset Category {tag}", "fields": []},
    )
    await _created(
        owner,
        "/api/v1/attendance/leave-types",
        {"name": f"Automated Leave Type {tag}"},
    )
    await _created(
        owner,
        "/api/v1/contracts/types",
        {"name": f"Automated Contract Type {tag}"},
    )
