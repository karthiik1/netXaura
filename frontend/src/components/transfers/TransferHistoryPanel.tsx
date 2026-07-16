// Recent activity log fed by the history endpoint (§4, §7.2).
import { useEffect, useState } from "react";

import { api } from "../../services/api";
import { useTransferStore } from "../../stores/transferStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { TransferHistoryItem } from "../../types/api";

export function TransferHistoryPanel() {
  const code = useWorkspaceStore((s) => s.code);
  const historyBump = useTransferStore((s) => s.historyBump); // refresh trigger
  const [items, setItems] = useState<TransferHistoryItem[]>([]);

  useEffect(() => {
    if (!code) return;
    api.history(code, 12).then(setItems).catch(() => {});
  }, [code, historyBump]);

  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase tracking-widest text-muted">
        activity
      </p>
      <ul className="flex flex-col gap-1 text-xs">
        {items.length === 0 && <li className="text-muted">No transfers yet.</li>}
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 text-muted">
            <span className="font-mono text-aura">{it.transfer_type[0].toUpperCase()}</span>
            <span className="truncate">{it.status}</span>
            <span className="ml-auto tabular-nums">
              {new Date(it.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
