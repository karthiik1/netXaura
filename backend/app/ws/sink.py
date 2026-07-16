"""Production TransferSink: bridges the state machine to the DB and the room.

Implements how each transfer type is persisted on completion (§0):
  - selection : no tab is created; the text is pushed to the receiver, which
                inserts it at its active editor caret. History stores a preview.
  - tab       : a NEW tab owned by the receiver is created as a copy of the
                source tab (originals are never mutated — snapshots, not sync).
  - workspace : every tab the sender owns is copied to the receiver.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import select

from app.db import get_sessionmaker
from app.models import (
    Tab,
    TabType,
    TransferHistory,
    TransferStatus,
    TransferType,
)
from app.schemas import TabOut
from app.ws.connection_manager import ConnectionManager
from app.ws.transfer_manager import PendingTransfer


def _tab_dict(tab: Tab) -> dict:
    return json.loads(TabOut.model_validate(tab).model_dump_json())


class WsTransferSink:
    def __init__(self, connections: ConnectionManager):
        self._conn = connections

    async def connected_receivers(
        self, workspace_id: str, exclude_device_id: str
    ) -> list[str]:
        return [d for d in self._conn.device_ids(workspace_id) if d != exclude_device_id]

    async def broadcast(
        self, workspace_id, message_type, payload, exclude_device_id=None
    ) -> None:
        await self._conn.broadcast(workspace_id, message_type, payload, exclude_device_id)

    async def send_to(self, workspace_id, device_id, message_type, payload) -> None:
        await self._conn.send_to(workspace_id, device_id, message_type, payload)

    async def persist_completion(
        self, pending: PendingTransfer, receiver_device_id: str
    ) -> dict:
        async with get_sessionmaker()() as session:
            history = TransferHistory(
                workspace_id=pending.workspace_id,
                sender_device_id=pending.sender_device_id,
                receiver_device_id=receiver_device_id,
                transfer_type=pending.transfer_type,
                payload_preview=json.dumps(pending.preview)[:2000],
                status=TransferStatus.completed,
                completed_at=datetime.now(UTC).replace(tzinfo=None),
            )
            session.add(history)

            if pending.transfer_type == TransferType.selection:
                result = {
                    "kind": "selection",
                    "selection": {
                        "text": pending.payload.get("text", ""),
                        "language": pending.payload.get("language"),
                    },
                }

            elif pending.transfer_type == TransferType.tab:
                source = await session.get(Tab, pending.payload.get("tab_id"))
                new_tab = Tab(
                    workspace_id=pending.workspace_id,
                    owner_device_id=receiver_device_id,
                    type=source.type if source else TabType.code,
                    title=(source.title if source else pending.preview.get("title"))
                    or "Received tab",
                    content=source.content if source else pending.payload.get("text", ""),
                    language=(
                        source.language if source else pending.payload.get("language")
                    ),
                )
                session.add(new_tab)
                await session.commit()
                await session.refresh(new_tab)
                return {"kind": "tab", "tab": _tab_dict(new_tab)}

            else:  # workspace
                # Per-device tabs: "the whole workspace" means the sender's
                # documents, not every device's.
                rows = await session.scalars(
                    select(Tab).where(
                        Tab.workspace_id == pending.workspace_id,
                        Tab.owner_device_id == pending.sender_device_id,
                    )
                )
                copies: list[dict] = []
                for src in rows:
                    clone = Tab(
                        workspace_id=pending.workspace_id,
                        owner_device_id=receiver_device_id,
                        type=src.type,
                        title=src.title,
                        content=src.content,
                        language=src.language,
                    )
                    session.add(clone)
                    await session.flush()
                    copies.append(_tab_dict(clone))
                await session.commit()
                return {"kind": "workspace", "tabs": copies}

            await session.commit()
            return result
