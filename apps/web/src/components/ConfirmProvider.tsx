"use client";

/**
 * Diálogo de confirmación EN LA APP (reemplaza a window.confirm/alert/prompt).
 *
 * ¿Por qué? En Electron, los diálogos nativos (window.confirm) le roban el foco
 * a la ventana: tras aceptarlos O cancelarlos, los inputs de la app dejan de
 * aceptar teclado hasta reiniciar el programa. Este proveedor monta un modal de
 * React (mismo proceso, mismo foco) y expone un hook `useConfirm()` que devuelve
 * una promesa `Promise<boolean>`, con la misma ergonomía que window.confirm pero
 * sin el bug del foco.
 */
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

export interface ConfirmOptions {
  /** Título del diálogo (por defecto "Confirmar"). */
  title?: string;
  /** Cuerpo del mensaje. */
  message: string;
  /** Texto del botón de aceptar (por defecto "Aceptar"). */
  confirmLabel?: string;
  /** Texto del botón de cancelar (por defecto "Cancelar"). */
  cancelLabel?: string;
  /** Si es una acción destructiva, pinta el botón de aceptar en rojo. */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Hook: `const confirm = useConfirm(); if (await confirm({message})) {…}` */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm debe usarse dentro de <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpts(options);
    });
  }, []);

  const close = useCallback((value: boolean) => {
    setOpts(null);
    const r = resolver.current;
    resolver.current = null;
    r?.(value);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close(false);
          }}
        >
          <div className="card w-full max-w-sm p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-100">
              {opts.title ?? t("Confirmar")}
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm text-muted">{opts.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted transition hover:border-slate-400 hover:text-slate-200"
              >
                {opts.cancelLabel ?? t("Cancelar")}
              </button>
              <button
                autoFocus
                onClick={() => close(true)}
                className={
                  opts.danger
                    ? "rounded-md border border-danger bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/20"
                    : "rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20"
                }
              >
                {opts.confirmLabel ?? t("Aceptar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
