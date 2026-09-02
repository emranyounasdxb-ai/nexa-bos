from __future__ import annotations

import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy import inspect, select, update

from helpers import (
    authenticate,
    create_activated_user,
    owner_client,
    spawned_client,
    unique_tag,
)
from nexa_bos_api.applications.models import Application
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.db.session import create_engine, create_session_factory
from nexa_bos_api.identity.models import AuditEvent

@pytest.mark.asyncio
async def test_product_variant_migration_contract() -> None:
    engine = create_engine(get_settings())
    try:
        async with engine.connect() as connection:
            schema = await connection.run_sync(
                lambda sync_connection: {
                    "tables": set(inspect(sync_connection).get_table_names()),
                    "variant_foreign_keys": inspect(sync_connection).get_foreign_keys(
                        "product_variants"
                    ),
                    "variant_indexes": inspect(sync_connection).get_indexes("product_variants"),
                    "variant_uniques": inspect(sync_connection).get_unique_constraints(
                        "product_variants"
                    ),
                    "application_columns": inspect(sync_connection).get_columns("applications"),
                    "application_foreign_keys": inspect(sync_connection).get_foreign_keys(
                        "applications"
                    ),
                }
            )
    finally:
        await engine.dispose()

    assert "product_variants" in schema["tables"]
    assert any(
        foreign_key["referred_table"] == "bank_products"
        and foreign_key["constrained_columns"] == ["bank_product_id"]
        for foreign_key in schema["variant_foreign_keys"]
    )
    assert any(
        unique["name"] == "uq_product_variants_bank_product_code"
        for unique in schema["variant_uniques"]
    )
    assert any(
        index["name"] == "ix_product_variants_bank_product_status"
        for index in schema["variant_indexes"]
    )
    assert any(
        index["name"] == "uq_product_variants_bank_product_name_ci"
        and index["unique"] is True
        for index in schema["variant_indexes"]
    )
    application_variant = next(
        column for column in schema["application_columns"] if column["name"] == "product_variant_id"
    )
    assert application_variant["nullable"] is True
    assert any(
        foreign_key["referred_table"] == "product_variants"
        and foreign_key["constrained_columns"] == ["product_variant_id"]
        for foreign_key in schema["application_foreign_keys"]
    )


async def _catalog_mapping(client: AsyncClient) -> tuple[dict, dict, dict]:
    tag = unique_tag().upper()
    bank_response = await client.post(
        "/api/v1/banks",
        json={"name": f"Variant Bank {tag}", "code": f"VB{tag}"},
    )
    assert bank_response.status_code == 200, bank_response.text
    product_response = await client.post(
        "/api/v1/products",
        json={"name": f"Variant Category {tag}", "code": f"VC{tag}"},
    )
    assert product_response.status_code == 200, product_response.text
    bank = bank_response.json()
    product = product_response.json()
    mapping_response = await client.post(
        "/api/v1/bank-products",
        json={"bank_id": bank["id"], "product_id": product["id"]},
    )
    assert mapping_response.status_code == 200, mapping_response.text
    return bank, product, mapping_response.json()


async def _variant(
    client: AsyncClient,
    mapping_id: str,
    *,
    code: str | None = None,
    name: str | None = None,
) -> dict:
    tag = unique_tag().upper()
    response = await client.post(
        "/api/v1/product-variants",
        json={
            "bank_product_id": mapping_id,
            "name": name or f"Cashback Variant {tag}",
            "code": code or f"CV{tag}",
            "description": "Verified test variant",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _enable_owner_case_assignment(client: AsyncClient) -> dict:
    user_types = (await client.get("/api/v1/user-types")).json()["items"]
    owner_type = next(item for item in user_types if item["code"] == "OWNER")
    if not owner_type["canBeCaseOwner"]:
        response = await client.put(
            f"/api/v1/user-types/{owner_type['id']}/case-owner",
            json={"can_be_case_owner": True},
        )
        assert response.status_code == 200, response.text
    return owner_type


async def _customer(client: AsyncClient) -> dict:
    tag = unique_tag()
    response = await client.post(
        "/api/v1/customers",
        json={
            "customer_type": "individual",
            "full_name": f"Variant Customer {tag}",
            "mobile": f"+97158{tag[:8]}",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _application_prerequisites(
    client: AsyncClient,
    *,
    bank: dict,
    product: dict,
) -> None:
    workflows = (
        await client.get(
            "/api/v1/workflows",
            params={"bank_id": bank["id"], "product_id": product["id"]},
        )
    ).json()["items"]
    if not any(item["status"] == "active" for item in workflows):
        response = await client.post(
            "/api/v1/workflows",
            json={"bank_id": bank["id"], "product_id": product["id"]},
        )
        assert response.status_code == 200, response.text


async def _type_with(client: AsyncClient, permissions: list[str]) -> str:
    tag = unique_tag().upper()
    response = await client.post(
        "/api/v1/user-types",
        json={"name": f"Variant Type {tag}", "code": f"VT{tag[:8]}"},
    )
    assert response.status_code == 200, response.text
    user_type = response.json()
    assigned = await client.put(
        f"/api/v1/user-types/{user_type['id']}/permissions",
        json={"permissions": permissions},
    )
    assert assigned.status_code == 200, assigned.text
    activated = await client.post(f"/api/v1/user-types/{user_type['id']}/activate")
    assert activated.status_code == 200, activated.text
    return user_type["code"]


@pytest.mark.asyncio
async def test_product_variant_crud_scope_status_application_and_legacy_compatibility(
    client: AsyncClient,
) -> None:
    owner, owner_user = await owner_client(client)
    await _enable_owner_case_assignment(owner)
    bank, product, mapping = await _catalog_mapping(owner)
    variant = await _variant(owner, mapping["id"], code="cash-01")
    assert variant["code"] == "CASH-01"
    assert variant["bankProductId"] == mapping["id"]
    assert variant["bankId"] == bank["id"]
    assert variant["productId"] == product["id"]

    duplicate_code = await owner.post(
        "/api/v1/product-variants",
        json={
            "bank_product_id": mapping["id"],
            "name": "Different name",
            "code": "cash-01",
        },
    )
    assert duplicate_code.status_code == 409
    assert duplicate_code.json()["error"]["code"] == "PRODUCT_VARIANT_DUPLICATE"
    duplicate_name = await owner.post(
        "/api/v1/product-variants",
        json={
            "bank_product_id": mapping["id"],
            "name": variant["name"].lower(),
            "code": "CASH-02",
        },
    )
    assert duplicate_name.status_code == 409

    race_name = f"Concurrent Variant {unique_tag()}"
    concurrent = await asyncio.gather(
        owner.post(
            "/api/v1/product-variants",
            json={
                "bank_product_id": mapping["id"],
                "name": race_name,
                "code": f"R1{unique_tag()}",
            },
        ),
        owner.post(
            "/api/v1/product-variants",
            json={
                "bank_product_id": mapping["id"],
                "name": race_name.lower(),
                "code": f"R2{unique_tag()}",
            },
        ),
    )
    assert sorted(response.status_code for response in concurrent) == [200, 409]
    assert next(response for response in concurrent if response.status_code == 409).json()[
        "error"
    ]["code"] == "PRODUCT_VARIANT_DUPLICATE"

    second_bank_response = await owner.post(
        "/api/v1/banks",
        json={"name": f"Second Variant Bank {unique_tag()}", "code": f"B{unique_tag()}"},
    )
    assert second_bank_response.status_code == 200, second_bank_response.text
    second_mapping_response = await owner.post(
        "/api/v1/bank-products",
        json={"bank_id": second_bank_response.json()["id"], "product_id": product["id"]},
    )
    assert second_mapping_response.status_code == 200, second_mapping_response.text
    same_code_other_mapping = await _variant(
        owner,
        second_mapping_response.json()["id"],
        code="CASH-01",
    )
    assert same_code_other_mapping["code"] == variant["code"]

    await _enable_owner_case_assignment(owner)
    await _application_prerequisites(owner, bank=bank, product=product)
    mismatched = await owner.post(
        "/api/v1/applications",
        json={
            "customer_id": (await _customer(owner))["id"],
            "bank_id": bank["id"],
            "product_id": product["id"],
            "product_variant_id": same_code_other_mapping["id"],
            "case_owner_id": owner_user["id"],
        },
    )
    assert mismatched.status_code == 422
    assert mismatched.json()["error"]["code"] == "PRODUCT_VARIANT_MAPPING_MISMATCH"

    updated = await owner.patch(
        f"/api/v1/product-variants/{variant['id']}",
        json={
            "name": "Cashback Signature",
            "description": "Renamed without changing identity",
            "code": "MASS-ASSIGN-BLOCKED",
            "bank_product_id": second_mapping_response.json()["id"],
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Cashback Signature"
    assert updated.json()["code"] == "CASH-01"
    assert updated.json()["bankProductId"] == mapping["id"]

    removed = await owner.delete(f"/api/v1/product-variants/{variant['id']}")
    assert removed.status_code == 405

    deactivated = await owner.post(f"/api/v1/product-variants/{variant['id']}/deactivate")
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["status"] == "inactive"
    active_list = await owner.get(
        "/api/v1/product-variants",
        params={"bankProductId": mapping["id"]},
    )
    assert variant["id"] not in {item["id"] for item in active_list.json()["items"]}
    full_list = await owner.get(
        "/api/v1/product-variants",
        params={"bankProductId": mapping["id"], "includeInactive": True},
    )
    assert variant["id"] in {item["id"] for item in full_list.json()["items"]}

    customer = await _customer(owner)
    await _application_prerequisites(owner, bank=bank, product=product)
    inactive_create = await owner.post(
        "/api/v1/applications",
        json={
            "customer_id": customer["id"],
            "bank_id": bank["id"],
            "product_id": product["id"],
            "product_variant_id": variant["id"],
            "case_owner_id": owner_user["id"],
        },
    )
    assert inactive_create.status_code == 422
    assert inactive_create.json()["error"]["code"] == "PRODUCT_VARIANT_INACTIVE"

    reactivated = await owner.post(f"/api/v1/product-variants/{variant['id']}/activate")
    assert reactivated.status_code == 200, reactivated.text
    created = await owner.post(
        "/api/v1/applications",
        json={
            "customer_id": customer["id"],
            "bank_id": bank["id"],
            "product_id": product["id"],
            "product_variant_id": variant["id"],
            "case_owner_id": owner_user["id"],
        },
    )
    assert created.status_code == 200, created.text
    application = created.json()
    assert application["productVariantId"] == variant["id"]
    assert application["productVariantCode"] == "CASH-01"
    assert application["productVariantName"] == "Cashback Signature"

    replacement = await _variant(owner, mapping["id"])
    changed = await owner.patch(
        f"/api/v1/applications/{application['id']}",
        json={"product_variant_id": replacement["id"]},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["productVariantId"] == replacement["id"]

    await owner.post(f"/api/v1/product-variants/{replacement['id']}/deactivate")
    preserved = await owner.get(f"/api/v1/applications/{application['id']}")
    assert preserved.status_code == 200, preserved.text
    assert preserved.json()["productVariantId"] == replacement["id"]
    assert preserved.json()["productVariantStatus"] == "inactive"

    engine = create_engine(get_settings())
    session_factory = create_session_factory(engine)
    try:
        async with session_factory() as session:
            await session.execute(
                update(Application)
                .where(Application.id == application["id"])
                .values(product_variant_id=None)
            )
            await session.commit()
    finally:
        await engine.dispose()
    legacy = await owner.get(f"/api/v1/applications/{application['id']}")
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["productVariantId"] is None
    assert legacy.json()["productVariantName"] is None

    engine = create_engine(get_settings())
    session_factory = create_session_factory(engine)
    try:
        async with session_factory() as session:
            actions = set(
                (
                    await session.execute(
                        select(AuditEvent.action).where(AuditEvent.entity_id == variant["id"])
                    )
                ).scalars()
            )
    finally:
        await engine.dispose()
    assert {
        "product_variant.create",
        "product_variant.update",
        "product_variant.status",
    }.issubset(actions)


@pytest.mark.asyncio
async def test_product_variant_permissions_csrf_and_parent_activation(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    _bank, _product, mapping = await _catalog_mapping(owner)
    create_only_type = await _type_with(owner, ["ProductVariants.Create"])
    create_only_user = await create_activated_user(owner, user_type_code=create_only_type)

    async with await spawned_client() as restricted:
        await authenticate(restricted, create_only_user["email"], "UserPass1!")
        listed = await restricted.get("/api/v1/product-variants")
        assert listed.status_code == 200
        created = await restricted.post(
            "/api/v1/product-variants",
            json={
                "bank_product_id": mapping["id"],
                "name": f"Restricted Variant {unique_tag()}",
                "code": f"RV{unique_tag()}",
            },
        )
        assert created.status_code == 200, created.text
        denied_edit = await restricted.patch(
            f"/api/v1/product-variants/{created.json()['id']}",
            json={"name": "Denied edit"},
        )
        assert denied_edit.status_code == 403
        assert denied_edit.json()["error"]["details"] == [
            {"permission": "ProductVariants.Edit"}
        ]
        denied_deactivate = await restricted.post(
            f"/api/v1/product-variants/{created.json()['id']}/deactivate"
        )
        assert denied_deactivate.status_code == 403

        csrf = restricted.headers.pop("X-CSRF-Token")
        missing_csrf = await restricted.post(
            "/api/v1/product-variants",
            json={
                "bank_product_id": mapping["id"],
                "name": "Missing CSRF",
                "code": f"MC{unique_tag()}",
            },
        )
        assert missing_csrf.status_code == 403
        assert missing_csrf.json()["error"]["code"] == "CSRF_INVALID"
        restricted.headers["X-CSRF-Token"] = csrf

    variant = await _variant(owner, mapping["id"])
    deactivated_mapping = await owner.post(f"/api/v1/bank-products/{mapping['id']}/deactivate")
    assert deactivated_mapping.status_code == 200, deactivated_mapping.text
    await owner.post(f"/api/v1/product-variants/{variant['id']}/deactivate")
    blocked_activation = await owner.post(f"/api/v1/product-variants/{variant['id']}/activate")
    assert blocked_activation.status_code == 422
    assert blocked_activation.json()["error"]["code"] == "PRODUCT_VARIANT_PARENT_INACTIVE"
