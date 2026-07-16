import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger";

const styles: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-aura to-signal font-semibold text-ink border border-white/25 hover:shadow-glow hover:brightness-110",
  ghost: "bg-panel/60 text-ink50 border border-line hover:border-aura/40 hover:bg-panel",
  danger: "bg-transparent text-warm border border-warm/40 hover:bg-warm/10",
};

export function Button({
  variant = "ghost",
  className = "",
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium tracking-tight transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:duration-75 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-40 ${styles[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
