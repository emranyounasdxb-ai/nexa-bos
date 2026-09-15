from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from io import BytesIO

import pytest
from helpers import create_activated_user, owner_client
from httpx import AsyncClient, Response
from nexa_bos_api.main import app
from PIL import Image
from sqlalchemy import event


async def _count_selects(
    call: Callable[[], Awaitable[Response]],
) -> tuple[int, Response]:
    statements: list[str] = []

    def count_selects(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = app.state.engine.sync_engine
    event.listen(engine, "before_cursor_execute", count_selects)
    try:
        response = await call()
    finally:
        event.remove(engine, "before_cursor_execute", count_selects)
    return len(statements), response


@pytest.mark.asyncio
async def test_large_user_views_keep_database_queries_bounded(
    client: AsyncClient,
) -> None:
    owner, _ = await owner_client(client)
    single_count, single = await _count_selects(
        lambda: owner.get("/api/v1/users", params={"page": 1, "page_size": 10})
    )
    page_count, page = await _count_selects(
        lambda: owner.get("/api/v1/users", params={"page": 1, "page_size": 50})
    )
    hierarchy_count, hierarchy = await _count_selects(
        lambda: owner.get("/api/v1/organization/hierarchy", params={"includeInactive": True})
    )
    assert single.status_code == page.status_code == hierarchy.status_code == 200
    print(
        "PROFILE_QUERY_PERFORMANCE",
        {
            "users10": single_count,
            "users50": page_count,
            "hierarchy": hierarchy_count,
            "hierarchyNodes": len(hierarchy.json()["nodes"]),
        },
    )
    if os.getenv("PROFILE_PERF_BASELINE") == "1":
        return
    assert page_count <= single_count + 1
    # Hierarchy loads a fixed set of relationship collections that the paginated
    # directory does not, so compare it with an endpoint-specific ceiling rather
    # than coupling the assertion to the directory query plan.
    assert hierarchy_count <= 20


def _photo(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), color).save(output, "PNG")
    return output.getvalue()


@pytest.mark.asyncio
async def test_profile_photo_variants_are_small_private_and_revalidated(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setattr("nexa_bos_api.identity.users_service.storage_dir", lambda: tmp_path)
    owner, _ = await owner_client(client)
    user = await create_activated_user(owner)
    original = _photo(1200, 900, (180, 30, 140))
    uploaded = await owner.post(
        f"/api/v1/users/{user['id']}/photo",
        files={"file": ("profile.png", original, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text

    source = await owner.get(f"/api/v1/users/{user['id']}/photo")
    avatar = await owner.get(f"/api/v1/users/{user['id']}/photo", params={"size": "avatar"})
    assert source.status_code == avatar.status_code == 200
    assert source.content == original
    assert avatar.headers["content-type"].startswith("image/webp")
    assert len(avatar.content) < len(source.content)
    with Image.open(BytesIO(avatar.content)) as decoded:
        assert max(decoded.size) <= 96
    assert avatar.headers["cache-control"] == "private, max-age=0, must-revalidate"
    assert avatar.headers["vary"] == "Cookie"
    assert avatar.headers["etag"]

    unchanged = await owner.get(
        f"/api/v1/users/{user['id']}/photo",
        params={"size": "avatar"},
        headers={"If-None-Match": avatar.headers["etag"]},
    )
    assert unchanged.status_code == 304
    assert unchanged.content == b""

    replacement = _photo(900, 1200, (40, 80, 190))
    replaced = await owner.post(
        f"/api/v1/users/{user['id']}/photo",
        files={"file": ("replacement.png", replacement, "image/png")},
    )
    assert replaced.status_code == 200, replaced.text
    refreshed = await owner.get(f"/api/v1/users/{user['id']}/photo", params={"size": "avatar"})
    assert refreshed.status_code == 200
    assert refreshed.headers["etag"] != avatar.headers["etag"]
    assert refreshed.content != avatar.content
