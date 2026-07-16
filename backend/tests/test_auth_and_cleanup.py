"""Member auth-token lifecycle (§5.1) and the expired-workspace sweep (§3)."""

from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base
from app.errors import AppError
from app.models import Workspace, WorkspaceMember
from app.services import workspace_service as svc


@pytest_asyncio.fixture
async def sessionmaker(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path/'t.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def test_join_issues_token_and_rejects_connected_impostor(sessionmaker):
    async with sessionmaker() as session:
        ws = await svc.create_workspace(session, "t")
        member = await svc.upsert_member(session, ws, "device-aaaa", "Ada")
        token = member.auth_token
        assert token  # first join binds a token

        # Re-join with the right token keeps it.
        again = await svc.upsert_member(session, ws, "device-aaaa", "Ada2", token)
        assert again.auth_token == token
        assert again.display_name == "Ada2"

        # While connected, a joiner without the token is refused.
        await svc.set_connected(session, ws.id, "device-aaaa", True)
        try:
            await svc.upsert_member(session, ws, "device-aaaa", "Mallory", None)
            raise AssertionError("expected device_id_taken")
        except AppError as err:
            assert err.code == "device_id_taken"

        # Once disconnected, a tokenless re-join rotates (storage was cleared).
        await svc.set_connected(session, ws.id, "device-aaaa", False)
        rotated = await svc.upsert_member(session, ws, "device-aaaa", "Ada", None)
        assert rotated.auth_token and rotated.auth_token != token


async def test_cleanup_sweeps_expired_but_spares_connected(sessionmaker):
    past = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1)
    async with sessionmaker() as session:
        dead = await svc.create_workspace(session, "dead")
        live = await svc.create_workspace(session, "live")
        fresh = await svc.create_workspace(session, "fresh")
        await svc.upsert_member(session, live, "device-bbbb", "Bee")
        await svc.set_connected(session, live.id, "device-bbbb", True)

        dead_db = await session.get(Workspace, dead.id)
        live_db = await session.get(Workspace, live.id)
        dead_db.expires_at = past
        live_db.expires_at = past  # expired on paper, but someone is connected
        await session.commit()

        removed = await svc.cleanup_expired_workspaces(session)
        assert removed == 1

        remaining = (await session.scalars(select(Workspace.id))).all()
        assert set(remaining) == {live.id, fresh.id}


async def test_member_out_never_leaks_tokens(sessionmaker):
    from app.schemas import MemberOut

    async with sessionmaker() as session:
        ws = await svc.create_workspace(session, "t")
        member = await svc.upsert_member(session, ws, "device-cccc", "Cee")
        out = MemberOut.model_validate(member)
        assert "auth_token" not in out.model_dump()


async def test_rejoin_flow_via_rest(sessionmaker):
    # Ensure the WS-visible invariant holds at the service level too: a member
    # always ends a join with a non-empty token the socket can be opened with.
    async with sessionmaker() as session:
        ws = await svc.create_workspace(session, "t")
        m1 = await svc.upsert_member(session, ws, "device-dddd", "Dee")
        assert m1.auth_token
        row = await session.scalar(
            select(WorkspaceMember).where(WorkspaceMember.device_id == "device-dddd")
        )
        assert row.auth_token == m1.auth_token
