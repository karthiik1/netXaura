"""State-machine tests (§5.2). No DB, no webcam — the sink is a mock."""

import asyncio

import pytest

from app.errors import AppError
from app.models import TransferType
from app.ws.transfer_manager import PendingTransfer, TransferManager


class FakeSink:
    """Records every outbound message so tests can assert on the sequence."""

    def __init__(self, receivers: list[str] | None = None):
        self._receivers = receivers if receivers is not None else ["dev-b"]
        self.broadcasts: list[dict] = []
        self.sends: list[dict] = []

    async def connected_receivers(self, workspace_id, exclude_device_id):
        return [r for r in self._receivers if r != exclude_device_id]

    async def broadcast(
        self, workspace_id, message_type, payload, exclude_device_id=None
    ):
        self.broadcasts.append(
            {"type": message_type, "payload": payload, "exclude": exclude_device_id}
        )

    async def send_to(self, workspace_id, device_id, message_type, payload):
        self.sends.append({"to": device_id, "type": message_type, "payload": payload})

    async def persist_completion(self, pending: PendingTransfer, receiver_device_id):
        return {"tab": {"id": "new-tab", "owner_device_id": receiver_device_id}}


async def _initiate(mgr, sender="dev-a", target=None):
    return await mgr.initiate(
        workspace_id="ws-1",
        sender_device_id=sender,
        transfer_type=TransferType.tab,
        payload={"tab_id": "t1"},
        preview={"title": "main.py"},
        target_device_id=target,
    )


@pytest.mark.asyncio
async def test_happy_path():
    sink = FakeSink(receivers=["dev-b"])
    mgr = TransferManager(sink, ttl_seconds=5)

    pending = await _initiate(mgr)
    assert mgr.pending_count() == 1
    # transfer_pending broadcast to the room, excluding the sender.
    assert sink.broadcasts[0]["type"] == "transfer_pending"
    assert sink.broadcasts[0]["exclude"] == "dev-a"

    await mgr.claim("ws-1", "dev-b", pending.id)

    # State cleared, the whole room hears completion (both ends animate off it,
    # bystanders clear their offer toast), receiver gets the synced tab.
    assert mgr.pending_count() == 0
    assert [b["type"] for b in sink.broadcasts] == [
        "transfer_pending",
        "transfer_completed",
    ]
    assert [s["type"] for s in sink.sends] == ["tab_synced"]
    assert sink.sends[0]["to"] == "dev-b"


@pytest.mark.asyncio
async def test_expiry_before_claim():
    sink = FakeSink(receivers=["dev-b"])
    mgr = TransferManager(sink, ttl_seconds=0.05)

    pending = await _initiate(mgr)
    await asyncio.sleep(0.12)  # let the timer fire

    assert mgr.pending_count() == 0
    assert any(b["type"] == "transfer_expired" for b in sink.broadcasts)
    # Claiming an expired transfer now fails.
    with pytest.raises(AppError) as exc:
        await mgr.claim("ws-1", "dev-b", pending.id)
    assert exc.value.code == "transfer_not_found"


@pytest.mark.asyncio
async def test_race_between_two_claimers():
    sink = FakeSink(receivers=["dev-b", "dev-c"])
    mgr = TransferManager(sink, ttl_seconds=5)
    pending = await _initiate(mgr)

    results = await asyncio.gather(
        mgr.claim("ws-1", "dev-b", pending.id),
        mgr.claim("ws-1", "dev-c", pending.id),
        return_exceptions=True,
    )

    winners = [r for r in results if isinstance(r, PendingTransfer)]
    losers = [r for r in results if isinstance(r, AppError)]
    assert len(winners) == 1
    assert len(losers) == 1
    assert losers[0].code == "transfer_already_claimed"
    # Exactly one completion happened.
    assert sum(b["type"] == "transfer_completed" for b in sink.broadcasts) == 1


@pytest.mark.asyncio
async def test_self_transfer_rejected():
    sink = FakeSink(receivers=["dev-b"])
    mgr = TransferManager(sink, ttl_seconds=5)
    pending = await _initiate(mgr, sender="dev-a")

    with pytest.raises(AppError) as exc:
        await mgr.claim("ws-1", "dev-a", pending.id)
    assert exc.value.code == "self_transfer_denied"
    assert mgr.pending_count() == 1  # still pending for a real receiver


@pytest.mark.asyncio
async def test_sender_already_has_pending():
    sink = FakeSink(receivers=["dev-b"])
    mgr = TransferManager(sink, ttl_seconds=5)
    await _initiate(mgr, sender="dev-a")

    with pytest.raises(AppError) as exc:
        await _initiate(mgr, sender="dev-a")
    assert exc.value.code == "sender_already_has_pending_transfer"


@pytest.mark.asyncio
async def test_no_recipients_rejected():
    sink = FakeSink(receivers=[])  # sender is the only one connected
    mgr = TransferManager(sink, ttl_seconds=5)
    with pytest.raises(AppError) as exc:
        await _initiate(mgr, sender="dev-a")
    assert exc.value.code == "no_recipients_available"


@pytest.mark.asyncio
async def test_targeted_transfer_only_notifies_target():
    sink = FakeSink(receivers=["dev-b", "dev-c"])
    mgr = TransferManager(sink, ttl_seconds=5)

    pending = await _initiate(mgr, target="dev-b")

    # The offer went point-to-point, not to the room.
    assert sink.broadcasts == []
    assert sink.sends[0]["to"] == "dev-b"
    assert sink.sends[0]["type"] == "transfer_pending"
    assert sink.sends[0]["payload"]["target_device_id"] == "dev-b"

    await mgr.claim("ws-1", "dev-b", pending.id)
    assert mgr.pending_count() == 0


@pytest.mark.asyncio
async def test_targeted_transfer_rejects_other_claimers():
    sink = FakeSink(receivers=["dev-b", "dev-c"])
    mgr = TransferManager(sink, ttl_seconds=5)
    pending = await _initiate(mgr, target="dev-b")

    with pytest.raises(AppError) as exc:
        await mgr.claim("ws-1", "dev-c", pending.id)
    assert exc.value.code == "not_transfer_target"
    assert mgr.pending_count() == 1  # still claimable by the real target

    await mgr.claim("ws-1", "dev-b", pending.id)
    assert mgr.pending_count() == 0


@pytest.mark.asyncio
async def test_targeted_transfer_requires_connected_target():
    sink = FakeSink(receivers=["dev-b"])
    mgr = TransferManager(sink, ttl_seconds=5)

    with pytest.raises(AppError) as exc:
        await _initiate(mgr, target="dev-offline")
    assert exc.value.code == "target_not_available"

    with pytest.raises(AppError) as exc:
        await _initiate(mgr, sender="dev-a", target="dev-a")
    assert exc.value.code == "self_transfer_denied"


@pytest.mark.asyncio
async def test_drop_sender_on_disconnect():
    sink = FakeSink(receivers=["dev-b"])
    mgr = TransferManager(sink, ttl_seconds=5)
    pending = await _initiate(mgr, sender="dev-a")

    await mgr.drop_sender("ws-1", "dev-a")
    assert mgr.pending_count() == 0
    assert any(b["type"] == "transfer_expired" for b in sink.broadcasts)
    with pytest.raises(AppError):
        await mgr.claim("ws-1", "dev-b", pending.id)
