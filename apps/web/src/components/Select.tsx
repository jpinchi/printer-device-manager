"use client";

/**
 * Dropdown personalizado que combina con el tema oscuro de la app.
 *
 * El desplegable se renderiza en un PORTAL (document.body) con posición fija,
 * calculada desde el botón. Así NUNCA queda recortado ni tapado por otras
 * tarjetas/contenedores (los `<select>` nativos no permiten estilar la lista, y
 * un panel absoluto normal se obstruye con contextos de apilamiento vecinos).
 *
 * Uso:
 *   <Select value={v} onChange={setV} options={[{value:"a",label:"A"}]} />
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Seleccionar…",
  className = "",
  size = "md",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);

  const updateRect = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 6, left: r.left, width: r.width });
  };

  // Calcula la posición al abrir (antes de pintar, para evitar parpadeo).
  useLayoutEffect(() => {
    if (open) updateRect();
  }, [open]);

  // Cierre por clic fuera / Escape; reposiciona al hacer scroll o redimensionar.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => updateRect();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]);

  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-2 text-sm";

  const popup =
    open && rect && typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={popupRef}
            role="listbox"
            style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }}
            className="animate-scale-in z-[1000] max-h-72 min-w-[10rem] origin-top overflow-auto rounded-xl border border-border bg-card p-1 shadow-soft"
          >
            {options.map((o) => {
              const active = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                      active
                        ? "bg-accent/15 font-medium text-accent"
                        : "text-slate-200 hover-elev"
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {active && (
                      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 10l4 4 8-8" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-[rgb(var(--color-input))] ${pad} text-left text-slate-100 shadow-inner outline-none transition-all duration-200 hover:border-accent/50 focus:border-accent/70 focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-accent/70 ring-2 ring-accent/25" : ""
        }`}
      >
        <span className={`truncate ${selected ? "" : "text-slate-500"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>
      {popup}
    </div>
  );
}
