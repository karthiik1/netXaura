// Other members' live air cursors + "is gesturing" signals (§7). Purely
// ephemeral: fed by cursor_move / member_gesturing WS telemetry, never
// persisted. Entries carry a timestamp so the renderer can drop stale ones
// (a peer whose camera turned off stops sending; we fade them out).
import { create } from "zustand";

export interface PeerPresence {
  x: number;
  y: number;
  updatedAt: number; // performance.now() on receipt
  gesture: string | null;
  gestureAt: number;
}

/** Cursors older than this are considered gone and are not rendered. */
export const CURSOR_STALE_MS = 3000;
/** How long the "is gesturing" badge lingers after the last gesture_event. */
export const GESTURE_LINGER_MS = 1500;

interface PresenceState {
  peers: Record<string, PeerPresence>;

  cursorMoved: (deviceId: string, x: number, y: number, now?: number) => void;
  gestured: (deviceId: string, gesture: string, now?: number) => void;
  remove: (deviceId: string) => void;
  /** Drop peers whose cursor went stale; called on a slow interval. */
  prune: (now?: number) => void;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  peers: {},

  cursorMoved: (deviceId, x, y, now = performance.now()) => {
    const prev = get().peers[deviceId] ?? { gesture: null, gestureAt: 0 };
    set({
      peers: {
        ...get().peers,
        [deviceId]: { ...prev, x, y, updatedAt: now },
      },
    });
  },

  gestured: (deviceId, gesture, now = performance.now()) => {
    const prev = get().peers[deviceId];
    if (!prev) return; // only badge peers we have a cursor for
    set({
      peers: {
        ...get().peers,
        [deviceId]: { ...prev, gesture, gestureAt: now },
      },
    });
  },

  remove: (deviceId) => {
    const peers = { ...get().peers };
    delete peers[deviceId];
    set({ peers });
  },

  prune: (now = performance.now()) => {
    const peers = get().peers;
    const fresh = Object.fromEntries(
      Object.entries(peers).filter(([, p]) => now - p.updatedAt < CURSOR_STALE_MS),
    );
    if (Object.keys(fresh).length !== Object.keys(peers).length) {
      set({ peers: fresh });
    }
  },
}));
