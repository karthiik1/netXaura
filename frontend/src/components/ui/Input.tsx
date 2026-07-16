import type { InputHTMLAttributes, ReactNode } from "react";

// `className` styles the <input> itself (text, padding); layout spacing like
// margins must go on `wrapperClassName`, otherwise the input's margin makes
// the wrapper taller than the field and the icon centers on the wrong box.
export function Input({
  icon,
  className = "",
  wrapperClassName = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; wrapperClassName?: string }) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...rest}
        className={`peer w-full rounded-xl border border-line bg-surface/80 py-3 outline-none transition-all duration-200 placeholder:text-muted/60 focus:border-aura/60 focus:bg-surface focus:shadow-[0_0_0_4px_rgb(var(--aura)/0.12)] ${icon ? "pl-11 pr-3.5" : "px-3.5"} ${className}`}
      />
      {icon && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted transition-colors peer-focus:text-aura">
          {icon}
        </span>
      )}
    </div>
  );
}
