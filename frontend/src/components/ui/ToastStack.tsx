import { AnimatePresence, motion } from "framer-motion";

import { type Toast, useTransferStore } from "../../stores/transferStore";

const accent: Record<Toast["kind"], string> = {
  info: "border-line text-ink50",
  success: "border-aura/50 text-aura",
  warn: "border-warm/50 text-warm",
  error: "border-signal/60 text-signal",
};

export function ToastStack() {
  const toasts = useTransferStore((s) => s.toasts);
  const dismiss = useTransferStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-72 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto rounded-lg border bg-white/10 px-3.5 py-2.5 text-left text-sm shadow-[0_18px_50px_-22px_rgb(0_0_0/0.6)] backdrop-blur-[14px] ${accent[t.kind]}`}
          >
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
