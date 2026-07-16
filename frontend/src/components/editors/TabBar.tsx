// Tab strip: switch, close, and rename (double-click the title). Every tab is
// the same kind of document (text + code blocks), so creation is a single +.
// The active pill is a shared framer-motion layout element, so it glides
// between tabs instead of blinking.
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { FileCode } from "lucide-react";

import { api } from "../../services/api";
import { useTransferStore } from "../../stores/transferStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

export function TabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const setActive = useWorkspaceStore((s) => s.setActiveTab);
  const removeTab = useWorkspaceStore((s) => s.removeTab);
  const upsertTab = useWorkspaceStore((s) => s.upsertTab);
  const code = useWorkspaceStore((s) => s.code);
  const me = useWorkspaceStore((s) => s.deviceId);
  // Operation 1 step 1: the open palm "picks up" the active tab — it pulses
  // until the fist confirms the send or the window lapses.
  const armedTabId = useTransferStore((s) => s.armedTabId);
  // Operation 2 step 1: both open palms pick up EVERY tab — they all pulse
  // until both fists confirm the whole-workspace move or the window lapses.
  const armedWorkspace = useTransferStore((s) => s.armedWorkspace);

  const [renamingId, setRenamingId] = useState<string | null>(null);

  async function newTab() {
    if (!code) return;
    const tab = await api.createTab(code, {
      owner_device_id: me,
      type: "rich_text", // one unified editor type
      title: "Untitled",
      content: "",
      language: null,
    });
    upsertTab(tab);
    setActive(tab.id);
  }

  async function close(id: string) {
    await api.deleteTab(id).catch(() => {});
    removeTab(id);
  }

  async function commitRename(id: string, title: string) {
    setRenamingId(null);
    const trimmed = title.trim();
    const current = tabs.find((t) => t.id === id);
    if (!trimmed || !current || trimmed === current.title) return;
    // Optimistic local update, then persist (last-write-wins autosave, §9).
    upsertTab({ ...current, title: trimmed });
    const saved = await api.updateTab(id, { title: trimmed }).catch(() => null);
    if (saved) upsertTab(saved);
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-x-auto px-2">
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        return (
          <div key={t.id} className="group relative flex shrink-0 items-center">
            {active && (
              <motion.span
                layoutId="active-tab-pill"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-lg border border-white/15 bg-white/10 shadow-[0_2px_12px_-6px_rgb(0_0_0/0.6),inset_0_1px_0_rgb(255_255_255/0.08)]"
              />
            )}
            {(armedTabId === t.id || armedWorkspace) && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 animate-pulse rounded-lg shadow-aura ring-1 ring-aura/70"
              />
            )}
            <div
              className={`relative z-[1] flex max-w-[220px] items-center gap-2 px-3.5 py-1.5 text-sm transition-colors duration-200 ${
                active ? "text-ink50" : "text-muted hover:text-ink50"
              }`}
            >
              <FileCode
                className={`h-3.5 w-3.5 shrink-0 ${active ? "text-aura" : "text-muted"}`}
              />
              {renamingId === t.id ? (
                <RenameInput
                  initial={t.title}
                  onCommit={(v) => commitRename(t.id, v)}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <button
                  onClick={() => setActive(t.id)}
                  onDoubleClick={() => setRenamingId(t.id)}
                  title="Double-click to rename"
                  className="max-w-[16ch] truncate"
                >
                  {t.title}
                </button>
              )}
              <button
                onClick={() => close(t.id)}
                className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-xs leading-none transition-all hover:bg-white/15 hover:text-ink50 ${
                  active ? "text-muted" : "text-muted opacity-0 group-hover:opacity-100"
                }`}
                aria-label="Close tab"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}

      <button
        onClick={newTab}
        className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-lg leading-none text-muted transition-colors hover:bg-white/10 hover:text-aura"
        aria-label="New tab"
        title="New document"
      >
        +
      </button>
    </div>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
        if (e.key === "Escape") onCancel();
      }}
      className="w-[16ch] rounded border border-aura/50 bg-panel/60 px-1 py-0.5 text-sm text-ink50 focus:outline-none"
    />
  );
}
