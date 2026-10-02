"use client";

/**
 * Botón de ayuda contextual: un pequeño "?" que al hacer clic muestra un
 * popover con la explicación de esa parte de la app. Los textos se pasan en
 * español (idioma base) y se traducen con t().
 *
 * El popover se renderiza mediante un PORTAL a <body> con posición fija y un
 * z-index alto, de modo que SIEMPRE queda por encima de cualquier otro elemento
 * (nunca lo tapa ni lo recorta una tarjeta, cabecera o tabla). Se reposiciona
 * en scroll/resize y se voltea hacia arriba si no cabe abajo. La apertura y el
 * cierre tienen una animación mínima (fade + leve desplazamiento y escala).
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";

const WIDTH = 320;

export function HelpTip({
  title,
  body,
  className = "",
  align = "left",
}: {
  title?: string;
  body: string;
  className?: string;
  align?: "left" | "right";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false); // intención del usuario
  const [mounted, setMounted] = useState(false); // presente en el DOM (para animar la salida)
  const [shown, setShown] = useState(false); // estado visible (dispara la transición)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  /** Coloca el popover bajo el botón; si no cabe abajo, lo voltea hacia arriba. */
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const m = 8;
    let left = align === "right" ? b.right - WIDTH : b.left;
    left = Math.max(m, Math.min(left, window.innerWidth - WIDTH - m));
    const h = popRef.current?.offsetHeight ?? 0;
    let top = b.bottom + 6;
    if (h && top + h > window.innerHeight - m) top = Math.max(m, b.top - h - 6);
    setPos({ top, left });
  }, [align]);

  // Montaje y desmontaje diferido (para que se vea la animación de salida).
  useEffect(() => {
    if (open) {
      place();
      setMounted(true);
    } else if (mounted) {
      setShown(false);
      const id = setTimeout(() => setMounted(false), 170);
      return () => clearTimeout(id);
    }
  }, [open, mounted, place]);

  // Ya montado: recoloca (ahora conoce su altura) y dispara la entrada.
  useEffect(() => {
    if (!mounted) return;
    place();
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [mounted, place]);

  // Reposiciona en scroll/resize; cierra al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!mounted) return;
    const reflow = () => place();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [mounted, place]);

  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={t("Ayuda")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[11px] font-bold leading-none transition-colors ${
          open
            ? "border-accent bg-accent/15 text-accent"
            : "border-border text-muted hover:border-accent hover:text-accent"
        }`}
      >
        ?
      </button>
      {mounted &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: WIDTH,
              transformOrigin: align === "right" ? "top right" : "top left",
              opacity: shown ? 1 : 0,
              transform: shown ? "translateY(0) scale(1)" : "translateY(-4px) scale(0.98)",
              transition: "opacity 150ms ease, transform 160ms cubic-bezier(0.22,1,0.36,1)",
              pointerEvents: shown ? "auto" : "none",
            }}
            className="z-[3000] max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-card p-3.5 text-left normal-case tracking-normal shadow-glow"
          >
            {title && <span className="mb-1 block text-xs font-semibold text-slate-100">{t(title)}</span>}
            <span className="block text-xs font-normal leading-relaxed text-muted">{t(body)}</span>
          </div>,
          document.body,
        )}
    </span>
  );
}
