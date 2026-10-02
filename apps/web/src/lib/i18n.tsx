"use client";

/**
 * Internacionalización ligera (ES por defecto · EN).
 *
 * Modelo "texto-fuente como clave": el texto en ESPAÑOL es la clave. En modo ES
 * `t(s)` devuelve el propio texto; en modo EN devuelve su traducción del mapa
 * `EN` (o el español como respaldo si aún no está traducido). Así el español
 * nunca se rompe y la cobertura de inglés crece de forma incremental.
 *
 * La preferencia se guarda en localStorage ("pdm.lang").
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { EN } from "./translations";

export type Lang = "es" | "en";

interface I18nContext {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Traduce un texto español al idioma activo. */
  t: (es: string) => string;
}

const Ctx = createContext<I18nContext>({ lang: "es", setLang: () => {}, t: (s) => s });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("pdm.lang");
      if (saved === "en" || saved === "es") {
        setLangState(saved);
        document.documentElement.lang = saved;
      }
    } catch {
      /* almacenamiento no disponible */
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("pdm.lang", l);
      document.documentElement.lang = l;
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((es: string) => (lang === "en" ? EN[es] ?? es : es), [lang]);

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

/** Hook de traducción: `const { t, lang, setLang } = useI18n()`. */
export const useI18n = () => useContext(Ctx);
