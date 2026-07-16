// Tests the WS message -> store mapping (the exported `handle`), which is the
// seam between the socket and the UI. No real socket involved.
import { beforeEach, describe, expect, it } from "vitest";

import type { Envelope } from "../services/ws";
import { usePresenceStore } from "../stores/presenceStore";
import { useTransferStore } from "../stores/transferStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { handle } from "./useWebSocket";

const ME = "device-me";

function msg(type: string, payload: Record<string, unknown>): Envelope {
  return { id: null, type, payload, ts: "" };
}

describe("useWebSocket handle()", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ members: [], tabs: [], activeTabId: null });
    useTransferStore.setState({
      incoming: [],
      outgoingId: null,
      targetDeviceId: null,
      toasts: [],
      flights: [],
      armedTabId: null,
      movedTab: null,
      movedTransferId: null,
    });
    usePresenceStore.setState({ peers: {} });
  });

  it("adds and marks members on join/leave", () => {
    handle(msg("member_joined", { device_id: "dev-b", display_name: "Bee" }), "C", ME);
    expect(useWorkspaceStore.getState().members).toHaveLength(1);

    handle(msg("member_left", { device_id: "dev-b" }), "C", ME);
    expect(useWorkspaceStore.getState().members[0].is_connected).toBe(false);
  });

  it("clears the sticky aim when the targeted member leaves", () => {
    useTransferStore.getState().setTarget("dev-b");
    handle(msg("member_left", { device_id: "dev-b" }), "C", ME);
    expect(useTransferStore.getState().targetDeviceId).toBeNull();
  });

  it("records incoming offers including targeting", () => {
    handle(
      msg("transfer_pending", {
        transfer_id: "t1",
        sender_device_id: "dev-b",
        transfer_type: "tab",
        target_device_id: ME,
        preview: { title: "main.py" },
      }),
      "C",
      ME,
    );
    const incoming = useTransferStore.getState().incoming;
    expect(incoming).toHaveLength(1);
    expect(incoming[0].target_device_id).toBe(ME);
  });

  it("feeds remote cursors into the presence store", () => {
    handle(msg("cursor_move", { device_id: "dev-b", x: 0.4, y: 0.6 }), "C", ME);
    expect(usePresenceStore.getState().peers["dev-b"]).toMatchObject({
      x: 0.4,
      y: 0.6,
    });

    handle(msg("member_gesturing", { device_id: "dev-b", gesture: "ok" }), "C", ME);
    expect(usePresenceStore.getState().peers["dev-b"].gesture).toBe("ok");
  });

  // --- operation 1: tab move (palm→fist / fist→palm) ------------------------

  const MOVED_TAB = {
    id: "tab-1",
    workspace_id: "ws-1",
    owner_device_id: ME,
    type: "rich_text",
    title: "Notes",
    content: "hello",
    language: null,
    created_at: "",
    updated_at: "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  it("attaches the initiate ack to an in-flight move", () => {
    useTransferStore.getState().beginMove(MOVED_TAB);
    handle(msg("transfer_initiated", { transfer_id: "t5", transfer_type: "tab" }), "C", ME);
    expect(useTransferStore.getState().outgoingId).toBe("t5");
    expect(useTransferStore.getState().movedTransferId).toBe("t5");
  });

  it("restores the moved tab when nobody claims it in time", () => {
    useTransferStore.getState().beginMove(MOVED_TAB);
    useTransferStore.getState().attachMoveId("t5");
    handle(msg("transfer_expired", { transfer_id: "t5" }), "C", ME);
    expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toContain("tab-1");
    expect(useTransferStore.getState().movedTab).toBeNull();
  });

  it("does not restore the moved tab when someone else's transfer expires", () => {
    useTransferStore.getState().beginMove(MOVED_TAB);
    useTransferStore.getState().attachMoveId("t5");
    handle(msg("transfer_expired", { transfer_id: "other" }), "C", ME);
    expect(useWorkspaceStore.getState().tabs).toHaveLength(0);
    expect(useTransferStore.getState().movedTransferId).toBe("t5");
  });

  it("restores an unacked move when the initiate errors (e.g. alone in the room)", () => {
    useTransferStore.getState().beginMove(MOVED_TAB);
    handle(msg("error", { code: "no_recipients_available", message: "…" }), "C", ME);
    expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toContain("tab-1");
    expect(useTransferStore.getState().movedTab).toBeNull();
  });

  it("settles the move (no local restore) when the receiver claims it", () => {
    useTransferStore.getState().beginMove(MOVED_TAB);
    useTransferStore.getState().attachMoveId("t5");
    handle(
      msg("transfer_completed", {
        transfer_id: "t5",
        sender_device_id: ME,
        receiver_device_id: "dev-b",
        transfer_type: "tab",
      }),
      "C",
      ME,
    );
    expect(useWorkspaceStore.getState().tabs).toHaveLength(0);
    expect(useTransferStore.getState().movedTab).toBeNull();
    expect(useTransferStore.getState().movedTransferId).toBeNull();
  });

  it("clears the outgoing marker when the sender's transfer completes", () => {
    useTransferStore.getState().setOutgoing("t9");
    handle(
      msg("transfer_completed", {
        transfer_id: "t9",
        sender_device_id: ME,
        receiver_device_id: "dev-b",
        transfer_type: "tab",
      }),
      "C",
      ME,
    );
    expect(useTransferStore.getState().outgoingId).toBeNull();
  });
});
