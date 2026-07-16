"""Tracks live WebSocket connections, one logical room per workspace (§5).

Single-process, in-memory (§0). Keyed by workspace_id -> device_id -> WebSocket.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from fastapi import WebSocket


def _envelope(message_type: str, payload: dict) -> str:
    return json.dumps(
        {
            "id": None,
            "type": message_type,
            "payload": payload,
            "ts": datetime.now(UTC).isoformat(),
        }
    )


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, WebSocket]] = {}

    def add(self, workspace_id: str, device_id: str, ws: WebSocket) -> None:
        self._rooms.setdefault(workspace_id, {})[device_id] = ws

    def remove(
        self, workspace_id: str, device_id: str, ws: WebSocket | None = None
    ) -> bool:
        """Drop a registration and report whether one was actually dropped.

        When ``ws`` is given, only remove if this exact socket is still the
        registered one — a device that reconnects (second tab, dev remount)
        displaces its old socket in ``add``, and the old socket's disconnect
        cleanup must NOT tear down the new live connection.
        """
        room = self._rooms.get(workspace_id)
        if not room:
            return False
        if ws is not None and room.get(device_id) is not ws:
            return False
        removed = room.pop(device_id, None) is not None
        if not room:
            self._rooms.pop(workspace_id, None)
        return removed

    def device_ids(self, workspace_id: str) -> list[str]:
        return list(self._rooms.get(workspace_id, {}).keys())

    async def send_to(
        self, workspace_id: str, device_id: str, message_type: str, payload: dict
    ) -> None:
        ws = self._rooms.get(workspace_id, {}).get(device_id)
        if ws is not None:
            await ws.send_text(_envelope(message_type, payload))

    async def broadcast(
        self,
        workspace_id: str,
        message_type: str,
        payload: dict,
        exclude_device_id: str | None = None,
    ) -> None:
        text = _envelope(message_type, payload)
        for did, ws in list(self._rooms.get(workspace_id, {}).items()):
            if did == exclude_device_id:
                continue
            await ws.send_text(text)


connection_manager = ConnectionManager()
