// Owns the WorkspaceSocket lifecycle and maps server messages into the stores.
// On (re)connect it re-fetches members/tabs via REST so state is consistent
// after a dropped connection (§8).
import { useEffect, useRef } from "react";

import { api } from "../services/api";
import { type Envelope, WorkspaceSocket } from "../services/ws";
import { usePresenceStore } from "../stores/presenceStore";
import { useTransferStore } from "../stores/transferStore";
import { storedToken, useWorkspaceStore } from "../stores/workspaceStore";
import type { Tab, TransferType } from "../types/api";

const ERROR_TEXT: Record<string, string> = {
  self_transfer_denied: "You can't send content to yourself.",
  sender_already_has_pending_transfer: "You already have a transfer waiting.",
  transfer_already_claimed: "Someone else already grabbed that transfer.",
  transfer_expired: "That transfer expired.",
  no_recipients_available: "No one else is connected to receive this.",
  transfer_not_found: "That transfer is no longer available.",
  invalid_message: "Something went wrong with that action.",
  target_not_available: "That device isn't connected right now.",
  not_transfer_target: "That transfer was aimed at someone else.",
  rate_limited: "Slow down a little — too many actions at once.",
};

export function useWebSocket() {
  const socketRef = useRef<WorkspaceSocket | null>(null);
  const code = useWorkspaceStore((s) => s.code);
  const deviceId = useWorkspaceStore((s) => s.deviceId);
  const authToken = useWorkspaceStore((s) => s.authToken);

  useEffect(() => {
    if (!code || !authToken) return;
    const ws = new WorkspaceSocket(code, deviceId, authToken);
    socketRef.current = ws;

    const wsStore = useWorkspaceStore.getState;

    // Consecutive failed connects without an "open" in between usually mean
    // our token is dead (rotated by a duplicate join or another tab). After a
    // few, refresh credentials over REST — a changed token re-creates the
    // socket via this effect's deps instead of hammering with the dead one.
    let failedConnects = 0;
    let refreshing = false;

    const offStatus = ws.onStatus(async (status) => {
      wsStore().setConnection(status);
      if (status === "closed" && ++failedConnects >= 3 && !refreshing) {
        refreshing = true;
        try {
          const res = await api.join(
            code,
            deviceId,
            wsStore().displayName || "Guest",
            storedToken(code),
          );
          failedConnects = 0;
          wsStore().refreshAuthToken(code, res.auth_token);
        } catch {
          /* workspace gone or offline — keep backing off */
        } finally {
          refreshing = false;
        }
      }
      if (status === "open") {
        failedConnects = 0;
        // The join snapshot predates our socket, so mark ourselves live.
        wsStore().memberJoined(deviceId, wsStore().displayName || "Guest");
        // Nothing of ours survives a reconnect: the server cancels a device's
        // pending transfer the moment its socket drops (`drop_sender`, §5), and
        // we were offline for the `transfer_expired` that announced it. So clear
        // the in-flight marker — it gates every send, and a stale one would wedge
        // this device into never sending again — and stop hiding whatever was
        // mid-move, which the resync below restores from the DB.
        const tx = useTransferStore.getState();
        tx.setOutgoing(null);
        tx.settleMove();
        tx.settleWorkspaceMove();
        // Resync after connect/reconnect (own tabs only — tabs are per-device).
        try {
          wsStore().setTabs(await api.listTabs(code, deviceId));
        } catch {
          /* transient; will retry on next reconnect */
        }
      }
    });

    const offMsg = ws.onMessage((msg: Envelope) => handle(msg, code, deviceId));
    ws.connect();

    return () => {
      offStatus();
      offMsg();
      ws.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, deviceId, authToken]);

  return socketRef;
}

export function handle(msg: Envelope, code: string, deviceId: string) {
  const ws = useWorkspaceStore.getState();
  const tx = useTransferStore.getState();
  const presence = usePresenceStore.getState();
  const p = msg.payload as Record<string, unknown>;

  switch (msg.type) {
    case "member_joined":
      ws.memberJoined(p.device_id as string, (p.display_name as string) ?? "Guest");
      break;
    case "member_left":
      ws.memberLeft(p.device_id as string);
      presence.remove(p.device_id as string);
      if (useTransferStore.getState().targetDeviceId === p.device_id) {
        tx.setTarget(null); // aimed-at device left; fall back to broadcast
      }
      break;

    case "transfer_initiated":
      // Server ack with our own offer's id — the pending broadcast excludes
      // the sender, so this is how completion/expiry get correlated.
      tx.setOutgoing(p.transfer_id as string);
      if (tx.movedTab && !tx.movedTransferId) {
        tx.attachMoveId(p.transfer_id as string);
      }
      if (tx.movedTabs && !tx.movedWorkspaceId) {
        tx.attachWorkspaceMoveId(p.transfer_id as string);
      }
      break;

    case "transfer_pending":
      tx.addIncoming({
        transfer_id: p.transfer_id as string,
        sender_device_id: p.sender_device_id as string,
        transfer_type: p.transfer_type as TransferType,
        target_device_id: (p.target_device_id as string | null) ?? null,
        preview: (p.preview as { title?: string }) ?? {},
      });
      break;

    case "transfer_expired":
      tx.removeIncoming(p.transfer_id as string);
      if (tx.movedTransferId === p.transfer_id) {
        // Nobody caught the moved tab within the TTL — bring it home.
        const moved = tx.settleMove();
        if (moved) {
          ws.upsertTab(moved);
          ws.setActiveTab(moved.id);
          tx.setOutgoing(null);
          tx.toast("warn", `No one caught "${moved.title}" — it came back`);
        }
      } else if (tx.movedWorkspaceId === p.transfer_id) {
        // Nobody caught the whole workspace within the TTL — restore every tab.
        const movedTabs = tx.settleWorkspaceMove();
        if (movedTabs) {
          movedTabs.forEach((t) => ws.upsertTab(t));
          ws.setActiveTab(movedTabs[0]?.id ?? null);
          tx.setOutgoing(null);
          tx.toast("warn", "No one caught the tabs — they came back");
        }
      } else if (tx.outgoingId === p.transfer_id) {
        tx.setOutgoing(null);
        tx.toast("warn", "Transfer expired");
      }
      break;

    case "transfer_completed": {
      const sender = p.sender_device_id as string;
      const receiver = p.receiver_device_id as string;
      // Broadcast to the room: bystanders just clear the dead offer and
      // refresh the activity feed; only the two ends animate and toast.
      tx.removeIncoming(p.transfer_id as string);
      tx.bumpHistory();
      if (sender === deviceId) tx.setOutgoing(null);
      if (sender === deviceId && tx.movedTransferId === p.transfer_id) {
        // Move semantics: the receiver now has its copy; delete the original
        // for real (it was only hidden locally until this point). The local
        // removeTab is a no-op unless a mid-flight resync resurrected it.
        const moved = tx.settleMove();
        if (moved) {
          ws.removeTab(moved.id);
          void api.deleteTab(moved.id).catch(() => {});
        }
      }
      if (sender === deviceId && tx.movedWorkspaceId === p.transfer_id) {
        // Op 2 move semantics: the receiver now holds copies of every tab;
        // delete all the originals for real (they were only hidden until now).
        const movedTabs = tx.settleWorkspaceMove();
        movedTabs?.forEach((t) => {
          ws.removeTab(t.id);
          void api.deleteTab(t.id).catch(() => {});
        });
      }
      if (sender === deviceId || receiver === deviceId) {
        // Two independent local animations, keyed off this event (§7.4).
        tx.addFlight({
          id: p.transfer_id as string,
          title: (p.transfer_type as string) === "workspace" ? "Workspace" : "Content",
          fromDeviceId: sender,
          toDeviceId: receiver,
          role: sender === deviceId ? "sender" : "receiver",
        });
        tx.toast("success", "Transfer completed");
      }
      break;
    }

    case "tab_synced": {
      const kind = p.kind as string;
      if (kind === "tab") {
        ws.upsertTab(p.tab as Tab);
        ws.setActiveTab((p.tab as Tab).id);
      } else if (kind === "selection") {
        // Insert into the active tab at its caret (§0). The editor reads this.
        const sel = p.selection as { text: string };
        const active = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (active) {
          window.dispatchEvent(
            new CustomEvent("netxaura:insert", { detail: { text: sel.text } }),
          );
        }
      }
      break;
    }

    case "workspace_synced": {
      const tabs = (p.tabs as Tab[]) ?? [];
      tabs.forEach((t) => ws.upsertTab(t));
      break;
    }

    case "error": {
      const codeStr = (p.code as string) ?? "invalid_message";
      tx.toast("error", ERROR_TEXT[codeStr] ?? (p.message as string) ?? "Error");
      if (tx.outgoingId) tx.setOutgoing(null);
      // A move whose initiate failed (no ack yet, e.g. no one else connected):
      // un-dismiss the tab(s). Moves that were acked settle via expiry/completion.
      if (tx.movedTab && !tx.movedTransferId) {
        const moved = tx.settleMove();
        if (moved) {
          ws.upsertTab(moved);
          ws.setActiveTab(moved.id);
        }
      }
      if (tx.movedTabs && !tx.movedWorkspaceId) {
        const movedTabs = tx.settleWorkspaceMove();
        if (movedTabs) {
          movedTabs.forEach((t) => ws.upsertTab(t));
          ws.setActiveTab(movedTabs[0]?.id ?? null);
          tx.setArmedWorkspace(false);
        }
      }
      break;
    }

    case "cursor_move":
      presence.cursorMoved(p.device_id as string, p.x as number, p.y as number);
      break;
    case "member_gesturing":
      presence.gestured(p.device_id as string, (p.gesture as string) ?? "");
      break;
  }
  void code;
}
