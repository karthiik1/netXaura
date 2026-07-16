"""In-memory transfer state machine (§5.2).

One pending transfer per (workspace_id, sender_device_id) at a time. The manager
is deliberately decoupled from persistence and the WebSocket layer through the
``TransferSink`` protocol, so the full state machine can be unit-tested with no
database and no webcam (see tests/test_transfer_manager.py).

SCALING NOTE: state lives in this process's memory. Running more than one backend
worker would give each worker its own dict and break claims across workers. V1 is
single-worker by design (§0); horizontal scaling needs Redis and is out of scope.
"""

from __future__ import annotations

import asyncio
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Protocol

from app.errors import AppError
from app.models import TransferType


class TransferSink(Protocol):
    """Everything the manager needs from the outside world. Real implementation
    is backed by the DB + ConnectionManager; tests pass an async mock."""

    async def connected_receivers(
        self, workspace_id: str, exclude_device_id: str
    ) -> list[str]:
        """Device ids currently connected to the room, excluding the sender."""

    async def broadcast(
        self,
        workspace_id: str,
        message_type: str,
        payload: dict,
        exclude_device_id: str | None = None,
    ) -> None: ...

    async def send_to(
        self, workspace_id: str, device_id: str, message_type: str, payload: dict
    ) -> None: ...

    async def persist_completion(
        self, pending: PendingTransfer, receiver_device_id: str
    ) -> dict:
        """Persist the completed transfer (create receiver tab(s), write history)
        and return the sync payload for tab_synced / workspace_synced."""


@dataclass
class PendingTransfer:
    id: str
    workspace_id: str
    sender_device_id: str
    transfer_type: TransferType
    payload: dict
    preview: dict
    # None = broadcast offer (first claim wins). Set = only this device was
    # notified and only it may claim (§5.3 targeted transfers).
    target_device_id: str | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    settled: bool = False  # true once claimed OR expired — guards the race
    _timer: asyncio.Task | None = field(default=None, repr=False)


class TransferManager:
    def __init__(self, sink: TransferSink, ttl_seconds: float = 10.0):
        self._sink = sink
        self._ttl = ttl_seconds
        self._by_sender: dict[tuple[str, str], PendingTransfer] = {}
        self._by_id: dict[str, PendingTransfer] = {}
        # Bounded record of ids that were successfully claimed, so a claim that
        # arrives after the winner already cleared the maps is still told
        # `transfer_already_claimed` rather than `transfer_not_found`. Bounded to
        # avoid unbounded growth (oldest ids are forgotten).
        self._recently_claimed: OrderedDict[str, None] = OrderedDict()
        self._recently_claimed_cap = 512

    # -- introspection (used by tests / debugging) --------------------------
    def pending_count(self) -> int:
        return len(self._by_id)

    def get(self, transfer_id: str) -> PendingTransfer | None:
        return self._by_id.get(transfer_id)

    # -- step 1: initiate ---------------------------------------------------
    async def initiate(
        self,
        workspace_id: str,
        sender_device_id: str,
        transfer_type: TransferType,
        payload: dict,
        preview: dict,
        target_device_id: str | None = None,
    ) -> PendingTransfer:
        key = (workspace_id, sender_device_id)
        if key in self._by_sender:
            raise AppError(
                "sender_already_has_pending_transfer",
                "You already have a transfer waiting to be claimed.",
            )

        receivers = await self._sink.connected_receivers(
            workspace_id, exclude_device_id=sender_device_id
        )
        if not receivers:
            raise AppError(
                "no_recipients_available",
                "No one else is connected to receive this.",
            )
        if target_device_id is not None:
            if target_device_id == sender_device_id:
                raise AppError(
                    "self_transfer_denied", "You can't send content to yourself."
                )
            if target_device_id not in receivers:
                raise AppError(
                    "target_not_available",
                    "That device isn't connected to receive this.",
                )

        pending = PendingTransfer(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            sender_device_id=sender_device_id,
            transfer_type=transfer_type,
            payload=payload,
            preview=preview,
            target_device_id=target_device_id,
        )
        self._by_sender[key] = pending
        self._by_id[pending.id] = pending
        pending._timer = asyncio.create_task(self._expire_later(pending))

        offer = {
            "transfer_id": pending.id,
            "sender_device_id": sender_device_id,
            "transfer_type": transfer_type.value,
            "target_device_id": target_device_id,
            "preview": preview,
        }
        if target_device_id is not None:
            # Aimed offer: only the target sees it.
            await self._sink.send_to(
                workspace_id, target_device_id, "transfer_pending", offer
            )
        else:
            await self._sink.broadcast(
                workspace_id,
                "transfer_pending",
                offer,
                exclude_device_id=sender_device_id,
            )
        return pending

    # -- step 2: claim (first one wins) -------------------------------------
    async def claim(
        self, workspace_id: str, receiver_device_id: str, transfer_id: str
    ) -> PendingTransfer:
        pending = self._by_id.get(transfer_id)
        if pending is None or pending.workspace_id != workspace_id:
            # The transfer isn't live. Distinguish "someone already claimed it"
            # from "never existed / expired" so the loser of a race gets the
            # right message even if the winner already tore down the state.
            if transfer_id in self._recently_claimed:
                raise AppError(
                    "transfer_already_claimed",
                    "Someone else already received this transfer.",
                )
            raise AppError("transfer_not_found", "That transfer is no longer available.")

        # step 3: a device cannot claim its own transfer
        if receiver_device_id == pending.sender_device_id:
            raise AppError("self_transfer_denied", "You can't send content to yourself.")

        # A targeted transfer can only be claimed by the device it was aimed at.
        if (
            pending.target_device_id is not None
            and receiver_device_id != pending.target_device_id
        ):
            raise AppError(
                "not_transfer_target", "This transfer was aimed at another device."
            )

        # The lock + `settled` flag make the check-and-set atomic: with two
        # simultaneous claims exactly one passes. The winner records the id as
        # claimed and clears the maps inside the lock, so a loser that either
        # still holds the pending object (sees `settled`) or has to re-look-up
        # (finds it in `_recently_claimed`) is rejected consistently.
        async with pending.lock:
            if pending.settled:
                raise AppError(
                    "transfer_already_claimed",
                    "Someone else already received this transfer.",
                )
            pending.settled = True
            if pending._timer is not None:
                pending._timer.cancel()
            self._mark_claimed(pending)

        sync_payload = await self._sink.persist_completion(pending, receiver_device_id)

        completed = {
            "transfer_id": pending.id,
            "sender_device_id": pending.sender_device_id,
            "receiver_device_id": receiver_device_id,
            "transfer_type": pending.transfer_type.value,
        }
        # The whole room hears completion: both ends animate off it, and every
        # other device clears its now-dead offer toast and refreshes history.
        await self._sink.broadcast(workspace_id, "transfer_completed", completed)

        sync_type = (
            "workspace_synced"
            if pending.transfer_type == TransferType.workspace
            else "tab_synced"
        )
        await self._sink.send_to(
            workspace_id, receiver_device_id, sync_type, sync_payload
        )
        return pending

    # -- step 4: expiry -----------------------------------------------------
    async def _expire_later(self, pending: PendingTransfer) -> None:
        try:
            await asyncio.sleep(self._ttl)
        except asyncio.CancelledError:
            return  # claimed before the timer fired
        async with pending.lock:
            if pending.settled:
                return
            pending.settled = True
        self._remove(pending)
        await self._sink.broadcast(
            pending.workspace_id,
            "transfer_expired",
            {"transfer_id": pending.id},
            exclude_device_id=None,
        )

    def _remove(self, pending: PendingTransfer) -> None:
        self._by_id.pop(pending.id, None)
        self._by_sender.pop((pending.workspace_id, pending.sender_device_id), None)

    def _mark_claimed(self, pending: PendingTransfer) -> None:
        """Clear a claimed transfer from the live maps and remember its id."""
        self._remove(pending)
        self._recently_claimed[pending.id] = None
        while len(self._recently_claimed) > self._recently_claimed_cap:
            self._recently_claimed.popitem(last=False)

    async def drop_sender(self, workspace_id: str, sender_device_id: str) -> None:
        """Cancel a device's pending transfer, e.g. when it disconnects (§5)."""
        pending = self._by_sender.get((workspace_id, sender_device_id))
        if pending is None:
            return
        async with pending.lock:
            if pending.settled:
                return
            pending.settled = True
            if pending._timer is not None:
                pending._timer.cancel()
        self._remove(pending)
        await self._sink.broadcast(
            workspace_id,
            "transfer_expired",
            {"transfer_id": pending.id},
            exclude_device_id=None,
        )
