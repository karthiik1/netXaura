import { Check, Copy } from "lucide-react";
import { useState } from "react";

// The channel tag — the app's signature element (§7). A quiet glass capsule:
// live dot, gradient code, and a copy affordance that confirms itself.
export function WorkspaceCodeDisplay({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(code).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="group flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.06] py-1.5 pl-4 pr-3 backdrop-blur-md transition-all duration-300 hover:border-aura/40 hover:bg-white/[0.09]"
      title="Copy workspace code"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-aura shadow-[0_0_8px_1px_rgb(244_162_97/0.8)]"
      />
      <span className="bg-gradient-to-r from-aura to-signal bg-clip-text font-mono text-sm font-semibold tracking-[0.28em] text-transparent">
        {code}
      </span>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-aura" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted opacity-50 transition-opacity duration-300 group-hover:opacity-100" />
      )}
    </button>
  );
}
