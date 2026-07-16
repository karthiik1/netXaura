"""Workspace + member + transfer-history endpoints (§4)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import TransferHistory
from app.schemas import (
    JoinRequest,
    JoinResult,
    MemberOut,
    TabOut,
    TransferHistoryOut,
    WorkspaceCreate,
    WorkspaceCreated,
)
from app.services import workspace_service as svc

router = APIRouter(prefix="/api/v1", tags=["workspaces"])


@router.post("/workspaces", response_model=WorkspaceCreated, summary="Create a workspace")
async def create_workspace(
    body: WorkspaceCreate, session: AsyncSession = Depends(get_session)
) -> WorkspaceCreated:
    ws = await svc.create_workspace(session, body.name)
    return WorkspaceCreated(workspace_id=ws.id, code=ws.code)


@router.post(
    "/workspaces/{code}/join",
    response_model=JoinResult,
    summary="Join a workspace by code",
)
async def join_workspace(
    code: str, body: JoinRequest, session: AsyncSession = Depends(get_session)
) -> JoinResult:
    ws = await svc.get_active_workspace(session, code)
    member = await svc.upsert_member(
        session, ws, body.device_id, body.display_name, body.auth_token
    )
    await svc.touch_workspace(session, ws)
    members = await svc.list_members(session, ws)
    # Per-device tabs: the joiner receives only its own documents (§0) — other
    # devices' tabs arrive exclusively through transfers.
    tabs = await svc.list_tabs(session, ws, owner_device_id=body.device_id)
    return JoinResult(
        member=MemberOut.model_validate(member),
        members=[MemberOut.model_validate(m) for m in members],
        tabs=[TabOut.model_validate(t) for t in tabs],
        auth_token=member.auth_token or "",
    )


@router.get(
    "/workspaces/{code}/members",
    response_model=list[MemberOut],
    summary="List connected members",
)
async def list_members(code: str, session: AsyncSession = Depends(get_session)):
    ws = await svc.get_active_workspace(session, code)
    members = await svc.list_members(session, ws)
    return [MemberOut.model_validate(m) for m in members if m.is_connected]


@router.get(
    "/workspaces/{code}/transfers/history",
    response_model=list[TransferHistoryOut],
    summary="Recent transfer history (paginated, newest first)",
)
async def transfer_history(
    code: str,
    limit: int = Query(default=50, ge=1, le=200),
    before: int | None = Query(default=None, description="Return rows with id < before"),
    session: AsyncSession = Depends(get_session),
):
    ws = await svc.get_active_workspace(session, code)
    stmt = (
        select(TransferHistory)
        .where(TransferHistory.workspace_id == ws.id)
        .order_by(TransferHistory.id.desc())
        .limit(limit)
    )
    if before is not None:
        stmt = stmt.where(TransferHistory.id < before)
    rows = await session.scalars(stmt)
    return [TransferHistoryOut.model_validate(r) for r in rows]
