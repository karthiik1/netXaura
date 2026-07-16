// Live gesture recognition state for the on-screen indicator (§6.6).
import { create } from "zustand";

export type GestureName =
  | "none"
  | "point"
  | "ok"
  | "open_palm"
  | "fist"
  // Operation 3 (one-handed): index + middle up (a "V") arms the tab COPY and
  // completes it on the receiver; a fist confirms in between.
  | "two_fingers"
  // Operation 2 (two-handed): both palms open arms the whole-workspace move,
  // both fists confirm it.
  | "two_hands_open"
  | "two_hands_fist";

interface GestureState {
  enabled: boolean; // webcam pipeline running
  // "busy" = the OS refused to hand over the device (another app/browser has
  // the webcam open) — distinct from a user permission denial.
  permission: "unknown" | "granted" | "denied" | "busy";
  currentGesture: GestureName;
  confidence: number;
  handCount: number;
  cursor: { x: number; y: number } | null; // normalized 0-1 air-cursor

  setEnabled: (v: boolean) => void;
  setPermission: (p: GestureState["permission"]) => void;
  update: (g: {
    currentGesture: GestureName;
    confidence: number;
    handCount: number;
    cursor: { x: number; y: number } | null;
  }) => void;
}

export const useGestureStore = create<GestureState>((set) => ({
  enabled: false,
  permission: "unknown",
  currentGesture: "none",
  confidence: 0,
  handCount: 0,
  cursor: null,
  setEnabled: (enabled) => set({ enabled }),
  setPermission: (permission) => set({ permission }),
  update: (g) => set(g),
}));
