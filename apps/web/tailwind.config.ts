import type { Config } from "tailwindcss";

/**
 * Tema con soporte claro/oscuro.
 *
 * Los colores se definen como variables CSS (tripletas "R G B" en globals.css)
 * y se consumen con `rgb(var(--x) / <alpha-value>)`, de modo que las utilidades
 * con opacidad (bg-card/70, border-border/60, text-accent/50…) siguen
 * funcionando y cambian solas según el tema activo (`[data-theme]`).
 *
 * Además la escala `slate` se redefine como una RAMPA SEMÁNTICA de texto:
 * slate-100 = texto más fuerte … slate-500 = más tenue. Así los `text-slate-*`
 * ya existentes se adaptan al tema sin tocar cada componente (en claro la rampa
 * se invierte a tonos oscuros).
 */
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("--color-bg"),
        panel: rgb("--color-panel"),
        card: rgb("--color-card"),
        border: rgb("--color-border"),
        muted: rgb("--color-muted"),
        accent: rgb("--color-accent"),
        accent2: rgb("--color-accent2"),
        ok: rgb("--color-ok"),
        notice: rgb("--color-notice"),
        warn: rgb("--color-warn"),
        danger: rgb("--color-danger"),
        // Rampa de texto semántica (se invierte en claro).
        slate: {
          100: rgb("--slate-100"),
          200: rgb("--slate-200"),
          300: rgb("--slate-300"),
          400: rgb("--slate-400"),
          500: rgb("--slate-500"),
          600: rgb("--slate-600"),
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.2), 0 8px 24px -12px rgba(0,0,0,0.5)",
        glow: "0 0 0 1px rgba(56,189,248,0.25), 0 8px 30px -8px rgba(56,189,248,0.35)",
        card: "0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 30px -16px rgba(0,0,0,0.6)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.98)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(34,197,94,0.5)" },
          "70%": { boxShadow: "0 0 0 6px rgba(34,197,94,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(34,197,94,0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease both",
        "fade-in-up": "fade-in-up 0.4s cubic-bezier(0.22,1,0.36,1) both",
        "scale-in": "scale-in 0.25s ease both",
        shimmer: "shimmer 1.6s infinite",
        "pulse-ring": "pulse-ring 2s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
