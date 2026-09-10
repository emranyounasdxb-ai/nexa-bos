from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from helpers import (
    authenticate,
    create_activated_user,
    create_product_variant,
    owner_client,
    spawned_client,
    unique_tag,
)
from httpx import AsyncClient
from nexa_bos_api.core.config import get_settings
from PIL import Image


def image_bytes(image_format: str, *, size: tuple[int, int] = (64, 40)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, (105, 28, 128)).save(output, format=image_format)
    return output.getvalue()


async def catalogue_entities(client: AsyncClient) -> list[tuple[str, dict]]:
    tag = unique_tag().upper()
    bank_response = await client.post(
        "/api/v1/banks",
        json={"name": f"Image Bank {tag}", "code": f"IB{tag[:8]}"},
    )
    product_response = await client.post(
        "/api/v1/products",
        json={"name": f"Image Product {tag}", "code": f"IP{tag[:8]}"},
    )
    assert bank_response.status_code == 200, bank_response.text
    assert product_response.status_code == 200, product_response.text
    bank = bank_response.json()
    product = product_response.json()
    mapping = await client.post(
        "/api/v1/bank-products",
        json={"bank_id": bank["id"], "product_id": product["id"]},
    )
    assert mapping.status_code == 200, mapping.text
    variant = await create_product_variant(
        client,
        bank_id=bank["id"],
        product_id=product["id"],
    )
    return [("banks", bank), ("products", product), ("product-variants", variant)]


@pytest.mark.asyncio
async def test_catalogue_image_upload_view_replace_remove(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "file_storage_dir", tmp_path)
    owner, _ = await owner_client(client)
    for route, entity in await catalogue_entities(owner):
        endpoint = f"/api/v1/{route}/{entity['id']}/image"
        missing = await owner.get(endpoint)
        assert missing.status_code == 404

        uploaded = await owner.post(
            endpoint,
            files={"file": ("same-name.png", image_bytes("PNG"), "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        body = uploaded.json()
        assert body["hasImage"] is True
        assert "imageKey" not in body
        assert body["imageContentType"] == "image/png"
        assert body["imageWidth"] == 64
        assert body["imageHeight"] == 40
        first_files = list(tmp_path.rglob("*.png"))
        assert len(first_files) == 1

        viewed = await owner.get(endpoint)
        assert viewed.status_code == 200
        assert viewed.headers["content-type"].startswith("image/png")
        assert viewed.headers["x-content-type-options"] == "nosniff"
        assert viewed.headers["cache-control"] == "private, max-age=300, must-revalidate"
        assert viewed.headers["vary"] == "Cookie"
        assert viewed.headers["etag"]
        assert viewed.headers["last-modified"]
        with Image.open(BytesIO(viewed.content)) as decoded:
            assert decoded.size == (64, 40)

        not_modified = await owner.get(
            endpoint,
            headers={"If-None-Match": f'"stale", W/{viewed.headers["etag"]}'},
        )
        assert not_modified.status_code == 304
        assert not not_modified.content
        assert not_modified.headers["etag"] == viewed.headers["etag"]
        assert not_modified.headers["cache-control"] == viewed.headers["cache-control"]
        assert not_modified.headers["vary"] == "Cookie"

        anonymous = await spawned_client()
        try:
            unauthorized_revalidation = await anonymous.get(
                endpoint, headers={"If-None-Match": viewed.headers["etag"]}
            )
            assert unauthorized_revalidation.status_code == 401
        finally:
            await anonymous.aclose()

        replaced = await owner.post(
            endpoint,
            files={"file": ("same-name.png", image_bytes("PNG", size=(80, 48)), "image/png")},
        )
        assert replaced.status_code == 200, replaced.text
        second_files = list(tmp_path.rglob("*.png"))
        assert len(second_files) == 1
        assert second_files[0].name != first_files[0].name
        assert not first_files[0].exists()
        assert replaced.json()["imageWidth"] == 80

        refreshed = await owner.get(endpoint, headers={"If-None-Match": viewed.headers["etag"]})
        assert refreshed.status_code == 200
        assert refreshed.headers["etag"] != viewed.headers["etag"]
        with Image.open(BytesIO(refreshed.content)) as decoded:
            assert decoded.size == (80, 48)

        removed = await owner.delete(endpoint)
        assert removed.status_code == 200
        assert removed.json()["hasImage"] is False
        assert not second_files[0].exists()
        assert (await owner.get(endpoint)).status_code == 404


@pytest.mark.asyncio
async def test_catalogue_image_validation_and_permissions(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "file_storage_dir", tmp_path)
    owner, _ = await owner_client(client)
    entities = await catalogue_entities(owner)
    bank_route, bank = entities[0]
    endpoint = f"/api/v1/{bank_route}/{bank['id']}/image"

    anonymous = await spawned_client()
    try:
        for route, entity in entities:
            assert (await anonymous.get(f"/api/v1/{route}/{entity['id']}/image")).status_code == 401
    finally:
        await anonymous.aclose()

    invalid_cases = [
        (("payload.png", b"not an image", "image/png"), "IMAGE_CONTENT_INVALID"),
        (("payload.png", image_bytes("JPEG"), "image/png"), "IMAGE_TYPE_MISMATCH"),
        (("payload.exe", image_bytes("PNG"), "image/png"), "IMAGE_TYPE_INVALID"),
        (("../payload.png", image_bytes("PNG"), "application/octet-stream"), "IMAGE_TYPE_INVALID"),
        (("large.png", b"0" * (2 * 1024 * 1024 + 1), "image/png"), "IMAGE_TOO_LARGE"),
        (("wide.png", image_bytes("PNG", size=(4097, 1)), "image/png"), "IMAGE_DIMENSIONS_INVALID"),
    ]
    for upload, code in invalid_cases:
        response = await owner.post(endpoint, files={"file": upload})
        assert response.status_code in {413, 422}
        assert response.json()["error"]["code"] == code
    assert not list(tmp_path.rglob("*.*"))

    traversal = await owner.post(
        endpoint,
        files={"file": ("../../outside.png", image_bytes("PNG"), "image/png")},
    )
    assert traversal.status_code == 200, traversal.text
    stored = list(tmp_path.rglob("*.png"))
    assert len(stored) == 1
    assert stored[0].resolve().is_relative_to(tmp_path.resolve())
    assert "outside" not in stored[0].name
    assert (await owner.delete(endpoint)).status_code == 200

    for image_format, content_type, extension in [
        ("JPEG", "image/jpeg", "jpg"),
        ("WEBP", "image/webp", "webp"),
    ]:
        accepted = await owner.post(
            endpoint,
            files={"file": (f"accepted.{extension}", image_bytes(image_format), content_type)},
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["imageContentType"] == content_type
        assert (await owner.get(endpoint)).headers["content-type"].startswith(content_type)
        assert (await owner.delete(endpoint)).status_code == 200

    user = await create_activated_user(owner, user_type_code="SE")
    denied_client = await spawned_client()
    try:
        await authenticate(denied_client, user["email"], "UserPass1!")
        for route, entity in entities:
            denied = await denied_client.post(
                f"/api/v1/{route}/{entity['id']}/image",
                files={"file": ("image.webp", image_bytes("WEBP"), "image/webp")},
            )
            assert denied.status_code == 403
            assert denied.json()["error"]["code"] == "FORBIDDEN"
            denied_remove = await denied_client.delete(f"/api/v1/{route}/{entity['id']}/image")
            assert denied_remove.status_code == 403
    finally:
        await denied_client.aclose()
