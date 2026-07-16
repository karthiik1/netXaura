"""Tab endpoints (§4). Autosave uses last-write-wins (§9 — no OT/CRDT)."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.errors import AppError
from app.models import Tab
from app.schemas import TabCreate, TabOut, TabUpdate
from app.services import workspace_service as svc

router = APIRouter(prefix="/api/v1", tags=["tabs"])


@router.get("/workspaces/{code}/tabs", response_model=list[TabOut], summary="List tabs")
async def list_tabs(
    code: str,
    owner_device_id: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    ws = await svc.get_active_workspace(session, code)
    tabs = await svc.list_tabs(session, ws, owner_device_id=owner_device_id)
    return [TabOut.model_validate(t) for t in tabs]


@router.post("/workspaces/{code}/tabs", response_model=TabOut, summary="Create a tab")
async def create_tab(
    code: str, body: TabCreate, session: AsyncSession = Depends(get_session)
):
    ws = await svc.get_active_workspace(session, code)
    tab = await svc.create_tab(
        session,
        ws.id,
        body.owner_device_id,
        body.type,
        body.title,
        body.content,
        body.language,
    )
    await svc.touch_workspace(session, ws)
    return TabOut.model_validate(tab)


@router.get("/tabs/{tab_id}", response_model=TabOut, summary="Fetch one tab")
async def get_tab(tab_id: str, session: AsyncSession = Depends(get_session)):
    tab = await session.get(Tab, tab_id)
    if tab is None:
        raise AppError("tab_not_found", "No such tab.")
    return TabOut.model_validate(tab)


@router.patch("/tabs/{tab_id}", response_model=TabOut, summary="Update a tab (autosave)")
async def update_tab(
    tab_id: str, body: TabUpdate, session: AsyncSession = Depends(get_session)
):
    tab = await session.get(Tab, tab_id)
    if tab is None:
        raise AppError("tab_not_found", "No such tab.")
    if body.title is not None:
        tab.title = body.title
    if body.content is not None:
        tab.content = body.content
    if body.language is not None:
        tab.language = body.language
    await session.commit()
    await session.refresh(tab)
    return TabOut.model_validate(tab)


@router.delete("/tabs/{tab_id}", status_code=204, summary="Close a tab")
async def delete_tab(tab_id: str, session: AsyncSession = Depends(get_session)):
    tab = await session.get(Tab, tab_id)
    if tab is not None:
        await session.delete(tab)
        await session.commit()
