// Workspace + tabs + members state (single home for state — §7).
import { create } from "zustand";

import type { Member, Tab } from "../types/api";

const DEVICE_KEY = "netxaura.device_id";

// sessionStorage, deliberately: identity is per BROWSER TAB, so every tab is
// its own device (survives reloads, but a new tab = a new device). Two tabs of
// one browser can then transfer to each other — with localStorage they would
// share one identity and the server would refuse the "self" transfer.
function ensureDeviceId(): string {
  let id = sessionStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// Per-workspace WS credential issued by the REST join (§5.1). Also per-tab:
// the token belongs to (workspace, device), and the device is this tab.
export function storedToken(code: string): string | null {
  return sessionStorage.getItem(`netxaura.token.${code}`);
}

function persistToken(code: string, token: string) {
  sessionStorage.setItem(`netxaura.token.${code}`, token);
}

interface WorkspaceState {
  deviceId: string;
  displayName: string;
  code: string | null;
  authToken: string | null;
  members: Member[];
  tabs: Tab[];
  activeTabId: string | null;
  selectionText: string;
  connection: "connecting" | "open" | "closed";

  setIdentity: (displayName: string) => void;
  enter: (code: string, authToken: string, members: Member[], tabs: Tab[]) => void;
  // Refresh just the WS credential (token rotated server-side) without
  // clobbering live tabs/members state the way enter() would.
  refreshAuthToken: (code: string, authToken: string) => void;
  setConnection: (s: WorkspaceState["connection"]) => void;
  setMembers: (m: Member[]) => void;
  memberJoined: (deviceId: string, displayName: string) => void;
  memberLeft: (deviceId: string) => void;
  setTabs: (t: Tab[]) => void;
  upsertTab: (t: Tab) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
  setSelectionText: (text: string) => void;
  patchActiveTabContent: (content: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  deviceId: ensureDeviceId(),
  displayName: localStorage.getItem("netxaura.name") ?? "",
  code: null,
  authToken: null,
  members: [],
  tabs: [],
  activeTabId: null,
  selectionText: "",
  connection: "closed",

  setIdentity: (displayName) => {
    localStorage.setItem("netxaura.name", displayName);
    set({ displayName });
  },
  enter: (code, authToken, members, tabs) => {
    persistToken(code, authToken);
    set({ code, authToken, members, tabs, activeTabId: tabs[0]?.id ?? null });
  },
  refreshAuthToken: (code, authToken) => {
    persistToken(code, authToken);
    set({ authToken });
  },
  setConnection: (connection) => set({ connection }),
  setMembers: (members) => set({ members }),
  memberJoined: (deviceId, displayName) => {
    const exists = get().members.some((m) => m.device_id === deviceId);
    if (exists) {
      set({
        members: get().members.map((m) =>
          m.device_id === deviceId ? { ...m, is_connected: true, display_name: displayName } : m,
        ),
      });
    } else {
      set({
        members: [
          ...get().members,
          {
            device_id: deviceId,
            display_name: displayName,
            is_connected: true,
            joined_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          },
        ],
      });
    }
  },
  memberLeft: (deviceId) =>
    set({
      members: get().members.map((m) =>
        m.device_id === deviceId ? { ...m, is_connected: false } : m,
      ),
    }),
  setTabs: (tabs) => set({ tabs }),
  upsertTab: (t) => {
    const tabs = get().tabs;
    const idx = tabs.findIndex((x) => x.id === t.id);
    const next = idx >= 0 ? tabs.map((x) => (x.id === t.id ? t : x)) : [...tabs, t];
    set({ tabs: next, activeTabId: get().activeTabId ?? t.id });
  },
  removeTab: (id) => {
    const tabs = get().tabs.filter((t) => t.id !== id);
    const activeTabId =
      get().activeTabId === id ? (tabs[0]?.id ?? null) : get().activeTabId;
    set({ tabs, activeTabId });
  },
  setActiveTab: (activeTabId) => set({ activeTabId }),
  setSelectionText: (selectionText) => set({ selectionText }),
  patchActiveTabContent: (content) => {
    const { activeTabId, tabs } = get();
    set({
      tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, content } : t)),
    });
  },
}));
