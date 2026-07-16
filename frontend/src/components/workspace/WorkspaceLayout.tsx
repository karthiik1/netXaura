// Assembles the workspace view (§7.2) and owns the action layer that BOTH the
// buttons and the gestures call, so there is exactly one path per action (§0).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Brand wordmark: static type with the sheen-on-hover color wave. Not a
// control — arrow cursor, no text selection.
function BrandWordmark() {
  return (
    <span className="group mr-3 flex shrink-0 cursor-default select-none items-center self-center py-2">
      <span className="brand-wordmark font-display text-xl font-bold tracking-tight">
        net<span className="bg-gradient-to-br from-aura to-signal bg-clip-text text-transparent">X</span>aura
      </span>
    </span>
  );
}
import { useNavigate, useParams } from "react-router-dom";

import { useWebSocket } from "../../hooks/useWebSocket";
import { getActiveEditor } from "../../lib/activeEditor";
import { api, ApiError } from "../../services/api";
import type { WorkspaceSocket } from "../../services/ws";
import { useGestureStore } from "../../stores/gestureStore";
import { useTransferStore } from "../../stores/transferStore";
import { storedToken, useWorkspaceStore } from "../../stores/workspaceStore";
import { RichEditor } from "../editors/RichEditor";
import { TabBar } from "../editors/TabBar";
import { AirCursor } from "../gestures/AirCursor";
import { FloatingCameraPanel } from "../gestures/FloatingCameraPanel";
import { RemoteCursors } from "../gestures/RemoteCursors";
import { HelpOverlay } from "../ui/HelpOverlay";
import type { GestureEvent } from "../gestures/useGestureRecognition";
import { PendingTransferToast } from "../transfers/PendingTransferToast";
import { TransferAnimation } from "../transfers/TransferAnimation";
import { Button } from "../ui/Button";
import { ToastStack } from "../ui/ToastStack";
import { WorkspaceCodeDisplay } from "./WorkspaceCodeDisplay";

// Dedupe concurrent joins (StrictMode double-mount, double navigation): a
// second tokenless join ROTATES the member token server-side and can
// invalidate the one the first response delivered — a race that dead-ends the
// socket in 403s. Both callers must share one request.
const inflightJoins = new Map<string, ReturnType<typeof api.join>>();
function joinOnce(code: string, deviceId: string, name: string, token: string | null) {
  const key = `${code}:${deviceId}`;
  let p = inflightJoins.get(key);
  if (!p) {
    p = api.join(code, deviceId, name, token).finally(() => inflightJoins.delete(key));
    inflightJoins.set(key, p);
  }
  return p;
}

// Autosave is debounced (§9), so the DB can lag the editor by up to ~800ms. A
// tab/workspace transfer copies the tab's content FROM the DB on the server, so
// text typed just before the gesture would be lost. Flush the active editor's
// current content to the DB (and the local store) before any transfer so the
// duplicate/move carries exactly what's on screen. Non-active tabs are already
// persisted (they saved while they were the active editor).
function flushActiveContent(): void {
  const editor = getActiveEditor();
  const st = useWorkspaceStore.getState();
  const active = st.tabs.find((t) => t.id === st.activeTabId);
  if (!editor || !active) return;
  const content = JSON.stringify(editor.getJSON());
  if (content === active.content) return;
  st.upsertTab({ ...active, content });
  void api.updateTab(active.id, { content }).catch(() => {});
}

export function WorkspaceLayout() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const store = useWorkspaceStore;
  const enter = store((s) => s.enter);
  const displayName = store((s) => s.displayName);
  const deviceId = store((s) => s.deviceId);
  const tabs = store((s) => s.tabs);
  const activeTabId = store((s) => s.activeTabId);

  const socketRef = useWebSocket();

  // Camera + gesture recognition are on by default in a workspace; the panel's
  // on/off button opts out, and a permission denial degrades to keys (§6.1).
  useEffect(() => {
    useGestureStore.getState().setEnabled(true);
  }, []);

  // Join via REST once (which issues the WS auth token), then the socket —
  // driven by `code` + `authToken` in the store — opens.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const name = displayName || "Guest";
        const res = await joinOnce(code, deviceId, name, storedToken(code));
        if (!alive) return;
        let tabs = res.tabs;
        // Never land in an empty workspace: seed a blank, empty Untitled
        // document so the editor is always present. Only the first person into
        // a fresh workspace creates it.
        if (tabs.length === 0) {
          const first = await api
            .createTab(code, {
              owner_device_id: deviceId,
              type: "rich_text",
              title: "Untitled",
              content: "",
              language: null,
            })
            .catch(() => null);
          if (first) tabs = [first];
        }
        if (!alive) return;
        enter(code, res.auth_token, res.members, tabs);
        setReady(true);
      } catch (e) {
        setFatal(e instanceof ApiError ? e.message : "Could not join this workspace.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, deviceId, displayName, enter]);

  const send = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      const sock = socketRef.current as WorkspaceSocket | null;
      sock?.send(type, payload);
    },
    [socketRef],
  );

  // Stream the local air cursor to the room, throttled to ~20 Hz so a 60fps
  // hand doesn't flood the socket (the server also rate-limits telemetry).
  useEffect(() => {
    let lastSentAt = 0;
    return useGestureStore.subscribe((s) => {
      const c = s.cursor;
      if (!c) return;
      const now = performance.now();
      if (now - lastSentAt < 50) return;
      lastSentAt = now;
      send("cursor_move", { x: c.x, y: c.y });
    });
  }, [send]);

  // --- the single action layer (buttons + gestures both call these) ---
  const actions = useMemo(() => {
    // Sticky aim (§5.3): when a member is targeted, every send goes only to
    // them; otherwise it's a broadcast offer anyone can claim.
    const initiate = (transfer_type: string, payload: Record<string, unknown>) =>
      send("transfer_initiate", {
        transfer_type,
        payload,
        target_device_id: useTransferStore.getState().targetDeviceId,
      });
    // A held pose re-fires every cooldown (~800ms) while a transfer stays
    // pending for the whole TTL (~10s), so the classifier will ask to send the
    // same thing several times over. The server allows one pending transfer per
    // sender (§5.2) and rejects the rest; every send bails here instead, so the
    // repeat never reaches the socket and never bounces back as an error.
    const sendInFlight = () => useTransferStore.getState().outgoingId !== null;
    return {
      sendSelection: () => {
        if (sendInFlight()) return;
        const st = useWorkspaceStore.getState();
        const text = st.selectionText.trim();
        if (!text) return useTransferStore.getState().toast("warn", "Select something first");
        const active = st.tabs.find((t) => t.id === st.activeTabId);
        initiate("selection", { text, language: active?.language ?? null });
        useTransferStore.getState().setOutgoing("selection");
      },
      sendTab: () => {
        if (sendInFlight()) return;
        const st = useWorkspaceStore.getState();
        const active = st.tabs.find((t) => t.id === st.activeTabId);
        if (!active) return;
        initiate("tab", { tab_id: active.id, title: active.title });
        useTransferStore.getState().setOutgoing("tab");
      },
      // Operation 1 step 1 (sender): open palm highlights the active tab. The
      // highlight is the feedback — no toast (it fires on every re-read of a
      // held palm, and the tab is already lit up).
      armActiveTab: () => {
        const st = useWorkspaceStore.getState();
        const active = st.tabs.find((t) => t.id === st.activeTabId);
        if (!active) return false;
        useTransferStore.getState().setArmedTab(active.id);
        return true;
      },
      // Operation 1 step 2 (sender): fist confirms — the tab leaves this
      // device NOW and lives on the server for the 10s claim window.
      sendActiveTabMove: () => {
        if (sendInFlight()) return;
        const st = useWorkspaceStore.getState();
        const active = st.tabs.find((t) => t.id === st.activeTabId);
        const tx = useTransferStore.getState();
        tx.setArmedTab(null);
        if (!active) return;
        // Never dismiss the tab over a dead socket — the initiate would be
        // silently dropped and the tab stuck hidden with nothing in flight.
        if (st.connection !== "open") {
          tx.toast("error", "Not connected — try again in a moment");
          return;
        }
        flushActiveContent(); // the moved tab must carry the on-screen content
        // Re-read after the flush: it replaced the tab in the store with one
        // carrying the on-screen content, so `active` is now a stale copy. The
        // snapshot below is what comes back if nobody catches this, and handing
        // back the pre-flush copy would wipe whatever was typed just before the
        // gesture (autosave is debounced ~800ms behind the editor).
        const moving = useWorkspaceStore.getState().tabs.find((t) => t.id === active.id) ?? active;
        initiate("tab", { tab_id: moving.id, title: moving.title });
        tx.beginMove(moving);
        st.removeTab(moving.id);
        tx.setOutgoing("pending");
      },
      // Operation 3 step 1 (source): two fingers highlight the active tab for a
      // COPY. Reuses the move-arm highlight — the sequence state decides whether
      // the fist that follows moves (op 1) or duplicates (op 3) the tab.
      armActiveTabCopy: () => {
        const st = useWorkspaceStore.getState();
        const active = st.tabs.find((t) => t.id === st.activeTabId);
        if (!active) return false;
        useTransferStore.getState().setArmedTab(active.id);
        return true;
      },
      // Operation 3 step 2 (source): fist confirms the COPY. Unlike the move,
      // the original stays put — this just offers a duplicate to the room, so
      // it's the same non-destructive path as the OK-sign / "T" tab send.
      sendTabCopy: () => {
        if (sendInFlight()) return;
        const st = useWorkspaceStore.getState();
        const active = st.tabs.find((t) => t.id === st.activeTabId);
        const tx = useTransferStore.getState();
        tx.setArmedTab(null);
        if (!active) return;
        flushActiveContent(); // duplicate must carry the on-screen content
        initiate("tab", { tab_id: active.id, title: active.title });
        tx.setOutgoing("tab");
      },
      // Operation 2 step 1 (source): both open palms highlight EVERY tab and
      // ask for confirmation before the whole workspace leaves this device.
      armWorkspaceMove: () => {
        const st = useWorkspaceStore.getState();
        if (st.tabs.length === 0) {
          useTransferStore.getState().toast("warn", "No tabs to transfer");
          return false;
        }
        useTransferStore.getState().setArmedWorkspace(true);
        return true;
      },
      // Operation 2 step 2 (source): both fists confirm — every tab leaves this
      // device NOW and the whole set lives on the server for the 10s claim
      // window (the all-tabs analogue of sendActiveTabMove).
      sendWorkspaceMove: () => {
        if (sendInFlight()) return;
        const st = useWorkspaceStore.getState();
        const tx = useTransferStore.getState();
        tx.setArmedWorkspace(false);
        const tabs = st.tabs;
        if (tabs.length === 0) return;
        // Never dismiss tabs over a dead socket — the initiate would be silently
        // dropped and every tab stuck hidden with nothing in flight.
        if (st.connection !== "open") {
          tx.toast("error", "Not connected — try again in a moment");
          return;
        }
        flushActiveContent(); // the active tab must carry its on-screen content
        // Re-read after the flush for the same reason as sendActiveTabMove: the
        // flush replaced the active tab in the store, so `tabs` holds a stale
        // copy of it, and these snapshots are what come back on expiry.
        const moving = useWorkspaceStore.getState().tabs;
        initiate("workspace", {});
        tx.beginWorkspaceMove(moving);
        moving.forEach((t) => st.removeTab(t.id));
        tx.setOutgoing("pending");
      },
      claim: (transferId: string) => send("transfer_claim", { transfer_id: transferId }),
      // Keyboard twin of fist→palm: catch the first thing (tab or whole
      // workspace) waiting in the air.
      catchTab: () => {
        const wanted = useTransferStore
          .getState()
          .incoming.find((t) => t.transfer_type === "tab" || t.transfer_type === "workspace");
        if (wanted) send("transfer_claim", { transfer_id: wanted.transfer_id });
        else useTransferStore.getState().toast("warn", "Nothing in the air to catch");
      },
    };
  }, [send]);

  // Keyboard shortcuts mirror the gestures (§0): S selection, T tab, W
  // workspace. Lived in TransferControls before the side panel was removed.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "s") actions.sendSelection();
      if (e.key === "t") actions.sendTab();
      // W is the both-hands twin: first press arms (highlights all tabs),
      // second press confirms the whole-workspace move.
      if (e.key === "w") {
        if (useTransferStore.getState().armedWorkspace) actions.sendWorkspaceMove();
        else actions.armWorkspaceMove();
      }
      if (e.key === "m") actions.sendActiveTabMove(); // palm→fist twin
      if (e.key === "d") actions.sendTabCopy(); // two-fingers→fist twin (duplicate)
      if (e.key === "c") actions.catchTab(); // fist→palm/two-fingers twin
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

  // Operation 1 sequencing: gesture ORDER decides the role. Palm→fist on the
  // source sends the active tab (move); fist→palm on the destination catches
  // it. Each step must follow the previous within the window.
  const SEQ_WINDOW_MS = 4000;
  const seqRef = useRef<{
    state:
      | "idle"
      | "armed"
      | "receive_ready"
      | "ws_armed"
      | "copy_armed"
      | "ws_receive_ready";
    at: number;
  }>({
    state: "idle",
    at: 0,
  });
  // Map a fired gesture to an action, using receiver context (an incoming
  // pending transfer) to decide claim-vs-send (§6 vocabulary).
  const onGesture = useCallback(
    (e: GestureEvent) => {
      const incoming = useTransferStore.getState().incoming;
      const wantsTab = incoming.find((t) => t.transfer_type === "tab");
      const wantsWs = incoming.find((t) => t.transfer_type === "workspace");

      const now = performance.now();
      const seq = seqRef.current;
      const fresh = seq.state !== "idle" && now - seq.at <= SEQ_WINDOW_MS;

      if (e.gesture === "open_palm") {
        if (fresh && seq.state === "receive_ready" && wantsTab) {
          // Step 4 (destination): fist then palm — the tab lands here (op 1/3).
          actions.claim(wantsTab.transfer_id);
          seqRef.current = { state: "idle", at: now };
        } else if (fresh && seq.state === "armed") {
          seq.at = now; // palm still open — keep the highlight alive, no re-toast
        } else {
          // Step 1 (source): highlight the active tab, wait for the fist.
          seqRef.current = {
            state: actions.armActiveTab() ? "armed" : "idle",
            at: now,
          };
        }
      } else if (e.gesture === "fist") {
        if (fresh && seq.state === "armed") {
          // Step 2 (source): confirmed — the tab leaves this device.
          actions.sendActiveTabMove();
          seqRef.current = { state: "idle", at: now };
        } else if (fresh && seq.state === "copy_armed") {
          // Op 3 step 2 (source): confirmed — a duplicate is offered, original stays.
          actions.sendTabCopy();
          seqRef.current = { state: "idle", at: now };
        } else if (fresh && seq.state === "receive_ready") {
          seq.at = now; // fist held — stay ready, no re-toast
        } else {
          // Step 3 (destination): "I'm holding something, drop it here." One
          // hand catches a single tab (op 1/3); the whole workspace is caught
          // with two hands (handled in the two_hands_* branches). Only hint when
          // there is actually something to catch — a fist with an empty sky is
          // most often the tail of your own send still being held.
          seqRef.current = { state: "receive_ready", at: now };
          if (wantsTab) {
            useTransferStore.getState().toast("info", "Open your hand to catch the tab");
          }
        }
      } else if (e.gesture === "ok") {
        if (wantsTab) actions.claim(wantsTab.transfer_id);
        else actions.sendTab();
      } else if (e.gesture === "two_fingers") {
        // Op 3: two fingers arm a copy on the source and complete it on the
        // destination — the "V" analogue of op 1's open_palm.
        if (fresh && seq.state === "receive_ready" && wantsTab) {
          // Step 4 (destination): fist then two fingers — the duplicate lands here.
          actions.claim(wantsTab.transfer_id);
          seqRef.current = { state: "idle", at: now };
        } else if (fresh && seq.state === "copy_armed") {
          seq.at = now; // fingers still up — keep the highlight alive, no re-toast
        } else {
          // Step 1 (source): highlight the active tab, wait for the fist.
          seqRef.current = {
            state: actions.armActiveTabCopy() ? "copy_armed" : "idle",
            at: now,
          };
        }
      } else if (e.gesture === "two_hands_open") {
        // Both palms: arm the move on the source, OR complete the catch on the
        // destination (both fists → both open), symmetric with op 1's palm.
        if (fresh && seq.state === "ws_receive_ready" && wantsWs) {
          // Op 2 step 4 (destination): both fists then both open — every tab
          // (with its content) lands here.
          actions.claim(wantsWs.transfer_id);
          seqRef.current = { state: "idle", at: now };
        } else if (fresh && seq.state === "ws_armed") {
          seq.at = now; // palms held open — keep the highlight alive, no re-toast
        } else {
          // Op 2 step 1 (source): highlight EVERY tab, wait for both fists.
          seqRef.current = {
            state: actions.armWorkspaceMove() ? "ws_armed" : "idle",
            at: now,
          };
        }
      } else if (e.gesture === "two_hands_fist") {
        // Both fists: confirm the move on the source, OR pose to receive on the
        // destination (both fists → then open both to catch).
        if (fresh && seq.state === "ws_armed") {
          // Op 2 step 2 (source): confirmed — every tab leaves now.
          actions.sendWorkspaceMove();
          seqRef.current = { state: "idle", at: now };
        } else if (fresh && seq.state === "ws_receive_ready") {
          seq.at = now; // fists held — stay ready, no re-toast
        } else {
          // Op 2 step 3 (destination): "I'm ready for the whole workspace."
          // Same as the one-handed fist: only hint when something is actually
          // in the air to catch.
          seqRef.current = { state: "ws_receive_ready", at: now };
          if (wantsWs) {
            useTransferStore.getState().toast("info", "Open both hands to catch all the tabs");
          }
        }
      }
      send("gesture_event", {
        gesture: e.gesture,
        hands_count: e.handsCount,
        confidence: e.confidence,
      });
    },
    [actions, send],
  );

  // Dev-only: expose the gesture entry point so the recognition pipeline can be
  // driven from the console (and tool-driven E2E) without a physical webcam.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __nxGesture?: typeof onGesture }).__nxGesture = onGesture;
    }
  }, [onGesture]);

  if (fatal) {
    return (
      <div className="grid min-h-full place-items-center px-6 text-center">
        <div>
          <p className="mb-4 text-warm">{fatal}</p>
          <Button onClick={() => nav("/")}>Back to start</Button>
        </div>
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex h-full flex-col">
      {/* One spacious top row: brand · pill tabs · code capsule. */}
      <div className="flex items-stretch gap-2 border-b border-white/10 bg-white/5 px-3 backdrop-blur-[12px]">
        <BrandWordmark />
        <TabBar />
        <div className="ml-auto flex shrink-0 items-center py-1.5">
          {ready && <WorkspaceCodeDisplay code={code} />}
        </div>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {activeTab ? (
          <RichEditor key={activeTab.id} tab={activeTab} />
        ) : (
          <div className="grid h-full place-items-center text-muted">
            No tabs yet — hit + to create one, or receive one.
          </div>
        )}
      </main>

      {/* The gesture engine lives in a draggable floating panel. It stays
          mounted so the recognition pipeline's lifecycle is stable. */}
      <FloatingCameraPanel onGesture={onGesture} />

      <PendingTransferToast onClaim={actions.claim} />
      <TransferAnimation />
      <AirCursor />
      <RemoteCursors />
      <HelpOverlay />
      <ToastStack />
    </div>
  );
}
