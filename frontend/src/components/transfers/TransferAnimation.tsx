// A content card that flies between member nodes on transfer_completed. This is
// a LOCAL animation per client (layoutId is within this tree, not across
// devices — §7.4). Sender sees it leave toward the receiver's node; receiver
// sees it arrive at the editor.
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

import { useTransferStore } from "../../stores/transferStore";

function nodeCenter(deviceId: string): { x: number; y: number } {
  const el = document.querySelector(`[data-member="${deviceId}"]`);
  if (el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

export function TransferAnimation() {
  const flights = useTransferStore((s) => s.flights);
  const remove = useTransferStore((s) => s.removeFlight);

  useEffect(() => {
    const timers = flights.map((f) => setTimeout(() => remove(f.id), 900));
    return () => timers.forEach(clearTimeout);
  }, [flights, remove]);

  return (
    <AnimatePresence>
      {flights.map((f) => {
        const from = nodeCenter(f.fromDeviceId);
        const to = nodeCenter(f.toDeviceId);
        return (
          <motion.div
            key={f.id}
            initial={{ x: from.x, y: from.y, opacity: 0, scale: 0.6 }}
            animate={{ x: to.x, y: to.y, opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.4 }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-aura/60 bg-surface px-3 py-2 font-mono text-xs text-aura shadow-aura"
          >
            {f.title} →
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}
