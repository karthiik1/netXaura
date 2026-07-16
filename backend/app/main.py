"""NetXaura FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import get_sessionmaker
from app.errors import AppError, app_error_handler, http_exception_handler
from app.routers import health, tabs, workspaces
from app.services import workspace_service as svc
from app.ws.endpoint import workspace_ws

logger = logging.getLogger("netxaura")


async def _cleanup_loop(interval_seconds: int) -> None:
    """Periodically hard-delete expired workspaces (§3). Errors are logged and
    the loop keeps going — a transient DB hiccup must not kill the sweep."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            async with get_sessionmaker()() as session:
                removed = await svc.cleanup_expired_workspaces(session)
            if removed:
                logger.info("cleanup: removed %d expired workspace(s)", removed)
        except Exception:  # noqa: BLE001 — sweep must survive anything
            logger.exception("cleanup: sweep failed; will retry next interval")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # V1 uses Alembic migrations for schema; nothing to warm up here.
    sweeper = asyncio.create_task(_cleanup_loop(get_settings().cleanup_interval_seconds))
    yield
    sweeper.cancel()


app = FastAPI(
    title="NetXaura API",
    version="1.1.0",
    summary="Gesture-driven cross-device collaboration backend.",
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)

app.include_router(health.router)
app.include_router(workspaces.router)
app.include_router(tabs.router)


@app.websocket("/ws/{workspace_code}")
async def ws_route(
    ws: WebSocket, workspace_code: str, device_id: str, token: str = ""
) -> None:
    """WS /ws/{workspace_code}?device_id=...&token=... — see §5."""
    await workspace_ws(ws, workspace_code, device_id, token)
