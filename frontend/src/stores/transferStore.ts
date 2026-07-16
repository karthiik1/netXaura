// Pending transfers + toast + activity feed state (§7).
import { create } from "zustand";

import type { Tab, TransferType } from "../types/api";

export interface PendingTransfer {
  transfer_id: string;
  sender_device_id: string;
  transfer_type: TransferType;
  // Set when the sender aimed this offer at one device (§5.3); null = anyone.
  target_device_id: string | null;
  preview: { title?: string; excerpt?: string; length?: number };
}

export interface Toast {
  id: string;
  kind: "info" | "success" | "warn" | "error";
  text: string;
}

// A card in flight, rendered by TransferAnimation (§7.4). Local per client.
export interface FlightCard {
  id: string;
  title: string;
  fromDeviceId: string;
  toDeviceId: string;
  role: "sender" | "receiver";
}

interface TransferState {
  incoming: PendingTransfer[];
  outgoingId: string | null; // this device's own pending transfer, if any
  // Sticky aim: when set, sends are targeted at this member (§5.3). Toggled by
  // clicking a member in the list; cleared when they disconnect.
  targetDeviceId: string | null;
  toasts: Toast[];
  flights: FlightCard[];
  // Bumped on every transfer_completed in the room (not just our own) so the
  // activity panel refetches even when this device was a bystander.
  historyBump: number;

  // --- tab-move sequence (operation 1: palm→fist send, fist→palm receive) ---
  // Tab highlighted by the sender's open palm, awaiting the fist confirm.
  armedTabId: string | null;
  // Tab dismissed from this device when the fist confirmed the move. Restored
  // on expiry/error, deleted for real once someone claims it.
  movedTab: Tab | null;
  movedTransferId: string | null; // set by the transfer_initiated ack

  // --- workspace-move sequence (operation 2: both palms arm, both fists send;
  // fist→palm receives, same as op 1). The all-tabs analogue of the above. ---
  // True while every tab is highlighted awaiting the two-fists confirm.
  armedWorkspace: boolean;
  // All tabs dismissed from this device when both fists confirmed the move.
  // Restored on expiry/error, deleted for real once someone claims them.
  movedTabs: Tab[] | null;
  movedWorkspaceId: string | null; // set by the transfer_initiated ack

  addIncoming: (t: PendingTransfer) => void;
  removeIncoming: (id: string) => void;
  setOutgoing: (id: string | null) => void;
  setTarget: (deviceId: string | null) => void;
  bumpHistory: () => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: string) => void;
  addFlight: (f: FlightCard) => void;
  removeFlight: (id: string) => void;

  setArmedTab: (id: string | null) => void;
  beginMove: (tab: Tab) => void;
  attachMoveId: (transferId: string) => void;
  // Clears the in-flight move and hands the tab back to the caller, which
  // decides its fate (restore locally vs delete from the server).
  settleMove: () => Tab | null;

  setArmedWorkspace: (on: boolean) => void;
  beginWorkspaceMove: (tabs: Tab[]) => void;
  attachWorkspaceMoveId: (transferId: string) => void;
  // Clears the in-flight workspace move and hands all the tabs back to the
  // caller (restore locally vs delete from the server), mirroring settleMove.
  settleWorkspaceMove: () => Tab[] | null;
}

export const useTransferStore = create<TransferState>((set, get) => ({
  incoming: [],
  outgoingId: null,
  targetDeviceId: null,
  toasts: [],
  flights: [],
  historyBump: 0,
  armedTabId: null,
  movedTab: null,
  movedTransferId: null,
  armedWorkspace: false,
  movedTabs: null,
  movedWorkspaceId: null,

  addIncoming: (t) => set({ incoming: [...get().incoming, t] }),
  removeIncoming: (id) =>
    set({ incoming: get().incoming.filter((t) => t.transfer_id !== id) }),
  setOutgoing: (outgoingId) => set({ outgoingId }),
  setTarget: (targetDeviceId) => set({ targetDeviceId }),
  bumpHistory: () => set({ historyBump: get().historyBump + 1 }),
  toast: (kind, text) => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  addFlight: (f) => set({ flights: [...get().flights, f] }),
  removeFlight: (id) => set({ flights: get().flights.filter((f) => f.id !== id) }),

  setArmedTab: (armedTabId) => {
    set({ armedTabId });
    if (armedTabId) {
      // The palm→fist window: highlight fades on its own if no fist follows.
      setTimeout(() => {
        if (get().armedTabId === armedTabId) set({ armedTabId: null });
      }, 4000);
    }
  },
  beginMove: (movedTab) => set({ movedTab, movedTransferId: null }),
  attachMoveId: (movedTransferId) => set({ movedTransferId }),
  settleMove: () => {
    const tab = get().movedTab;
    set({ movedTab: null, movedTransferId: null });
    return tab;
  },

  setArmedWorkspace: (armedWorkspace) => {
    set({ armedWorkspace });
    if (armedWorkspace) {
      // The both-palms→both-fists window: the highlight fades on its own if no
      // fists follow (mirrors setArmedTab).
      setTimeout(() => {
        if (get().armedWorkspace) set({ armedWorkspace: false });
      }, 4000);
    }
  },
  beginWorkspaceMove: (movedTabs) => set({ movedTabs, movedWorkspaceId: null }),
  attachWorkspaceMoveId: (movedWorkspaceId) => set({ movedWorkspaceId }),
  settleWorkspaceMove: () => {
    const tabs = get().movedTabs;
    set({ movedTabs: null, movedWorkspaceId: null });
    return tabs;
  },
}));
