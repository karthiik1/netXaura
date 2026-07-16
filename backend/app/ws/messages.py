"""Validation schemas for client -> server WebSocket payloads (§5.1).

Client input crosses a trust boundary here: every payload is shape-checked and
size-capped before it reaches the transfer state machine or is echoed to the
room. Unknown extra keys are ignored so old clients keep working.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models import TransferType

# A selection is text a human highlighted, not a file upload. The WS frame cap
# (settings.ws_max_message_bytes) is the hard limit; this keeps previews sane.
MAX_SELECTION_CHARS = 100_000


class _Payload(BaseModel):
    model_config = ConfigDict(extra="ignore")


class CursorMove(_Payload):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)


class GestureEvent(_Payload):
    gesture: str = Field(max_length=40)
    hands_count: int = Field(default=0, ge=0, le=2)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class SelectionPayload(_Payload):
    text: str = Field(min_length=1, max_length=MAX_SELECTION_CHARS)
    language: str | None = Field(default=None, max_length=40)


class TabPayload(_Payload):
    tab_id: str = Field(min_length=1, max_length=36)
    title: str = Field(default="Tab", max_length=160)


class TransferInitiate(_Payload):
    transfer_type: TransferType
    # None = broadcast offer (anyone may claim); set = only this device is
    # notified and only it may claim (§5.3 targeted transfers).
    target_device_id: str | None = Field(default=None, min_length=8, max_length=36)
    payload: dict = Field(default_factory=dict)


class TransferClaim(_Payload):
    transfer_id: str = Field(min_length=1, max_length=36)
