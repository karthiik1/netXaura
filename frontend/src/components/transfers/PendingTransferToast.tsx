// Incoming-transfer offers (§7.3). Each shows a preview and a Receive button —
// the button-based equivalent of the receive gesture (§0).
import { AnimatePresence, motion } from "framer-motion";

import { useTransferStore } from "../../stores/transferStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

export function PendingTransferToast({
  onClaim,
}: {
  onClaim: (transferId: string) => void;
}) {
  const incoming = useTransferStore((s) => s.incoming);
  const members = useWorkspaceStore((s) => s.members);
  const nameOf = (id: string) =>
    members.find((m) => m.device_id === id)?.display_name ?? "Someone";

  return (
    <div className="fixed left-1/2 top-5 z-40 flex -translate-x-1/2 flex-col gap-2">
      <AnimatePresence>
        {incoming.map((t) => (
          <motion.div
            key={t.transfer_id}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="flex items-center gap-3 rounded-xl border border-signal/50 bg-white/10 px-4 py-3 shadow-[0_18px_50px_-22px_rgb(0_0_0/0.6)] backdrop-blur-[14px]"
          >
            <div>
              <p className="text-sm">
                <span className="text-signal">{nameOf(t.sender_device_id)}</span> is
                offering
                {t.target_device_id && (
                  <span className="ml-2 rounded border border-aura/50 bg-aura/10 px-1.5 py-0.5 font-mono text-[10px] text-aura">
                    just for you
                  </span>
                )}
              </p>
              <p className="font-mono text-xs text-muted">
                {t.transfer_type}: {t.preview.title ?? t.preview.excerpt ?? "content"}
              </p>
            </div>
            <button
              onClick={() => onClaim(t.transfer_id)}
              className="rounded-lg border border-aura/50 bg-aura/15 px-3 py-1.5 text-sm text-aura hover:bg-aura/25"
            >
              Receive
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
