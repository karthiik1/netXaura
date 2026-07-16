// Gesture vocabulary + keyboard reference (§6). Self-contained: opens on "?"
// anywhere outside a text field, closes on Esc, click-away, or the button.
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

const ROWS: { gesture: string; hands: string; meaning: string; key: string }[] = [
  { gesture: "Index point", hands: "1", meaning: "Move the air cursor", key: "—" },
  { gesture: "— (no gesture)", hands: "—", meaning: "Send highlighted text: select it with the mouse, then press S. The other device takes it with Receive", key: "S" },
  { gesture: "Open palm → fist", hands: "1", meaning: "Move the active tab (leaves this device, 10s to catch)", key: "M" },
  { gesture: "Fist → open palm", hands: "1", meaning: "Catch a tab in the air on this device", key: "C" },
  { gesture: "“OK” sign", hands: "1", meaning: "Copy / receive the current tab", key: "T" },
  { gesture: "Two fingers → fist", hands: "1", meaning: "Duplicate the tab (original stays; catch with fist → two fingers)", key: "D" },
  { gesture: "Both palms → both fists", hands: "2", meaning: "Move ALL tabs with content (catch with both fists → both palms; 10s)", key: "W" },
];

export function HelpOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (e.key === "?") setOpen(true);
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            className="glass-strong w-full max-w-lg rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">
                Gestures & shortcuts
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-muted hover:text-ink50"
                aria-label="Close help"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-muted">
                  <th className="pb-2 font-normal">gesture</th>
                  <th className="pb-2 font-normal">hands</th>
                  <th className="pb-2 font-normal">meaning</th>
                  <th className="pb-2 font-normal">key</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.gesture} className="border-t border-line/60">
                    <td className="py-2.5">{r.gesture}</td>
                    <td className="py-2.5 text-muted">{r.hands}</td>
                    <td className="py-2.5 text-muted">{r.meaning}</td>
                    <td className="py-2.5">
                      <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px]">
                        {r.key}
                      </kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-4 text-xs text-muted">
              When an offer is showing, the same gesture <em>receives</em> it;
              otherwise it <em>sends</em>. Press{" "}
              <kbd className="rounded border border-line px-1 font-mono">?</kbd>{" "}
              anytime to reopen this.
            </p>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  );
}
