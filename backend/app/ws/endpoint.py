"""WebSocket endpoint (§5): connect/auth, message routing, disconnect cleanup.

Message envelope: { id, type, payload, ts }. Server timestamps are authoritative.

Connecting requires the member auth token issued by the REST join (§5.1), so a
device must join over REST before opening the socket. Close codes: 4404 unknown
or expired workspace, 4401 unknown member or bad token.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy import select

from app.config import get_settings
from app.db import get_sessionmaker
from app.errors import AppError
from app.models import WorkspaceMember
from app.services import workspace_service as svc
from app.ws import messages as m
from app.ws.connection_manager import connection_manager
from app.ws.rate_limit import TokenBucket
from app.ws.sink import WsTransferSink
from app.ws.transfer_manager import TransferManager

# Shared singletons (single-worker, in-memory — §0).
_sink = WsTransferSink(connection_manager)
transfer_manager = TransferManager(_sink, ttl_seconds=get_settings().transfer_ttl_seconds)

# Telemetry messages are dropped (not errored) when over budget — see rate_limit.
_TELEMETRY_TYPES = {"cursor_move", "gesture_event"}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


async def _send(ws: WebSocket, message_type: str, payload: dict) -> None:
    await ws.send_text(
        json.dumps(
            {"id": None, "type": message_type, "payload": payload, "ts": _now_iso()}
        )
    )


async def _send_error(ws: WebSocket, err: AppError) -> None:
    await _send(ws, "error", err.envelope()["error"])


async def workspace_ws(
    ws: WebSocket, workspace_code: str, device_id: str, token: str
) -> None:
    # --- connect: workspace must be active, member must exist with this token ---
    async with get_sessionmaker()() as session:
        try:
            workspace = await svc.get_active_workspace(session, workspace_code)
        except AppError:
            await ws.close(code=4404)
            return
        member = await session.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.device_id == device_id,
            )
        )
        if member is None or not token or member.auth_token != token:
            # No auto-join: the REST join issues the token first (§5.1).
            await ws.close(code=4401)
            return
        workspace_id = workspace.id
        await svc.set_connected(session, workspace_id, device_id, True)
        await svc.touch_workspace(session, workspace)

    settings = get_settings()
    telemetry_bucket = TokenBucket(
        settings.ws_telemetry_rate_per_sec, settings.ws_telemetry_burst
    )
    control_bucket = TokenBucket(
        settings.ws_control_rate_per_sec, settings.ws_control_burst
    )

    await ws.accept()
    connection_manager.add(workspace_id, device_id, ws)
    await connection_manager.broadcast(
        workspace_id,
        "member_joined",
        {"device_id": device_id, "display_name": member.display_name},
        exclude_device_id=device_id,
    )

    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > settings.ws_max_message_bytes:
                await _send_error(ws, AppError("invalid_message", "Message too large."))
                continue
            await _route(
                ws, workspace_id, device_id, raw, telemetry_bucket, control_bucket
            )
    except WebSocketDisconnect:
        pass
    finally:
        # Only tear down the device's room state if THIS socket is still its
        # registered connection. A newer socket for the same device (second
        # tab, dev remount) displaces this one, and closing the stale socket
        # must not cancel the live one's transfers or presence.
        if connection_manager.remove(workspace_id, device_id, ws):
            await transfer_manager.drop_sender(workspace_id, device_id)
            async with get_sessionmaker()() as session:
                await svc.set_connected(session, workspace_id, device_id, False)
            await connection_manager.broadcast(
                workspace_id, "member_left", {"device_id": device_id}
            )


async def _route(
    ws: WebSocket,
    workspace_id: str,
    device_id: str,
    raw: str,
    telemetry_bucket: TokenBucket,
    control_bucket: TokenBucket,
) -> None:
    try:
        msg = json.loads(raw)
        mtype = msg["type"]
        payload = msg.get("payload") or {}
        if not isinstance(mtype, str) or not isinstance(payload, dict):
            raise TypeError
    except (json.JSONDecodeError, KeyError, TypeError):
        await _send_error(ws, AppError("invalid_message", "Malformed message."))
        return

    if mtype in _TELEMETRY_TYPES:
        if not telemetry_bucket.allow():
            return  # dropped frame; invisible by design
    elif not control_bucket.allow():
        await _send_error(ws, AppError("rate_limited", "Too many messages — slow down."))
        return

    try:
        if mtype == "heartbeat":
            async with get_sessionmaker()() as session:
                await svc.set_connected(session, workspace_id, device_id, True)
                # A live session counts as activity: keep the workspace from
                # expiring (and being swept) under people who are still in it.
                await svc.touch_workspace_by_id(session, workspace_id)

        elif mtype == "gesture_event":
            # Telemetry only (§0): let others render "X is gesturing".
            g = m.GestureEvent.model_validate(payload)
            await connection_manager.broadcast(
                workspace_id,
                "member_gesturing",
                {"device_id": device_id, "gesture": g.gesture},
                exclude_device_id=device_id,
            )

        elif mtype == "cursor_move":
            c = m.CursorMove.model_validate(payload)
            await connection_manager.broadcast(
                workspace_id,
                "cursor_move",
                {"device_id": device_id, "x": c.x, "y": c.y},
                exclude_device_id=device_id,
            )

        elif mtype == "transfer_initiate":
            init = m.TransferInitiate.model_validate(payload)
            inner = _validate_inner(init)
            preview = _preview_for(init.transfer_type, inner)
            pending = await transfer_manager.initiate(
                workspace_id,
                device_id,
                init.transfer_type,
                inner,
                preview,
                target_device_id=init.target_device_id,
            )
            # Ack the sender with the id so it can correlate the later
            # transfer_completed / transfer_expired with its own offer (the
            # pending broadcast deliberately excludes the sender).
            await _send(
                ws,
                "transfer_initiated",
                {
                    "transfer_id": pending.id,
                    "transfer_type": init.transfer_type.value,
                },
            )

        elif mtype == "transfer_claim":
            claim = m.TransferClaim.model_validate(payload)
            await transfer_manager.claim(workspace_id, device_id, claim.transfer_id)

        else:
            await _send_error(ws, AppError("invalid_message", f"Unknown type: {mtype}"))

    except ValidationError:
        await _send_error(ws, AppError("invalid_message", f"Invalid {mtype} payload."))
    except AppError as err:
        await _send_error(ws, err)


def _validate_inner(init: m.TransferInitiate) -> dict:
    """Shape-check the type-specific payload; returns a clean dict."""
    if init.transfer_type == m.TransferType.selection:
        return m.SelectionPayload.model_validate(init.payload).model_dump()
    if init.transfer_type == m.TransferType.tab:
        return m.TabPayload.model_validate(init.payload).model_dump()
    return {}  # workspace transfers carry no payload


def _preview_for(ttype: m.TransferType, inner: dict) -> dict:
    if ttype == m.TransferType.selection:
        text = inner.get("text", "")
        return {
            "title": "Selection",
            "excerpt": text[:80],
            "length": len(text),
            "language": inner.get("language"),
        }
    if ttype == m.TransferType.tab:
        return {"title": inner.get("title", "Tab")}
    return {"title": "Whole workspace"}
