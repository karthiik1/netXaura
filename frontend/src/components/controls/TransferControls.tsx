// Button/shortcut equivalents for every gesture action (§0). This is the
// primary, webcam-free way to drive transfers — and what makes the full
// sender->receiver loop testable and demoable. Gestures call the same handlers.
import { useEffect } from "react";

import { useTransferStore } from "../../stores/transferStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Button } from "../ui/Button";

export interface TransferActions {
  sendSelection: () => void;
  sendTab: () => void;
  sendWorkspace: () => void;
  claim: (transferId: string) => void;
}

export function TransferControls({ actions }: { actions: TransferActions }) {
  const selectionText = useWorkspaceStore((s) => s.selectionText);
  const outgoingId = useTransferStore((s) => s.outgoingId);
  const hasSelection = selectionText.trim().length > 0;
  const busy = outgoingId !== null;

  // Keyboard shortcuts mirror the gestures (§0): S selection, T tab, W workspace.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "s") actions.sendSelection();
      if (e.key === "t") actions.sendTab();
      if (e.key === "w") actions.sendWorkspace();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase tracking-widest text-muted">send</p>
      <div className="flex flex-col gap-2">
        <Button variant="primary" disabled={busy || !hasSelection} onClick={actions.sendSelection}>
          Selection <kbd className="ml-1 font-mono text-[10px] text-muted">S</kbd>
        </Button>
        <Button disabled={busy} onClick={actions.sendTab}>
          Current tab <kbd className="ml-1 font-mono text-[10px] text-muted">T</kbd>
        </Button>
        <Button disabled={busy} onClick={actions.sendWorkspace}>
          Whole workspace <kbd className="ml-1 font-mono text-[10px] text-muted">W</kbd>
        </Button>
      </div>
      {busy && (
        <p className="mt-2 font-mono text-[11px] text-signal">
          waiting for someone to receive…
        </p>
      )}
    </div>
  );
}
