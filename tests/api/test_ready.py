from httpx import AsyncClient


async def test_ready_with_postgres(client: AsyncClient) -> None:
    response = await client.get("/api/v1/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
    assert "X-Request-ID" in response.headers
