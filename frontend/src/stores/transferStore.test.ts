import { beforeEach, describe, expect, it } from "vitest";

import { usePresenceStore } from "./presenceStore";
import { useTransferStore } from "./transferStore";

function offer(id: string, target: string | null = null) {
  return {
    transfer_id: id,
    sender_device_id: "sender",
    transfer_type: "tab" as const,
    target_device_id: target,
    preview: { title: "main.py" },
  };
}

describe("transferStore", () => {
  beforeEach(() => {
    useTransferStore.setState({
      incoming: [],
      outgoingId: null,
      targetDeviceId: null,
      toasts: [],
      flights: [],
      armedWorkspace: false,
      movedTabs: null,
      movedWorkspaceId: null,
    });
    usePresenceStore.setState({ peers: {} });
  });

  it("tracks incoming offers by id", () => {
    const s = useTransferStore.getState();
    s.addIncoming(offer("t1"));
    s.addIncoming(offer("t2", "me"));
    expect(useTransferStore.getState().incoming).toHaveLength(2);

    s.removeIncoming("t1");
    const left = useTransferStore.getState().incoming;
    expect(left).toHaveLength(1);
    expect(left[0].transfer_id).toBe("t2");
    expect(left[0].target_device_id).toBe("me");
  });

  it("toggles the sticky aim target", () => {
    const s = useTransferStore.getState();
    s.setTarget("dev-b");
    expect(useTransferStore.getState().targetDeviceId).toBe("dev-b");
    s.setTarget(null);
    expect(useTransferStore.getState().targetDeviceId).toBeNull();
  });

  it("holds a workspace move in flight and hands every tab back on settle", () => {
    const tabs = [
      { id: "a", title: "one" },
      { id: "b", title: "two" },
    ] as unknown as import("../types/api").Tab[];
    const s = useTransferStore.getState();

    s.beginWorkspaceMove(tabs);
    s.attachWorkspaceMoveId("wt1");
    expect(useTransferStore.getState().movedTabs).toHaveLength(2);
    expect(useTransferStore.getState().movedWorkspaceId).toBe("wt1");

    // Settling returns the held tabs and clears the in-flight state (so a later
    // completion/expiry for the same id is a no-op).
    const returned = useTransferStore.getState().settleWorkspaceMove();
    expect(returned?.map((t) => t.id)).toEqual(["a", "b"]);
    expect(useTransferStore.getState().movedTabs).toBeNull();
    expect(useTransferStore.getState().movedWorkspaceId).toBeNull();
    expect(useTransferStore.getState().settleWorkspaceMove()).toBeNull();
  });
});
