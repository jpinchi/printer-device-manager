"use client";

/**
 * Botón para alternar entre modo claro y oscuro. Arranca en un valor neutro
 * ("dark", que coincide con el HTML por defecto) y lee el real tras montar, para
 * evitar desajustes de hidratación en la exportación estática.
 */
import { useEffect, useState } from "react";
import { getStoredTheme, setTheme, type Theme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function ThemeToggle({ variant = "full" }: { variant?: "full" | "icon" }) {
  const { t } = useI18n();
  const [theme, setLocal] = useState<Theme>("dark");

  useEffect(() => {
    setLocal(getStoredTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setLocal(next);
    setTheme(next);
  }

  const label = theme === "dark" ? t("Cambiar a modo claro") : t("Cambiar a modo oscuro");

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-accent hover:text-accent"
        aria-label={label}
        title={label}
      >
        {theme === "dark" ? <MoonIcon /> : <SunIcon />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn-ghost w-full justify-between"
      aria-label={label}
      title={label}
    >
      <span className="inline-flex items-center gap-2 text-slate-200">
        {theme === "dark" ? <MoonIcon /> : <SunIcon />}
        {theme === "dark" ? t("Modo oscuro") : t("Modo claro")}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted">
        {theme === "dark" ? t("→ claro") : t("→ oscuro")}
      </span>
    </button>
  );
}
