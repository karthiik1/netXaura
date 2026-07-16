/** @type {import('tailwindcss').Config} */
// Semantic tokens map to CSS variables (see index.css) so light/dark is a single
// variable swap rather than dark: variants scattered across the tree.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--ink) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        aura: "rgb(var(--aura) / <alpha-value>)",
        signal: "rgb(var(--signal) / <alpha-value>)",
        warm: "rgb(var(--warm) / <alpha-value>)",
        ink50: "rgb(var(--text) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        aura: "0 0 0 1px rgb(var(--aura) / 0.4), 0 0 24px rgb(var(--aura) / 0.25)",
        premium:
          "0 32px 80px -24px rgb(0 0 0 / 0.55), 0 0 1px 1px rgb(var(--line)), 0 0 60px -18px rgb(var(--aura) / 0.3)",
        glow: "0 0 0 1px rgb(var(--aura) / 0.5), 0 8px 24px -8px rgb(var(--aura) / 0.45)",
      },
    },
  },
  plugins: [],
};
