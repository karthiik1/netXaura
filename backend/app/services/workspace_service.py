"""Workspace / member / tab persistence helpers (§3, §4)."""

from __future__ import annotations

import random
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.errors import AppError
from app.models import Tab, TabType, Workspace, WorkspaceMember

# Human-friendly code alphabet: no 0/O/1/I to avoid confusion when read aloud.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _fresh_expiry() -> datetime:
    hours = get_settings().workspace_ttl_hours
    return _now() + timedelta(hours=hours)


def new_code(n: int = 6) -> str:
    return "".join(random.choices(_CODE_ALPHABET, k=n))


async def create_workspace(session: AsyncSession, name: str | None) -> Workspace:
    # Retry on the tiny chance of a code collision.
    for _ in range(6):
        code = new_code()
        exists = await session.scalar(select(Workspace).where(Workspace.code == code))
        if exists is None:
            break
    ws = Workspace(code=code, name=name, expires_at=_fresh_expiry())
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def get_active_workspace(session: AsyncSession, code: str) -> Workspace:
    ws = await session.scalar(select(Workspace).where(Workspace.code == code.upper()))
    if ws is None:
        raise AppError("workspace_not_found", "No workspace with that code.")
    if ws.expires_at is not None and ws.expires_at < _now():
        raise AppError("workspace_expired", "This workspace has expired.")
    return ws


async def touch_workspace(session: AsyncSession, ws: Workspace) -> None:
    """Refresh the inactivity expiry window on any activity (§3 policy)."""
    ws.expires_at = _fresh_expiry()
    await session.commit()


async def touch_workspace_by_id(session: AsyncSession, workspace_id: str) -> None:
    """Expiry refresh without loading the row — used on the WS heartbeat path."""
    await session.execute(
        update(Workspace)
        .where(Workspace.id == workspace_id)
        .values(expires_at=_fresh_expiry())
    )
    await session.commit()


async def cleanup_expired_workspaces(session: AsyncSession) -> int:
    """Hard-delete workspaces past expires_at (§3). Members/tabs/history go with
    them via ON DELETE CASCADE. A workspace with any connected member is spared
    regardless of its clock, so a long-lived idle session is never yanked."""
    live = select(WorkspaceMember.workspace_id).where(
        WorkspaceMember.is_connected.is_(True)
    )
    result = await session.execute(
        delete(Workspace).where(
            Workspace.expires_at.is_not(None),
            Workspace.expires_at < _now(),
            Workspace.id.not_in(live),
        )
    )
    await session.commit()
    return result.rowcount or 0


async def upsert_member(
    session: AsyncSession,
    ws: Workspace,
    device_id: str,
    display_name: str,
    presented_token: str | None = None,
) -> WorkspaceMember:
    """Create or refresh a member and settle its auth token (§5.1).

    First join binds a fresh token. Re-joins must present the bound token while
    the device is connected (otherwise `device_id_taken` — someone is using that
    identity right now). A *disconnected* member that lost its token may rotate
    it, so clearing browser storage doesn't lock a device out forever.
    """
    # Capture before any commit/rollback: those expire `ws`, and an expired
    # attribute can't lazy-refresh on an async session (MissingGreenlet).
    workspace_id = ws.id
    member = await _get_member(session, workspace_id, device_id)
    if member is None:
        member = WorkspaceMember(
            workspace_id=workspace_id,
            device_id=device_id,
            display_name=display_name,
            auth_token=secrets.token_urlsafe(32),
        )
        session.add(member)
        try:
            await session.commit()
        except IntegrityError:
            # Lost a concurrent-join race on uq_member_device (browsers fire
            # duplicate joins, e.g. React StrictMode). Adopt the winner's row
            # and fall through to the existing-member path below.
            await session.rollback()
            member = await _get_member(session, workspace_id, device_id)
            if member is None:  # pragma: no cover — row vanished mid-race
                raise
        else:
            await session.refresh(member)
            return member
    if member.auth_token and presented_token != member.auth_token:
        if member.is_connected:
            raise AppError(
                "device_id_taken",
                "That device identity is in use by a connected member.",
            )
        member.auth_token = secrets.token_urlsafe(32)
    elif not member.auth_token:
        member.auth_token = secrets.token_urlsafe(32)
    member.display_name = display_name
    await session.commit()
    await session.refresh(member)
    return member


async def _get_member(
    session: AsyncSession, workspace_id: str, device_id: str
) -> WorkspaceMember | None:
    return await session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.device_id == device_id,
        )
    )


async def list_members(session: AsyncSession, ws: Workspace) -> list[WorkspaceMember]:
    rows = await session.scalars(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws.id)
    )
    return list(rows)


async def set_connected(
    session: AsyncSession, workspace_id: str, device_id: str, connected: bool
) -> None:
    member = await session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.device_id == device_id,
        )
    )
    if member is not None:
        member.is_connected = connected
        member.last_seen_at = _now()
        await session.commit()


async def list_tabs(
    session: AsyncSession, ws: Workspace, owner_device_id: str | None = None
) -> list[Tab]:
    """Tabs are per-device: a device only sees (and edits) its own tabs, and
    content changes hands only through transfers. None = all tabs (admin/tests).
    """
    stmt = select(Tab).where(Tab.workspace_id == ws.id).order_by(Tab.created_at)
    if owner_device_id is not None:
        stmt = stmt.where(Tab.owner_device_id == owner_device_id)
    rows = await session.scalars(stmt)
    return list(rows)


async def create_tab(
    session: AsyncSession,
    workspace_id: str,
    owner_device_id: str,
    type_: TabType,
    title: str,
    content: str,
    language: str | None,
) -> Tab:
    tab = Tab(
        workspace_id=workspace_id,
        owner_device_id=owner_device_id,
        type=type_,
        title=title,
        content=content,
        language=language,
    )
    session.add(tab)
    await session.commit()
    await session.refresh(tab)
    return tab
