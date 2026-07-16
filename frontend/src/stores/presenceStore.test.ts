import { beforeEach, describe, expect, it } from "vitest";

import { CURSOR_STALE_MS, usePresenceStore } from "./presenceStore";

describe("presenceStore", () => {
  beforeEach(() => {
    usePresenceStore.setState({ peers: {} });
  });

  it("records cursor positions per device", () => {
    const s = usePresenceStore.getState();
    s.cursorMoved("dev-1", 0.1, 0.2, 1000);
    s.cursorMoved("dev-2", 0.5, 0.6, 1000);
    s.cursorMoved("dev-1", 0.3, 0.4, 1100);

    const peers = usePresenceStore.getState().peers;
    expect(peers["dev-1"]).toMatchObject({ x: 0.3, y: 0.4, updatedAt: 1100 });
    expect(peers["dev-2"]).toMatchObject({ x: 0.5, y: 0.6 });
  });

  it("attaches gestures only to peers with a known cursor", () => {
    const s = usePresenceStore.getState();
    s.gestured("ghost", "ok", 1000); // never sent a cursor
    expect(usePresenceStore.getState().peers["ghost"]).toBeUndefined();

    s.cursorMoved("dev-1", 0.1, 0.2, 1000);
    s.gestured("dev-1", "two_hands_fist", 1200);
    expect(usePresenceStore.getState().peers["dev-1"].gesture).toBe("two_hands_fist");
  });

  it("prunes stale peers but keeps fresh ones", () => {
    const s = usePresenceStore.getState();
    s.cursorMoved("old", 0.1, 0.1, 0);
    s.cursorMoved("new", 0.2, 0.2, CURSOR_STALE_MS);
    s.prune(CURSOR_STALE_MS + 1);

    const peers = usePresenceStore.getState().peers;
    expect(peers["old"]).toBeUndefined();
    expect(peers["new"]).toBeDefined();
  });

  it("removes a peer on member_left", () => {
    const s = usePresenceStore.getState();
    s.cursorMoved("dev-1", 0.1, 0.2, 1000);
    s.remove("dev-1");
    expect(usePresenceStore.getState().peers["dev-1"]).toBeUndefined();
  });
});
