"""REST tests against a SQLite database (proves models/schemas/routers wire up).

The same ORM models run here on SQLite and in production on MySQL 8.
"""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base, get_session
from app.main import app


@pytest_asyncio.fixture
async def client(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path/'t.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False)

    async def _override():
        async with sm() as session:
            yield session

    app.dependency_overrides[get_session] = _override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


async def test_create_join_and_tab_flow(client):
    # create
    r = await client.post("/api/v1/workspaces", json={"name": "Demo"})
    assert r.status_code == 200
    code = r.json()["code"]
    assert len(code) == 6

    # join
    r = await client.post(
        f"/api/v1/workspaces/{code}/join",
        json={"device_id": "device-aaaa", "display_name": "Ada"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["member"]["display_name"] == "Ada"
    assert body["tabs"] == []
    assert body["auth_token"]  # WS credential issued on join (§5.1)
    assert "auth_token" not in body["member"]  # never exposed via member lists

    # create a tab
    r = await client.post(
        f"/api/v1/workspaces/{code}/tabs",
        json={
            "owner_device_id": "device-aaaa",
            "type": "code",
            "title": "main.py",
            "content": "print('hi')",
            "language": "python",
        },
    )
    assert r.status_code == 200
    tab_id = r.json()["id"]

    # autosave
    r = await client.patch(f"/api/v1/tabs/{tab_id}", json={"content": "print('bye')"})
    assert r.status_code == 200 and r.json()["content"] == "print('bye')"

    # list
    r = await client.get(f"/api/v1/workspaces/{code}/tabs")
    assert len(r.json()) == 1


async def test_unknown_workspace_uses_error_envelope(client):
    r = await client.get("/api/v1/workspaces/ZZZZZZ/tabs")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "workspace_not_found"
