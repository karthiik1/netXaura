"""Per-connection token buckets for the WebSocket message loop (§5.1).

Two classes of traffic get separate budgets: high-frequency telemetry
(cursor_move, gesture_event) and low-frequency control messages (transfers,
heartbeat). Telemetry over budget is dropped silently — losing a cursor frame
is invisible; control over budget gets an explicit `rate_limited` error.
"""

from __future__ import annotations

import time


class TokenBucket:
    def __init__(self, rate_per_sec: float, burst: float):
        self._rate = rate_per_sec
        self._burst = burst
        self._tokens = burst
        self._last = time.monotonic()

    def allow(self, now: float | None = None) -> bool:
        """Consume one token if available; refills continuously."""
        if now is None:
            now = time.monotonic()
        self._tokens = min(self._burst, self._tokens + (now - self._last) * self._rate)
        self._last = now
        if self._tokens >= 1.0:
            self._tokens -= 1.0
            return True
        return False
