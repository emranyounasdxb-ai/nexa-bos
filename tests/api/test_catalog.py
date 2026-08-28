from __future__ import annotations

import pytest
from httpx import AsyncClient

from helpers import owner_client, unique_tag


@pytest.mark.asyncio
async def test_seeded_banks_products_and_mappings(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    banks = {item["code"]: item for item in (await authed.get("/api/v1/banks")).json()["items"]}
    products = {
        item["code"]: item for item in (await authed.get("/api/v1/products")).json()["items"]
    }
    assert {"DIB", "EIB", "SIB"} <= set(banks)
    assert banks["DIB"]["name"] == "DIB"
    assert banks["EIB"]["name"] == "EIB"
    assert banks["SIB"]["name"] == "SIB"
    assert {"PF", "CC"} <= set(products)
    mappings = (await authed.get("/api/v1/bank-products")).json()["items"]
    pairs = {(item["bank"]["code"], item["product"]["code"]) for item in mappings}
    assert {("DIB", "PF"), ("DIB", "CC"), ("EIB", "PF"), ("EIB", "CC"), ("SIB", "PF")} <= pairs
    assert ("SIB", "CC") not in pairs


@pytest.mark.asyncio
async def test_bank_name_history_and_no_delete(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag().upper()
    created = await authed.post(
        "/api/v1/banks", json={"name": f"Bank {tag}", "code": f"B{tag[:6]}"}
    )
    assert created.status_code == 200, created.text
    renamed = await authed.patch(
        f"/api/v1/banks/{created.json()['id']}", json={"name": f"Renamed {tag}"}
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == f"Renamed {tag}"
    assert renamed.json()["code"] == f"B{tag[:6]}"
    deleted = await authed.delete(f"/api/v1/banks/{created.json()['id']}")
    assert deleted.status_code == 405
    deactivated = await authed.post(f"/api/v1/banks/{created.json()['id']}/deactivate")
    assert deactivated.json()["status"] == "inactive"
    duplicate = await authed.post(
        "/api/v1/banks", json={"name": "Other", "code": f"B{tag[:6]}"}
    )
    assert duplicate.status_code == 409


@pytest.mark.asyncio
async def test_future_bank_product_mapping_is_configurable(client: AsyncClient) -> None:
    authed, _owner = await owner_client(client)
    tag = unique_tag().upper()
    bank = await authed.post("/api/v1/banks", json={"name": f"Future {tag}", "code": f"F{tag[:6]}"})
    product = await authed.post(
        "/api/v1/products", json={"name": f"Future product {tag}", "code": f"P{tag[:6]}"}
    )
    assert bank.status_code == 200 and product.status_code == 200
    created = await authed.post(
        "/api/v1/bank-products",
        json={"bank_id": bank.json()["id"], "product_id": product.json()["id"]},
    )
    assert created.status_code == 200, created.text
    assert created.json()["bank"]["code"] == f"F{tag[:6]}"
    again = await authed.post(
        "/api/v1/bank-products",
        json={"bank_id": bank.json()["id"], "product_id": product.json()["id"]},
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "BANK_PRODUCT_DUPLICATE"
    deleted = await authed.delete(f"/api/v1/bank-products/{created.json()['id']}")
    assert deleted.status_code == 405
