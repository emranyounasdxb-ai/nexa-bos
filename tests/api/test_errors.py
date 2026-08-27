from httpx import AsyncClient


async def test_unknown_route_uses_error_envelope(client: AsyncClient) -> None:
    response = await client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    payload = response.json()
    assert payload["error"]["code"] == "HTTP_404"
    assert payload["error"]["message"]
    assert payload["error"]["details"] == []
    assert payload["error"]["requestId"]
    assert "traceback" not in str(payload).lower()
    assert "stack" not in str(payload).lower()
