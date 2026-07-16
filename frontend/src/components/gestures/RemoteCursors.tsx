// Other members' air cursors (§7): a colored dot + name label per peer,
// driven by cursor_move telemetry. Stale cursors are pruned on an interval so
// a peer who stops gesturing fades away instead of freezing on screen.
import { useEffect } from "react";

import {
  CURSOR_STALE_MS,
  GESTURE_LINGER_MS,
  usePresenceStore,
} from "../../stores/presenceStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

// Deterministic per-device hue so a peer keeps its color across sessions.
export function hueFor(deviceId: string): number {
  let h = 0;
  for (let i = 0; i < deviceId.length; i++) {
    h = (h * 31 + deviceId.charCodeAt(i)) % 360;
  }
  return h;
}

export function RemoteCursors() {
  const peers = usePresenceStore((s) => s.peers);
  const prune = usePresenceStore((s) => s.prune);
  const members = useWorkspaceStore((s) => s.members);

  useEffect(() => {
    const t = setInterval(() => prune(), 1000);
    return () => clearInterval(t);
  }, [prune]);

  const now = performance.now();
  const nameOf = (id: string) =>
    members.find((m) => m.device_id === id)?.display_name ?? "Someone";

  return (
    <>
      {Object.entries(peers)
        .filter(([, p]) => now - p.updatedAt < CURSOR_STALE_MS)
        .map(([deviceId, p]) => {
          const hue = hueFor(deviceId);
          const gesturing =
            p.gesture && now - p.gestureAt < GESTURE_LINGER_MS ? p.gesture : null;
          return (
            <div
              key={deviceId}
              className="pointer-events-none fixed z-30 -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-75"
              style={{ left: `${p.x * 100}vw`, top: `${p.y * 100}vh` }}
            >
              <div
                className="h-4 w-4 rounded-full border-2"
                style={{
                  borderColor: `hsl(${hue} 80% 60%)`,
                  backgroundColor: `hsl(${hue} 80% 60% / 0.25)`,
                }}
              />
              <span
                className="absolute left-4 top-4 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px]"
                style={{
                  backgroundColor: `hsl(${hue} 80% 60% / 0.15)`,
                  color: `hsl(${hue} 80% 65%)`,
                }}
              >
                {nameOf(deviceId)}
                {gesturing ? ` · ${gesturing}` : ""}
              </span>
            </div>
          );
        })}
    </>
  );
}
