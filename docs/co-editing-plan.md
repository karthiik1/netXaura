# Live co-editing plan (V2)

V1 moves tabs as **discrete snapshots**: a transfer copies content, autosave is
last-write-wins, and two people editing "the same" tab are really editing two
rows. This document is the concrete migration path to real-time collaborative
editing, kept separate from the V1 codebase on purpose — it is a product change,
not a refactor.

## Recommended approach: Yjs

[Yjs](https://yjs.dev) is the pragmatic CRDT choice here because first-class
bindings already exist for both editors this app uses:

- **Monaco** (code tabs): `y-monaco` binds a `Y.Text` to a Monaco model.
- **TipTap** (rich-text tabs): TipTap ships official collaboration extensions
  (`@tiptap/extension-collaboration`) built on `y-prosemirror`.

That means the editor layer barely changes — the work is in transport and
persistence.

## Architecture delta

```
today:   editor ──(PATCH /tabs/:id autosave, LWW)──► MySQL
V2:      editor ◄──(Yjs binding)──► Y.Doc ◄──(y-websocket protocol)──► backend room ──(debounced snapshot)──► MySQL
```

1. **One Y.Doc per tab.** The doc id is the tab id. Members subscribe to the
   docs of tabs they have open.
2. **Transport: extend the existing WS.** Add a binary sub-protocol on the
   existing `/ws/{code}` socket (Yjs sync messages are already length-prefixed
   binary; multiplex with a 1-byte frame tag so JSON envelopes keep working), or
   run `ypy-websocket` on a sibling `/yjs/{tab_id}` route. The sibling route is
   less invasive and is the recommended first step.
3. **Persistence: snapshot, don't log.** Debounce (e.g. 2s idle / 30s max) and
   write `Y.encodeStateAsUpdate(doc)` into a new `tabs.crdt_state` BLOB column;
   keep rendering `tabs.content` as a derived plain-text/JSON projection so
   REST reads and transfer previews don't need to decode CRDT state.
4. **Awareness:** y-protocols' awareness carries remote carets/selections —
   this replaces (and upgrades) the current `cursor_move` presence for text.

## What "transfer" means once tabs are live

Targeted/broadcast transfers stay — they become **invitations to subscribe**:

- *Send tab* → receiver opens the same Y.Doc (shared editing) instead of
  getting a copy. "Send a copy" remains as a secondary action (fork the doc:
  `Y.encodeStateAsUpdate` → new tab id).
- *Send selection* still inserts at the receiver's caret, now as a Yjs
  transaction so it merges cleanly with concurrent edits.
- *Send workspace* → subscribe to all docs.

## Server implications (revisits two V1 limitations)

- Doc rooms are in-memory state, so this lands **after or together with the
  Redis move** (multi-worker needs a shared awareness/update bus —
  `y-redis`-style fan-out).
- Membership becomes authorization: the member auth token (added in V1.1)
  gates doc subscription, so this slots in cleanly now.

## Suggested milestones

| # | Milestone | Scope |
|---|---|---|
| 1 | Spike: two browsers co-edit one Monaco tab via `ypy-websocket` on `/yjs/{tab_id}` | no persistence, feature-flagged |
| 2 | Snapshot persistence + `crdt_state` column + projection to `content` | migration 0003 |
| 3 | TipTap collaboration extension for rich-text tabs | |
| 4 | Transfers become subscriptions; "send a copy" as explicit fork | UX + backend |
| 5 | Awareness (remote carets) replaces cursor presence inside editors | |

Estimated effort: milestones 1–2 are roughly the size of everything shipped in
V1.1; 3–5 are incremental on top.
