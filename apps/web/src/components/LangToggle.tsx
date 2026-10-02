"use client";

/** Selector de idioma ES / EN. Compacto, para la barra superior y el login. */
import { useI18n } from "@/lib/i18n";

export function LangToggle() {
  const { lang, setLang } = useI18n();
  const btn = (l: "es" | "en", label: string) => (
    <button
      type="button"
      onClick={() => setLang(l)}
      aria-pressed={lang === l}
      className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
        lang === l ? "bg-accent/15 text-accent" : "text-muted hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-card/40 p-0.5" title="Idioma / Language">
      {btn("es", "ES")}
      {btn("en", "EN")}
    </div>
  );
}
