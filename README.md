# NetXaura

Gesture-driven cross-device collaboration. Devices on the same local network
join a shared workspace and toss **selections**, **editor tabs**, and **whole
workspaces** between screens with hand gestures captured by the webcam — no
copy-paste, no files. Every gesture also has a button/keyboard equivalent, so
the whole thing works without a camera too.

> Primarily a desktop/webcam experience. No mobile gesture support in V1.

## Architecture

```
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  Browser A (sender)          │         │  Browser B (receiver)        │
│                              │         │                              │
│  MediaPipe HandLandmarker    │         │  MediaPipe HandLandmarker    │
│    (in-browser, WASM+GPU)    │         │    (in-browser)              │
│         │ gesture events     │         │         │                    │
│         ▼                    │         │         ▼                    │
│  action layer  ◀── buttons   │         │  action layer  ◀── buttons   │
│         │                    │         │         ▲                    │
└─────────┼────────────────────┘         └─────────┼────────────────────┘
          │ WS: transfer_initiate                  │ WS: transfer_claim
          ▼                                         │
   ┌─────────────────────────────────────────────────────────┐
   │  FastAPI backend (single worker)                         │
   │   REST /api/v1/*   ·   WS /ws/{code}                      │
   │   TransferManager (in-memory pending-transfer state)     │
   │            │ persist on completion                       │
   │            ▼                                              │
   │        MySQL 8  (workspaces · members · tabs · history)  │
   └─────────────────────────────────────────────────────────┘
```

The gesture layer only emits **recognized events** (telemetry); it never streams
video. Transfers are driven by explicit `transfer_initiate` / `transfer_claim`
WebSocket messages that the client sends after it classifies a gesture *or* the
user clicks a button. Offers are **broadcast** by default (first claim wins) or
**targeted**: click a member in the sidebar to aim your sends at just them.

## Run it

```bash
docker compose up --build
# open http://localhost:5173 in two tabs, create a workspace in one,
# join with the code in the other, then send between them.
```

Or run the pieces directly:

```bash
# backend  (needs a local MySQL, or use the compose mysql service)
cd backend && pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload --workers 1

# frontend
cd frontend && npm install && npm run dev

# optional, one-time: download the hand-tracking model (~7.5 MB) so gestures
# work fully offline; without it the browser falls back to Google's CDN.
cd frontend && npm run fetch:models
```

## Gesture vocabulary

| Gesture | Hands | Meaning | Button / key |
|---|---|---|---|
| Index point | 1 | Move the air cursor | — |
| Open palm → fist | 1 | Move the active tab (leaves this device, 10s to catch) | `M` |
| Fist → open palm | 1 | Catch a tab waiting in the air | `C` |
| "OK" sign | 1 | Copy / receive the current tab | `T` |
| Two fingers → fist | 1 | Duplicate the tab (original stays; catch with fist → two fingers) | `D` |
| Both palms → both fists | 2 | Move ALL tabs with content (catch with both fists → both palms) | `W` |
| — | — | Send highlighted text (select with the mouse first; receive with **Receive**) | `S` |

When an incoming offer is showing, the same gesture **receives** it; otherwise it
**sends**. Press `?` in a workspace for the in-app version of this table.
Heuristics (finger extension, hand-size-normalized pinch distance,
margin-based confidence, the two-hand temporal transition) are documented inline
in `frontend/src/components/gestures/useGestureRecognition.ts`. The air cursor
is smoothed with a One-Euro filter (`src/lib/oneEuro.ts`) and streamed to other
members as a live presence cursor, throttled to ~20 Hz.

## Editor

Every tab is the **same** kind of surface — a rich-text editor (TipTap) with a
formatting toolbar:

- **Font:** family (Sans / Serif / Mono / Display) and size.
- **Marks:** bold, italic, underline, strikethrough.
- **Alignment:** left, center, right, justify.
- **Blocks:** H1/H2, bullet & numbered lists, blockquote.
- **History:** undo, redo.

Entering a fresh workspace seeds a blank **Untitled** document (empty — no
starter content) so the editor is always present; `+` adds another, and
**double-click a tab's name to rename it**. Selecting text feeds "Send
selection", and content autosaves as TipTap JSON (last-write-wins).

The UI uses a single **light cool** palette (teal accent on a soft blue-white
ground).

## Key design decisions (V1.1)

- **Tabs are workspace-scoped and transferred as copies.** A transfer creates a
  new receiver-owned tab; the sender's original is untouched (snapshots, not live
  sync).
- **Selections insert at the receiver's active-editor caret** — not at a "pointed"
  screen location.
- **Transfer state is in-memory in a single backend worker.** The `TransferManager`
  enforces one pending transfer per sender, a 10s TTL, first-claim-wins with a
  lock, self-transfer rejection, and a bounded record so a losing racer is told
  `transfer_already_claimed`. Targeted transfers notify only the aimed-at device,
  and only it may claim.
- **Every gesture action has a button/keyboard equivalent** — for accessibility
  and so the loop is demoable and testable without a webcam.
- **Joining issues a per-member auth token** (returned by `POST /join`, stored
  client-side) that the WebSocket requires. It stops casual `device_id`
  spoofing: while a device is connected, its identity can't be re-joined without
  the token. LAN-grade, not real auth — no user accounts in V1.
- **The WS trust boundary is enforced server-side:** payloads are schema-checked
  and size-capped, frames over 256 KiB are rejected, and each connection has
  token-bucket budgets (telemetry is dropped silently when over budget; control
  messages get a `rate_limited` error).
- **Expired workspaces are swept** by a background job (default every 15 min);
  a workspace with a connected member is never swept, and heartbeats keep the
  expiry window fresh.
- **Gesture assets are local-first:** the MediaPipe WASM runtime is served by
  the app itself, and `npm run fetch:models` vendors the hand model so the whole
  stack runs with zero internet, matching the LAN assumption.

## Known limitations

- **Single worker only.** Pending-transfer and connection state live in process
  memory. Running multiple workers needs Redis (out of scope).
- **Auth is LAN-grade.** The member token stops casual spoofing but there are
  still no user accounts; a disconnected identity can be claimed by rotating
  its token.
- **LAN assumption:** no WAN/internet transport, no NAT traversal.
- **No live co-editing:** tabs move as discrete snapshots (no OT/CRDT). Autosave
  is last-write-wins. See `docs/co-editing-plan.md` for the V2 path (Yjs).

## Tests

```bash
cd backend && pytest -q            # state machine (§5.2) + REST + auth/cleanup
cd frontend && npm run typecheck   # strict TS
cd frontend && npm test            # vitest: filter, presence, transfer stores
python scripts/smoke_two_clients.py CODE   # drive a real transfer, no webcam
```

## Layout

```
netxaura/
├── backend/          FastAPI + SQLAlchemy + Alembic + TransferManager
├── frontend/         React + TS + Tailwind + TipTap + MediaPipe
├── docs/             openapi.json (source for frontend types) + co-editing plan
└── scripts/          two-client smoke test
```
