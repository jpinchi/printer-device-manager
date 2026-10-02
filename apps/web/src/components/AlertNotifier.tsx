"use client";

/**
 * AlertNotifier (Tarea 4) — Notificaciones de alertas en tiempo real.
 *
 * Se monta una sola vez en el layout, así que corre en toda la app. Muestra:
 *  1. Un botón/campana discreto para "Activar notificaciones" del SO
 *     (Web Notifications API). Solo aparece si el navegador soporta la API y el
 *     permiso aún no está concedido; pide permiso por acción del usuario.
 *  2. Toasts in-app flotantes (esquina inferior derecha) como fallback SIEMPRE
 *     visible, con color según severidad y auto-descarte.
 *
 * Toda la lógica (sondeo, detección de alertas nuevas, disparo de la
 * Notification del SO) vive en `useAlertNotifications`.
 *
 * Nota de contexto seguro: la Web Notifications API requiere HTTPS o localhost.
 * Sobre http://IP-LAN puede estar bloqueada; por eso el toast es imprescindible.
 */
import { useAlertNotifications, type AlertToast } from "@/hooks/useAlertNotifications";
import { useI18n } from "@/lib/i18n";
import type { AlertLevel } from "@/lib/format";

/** Colores del toast por nivel (tóner usa crítico/bajo; resto por severidad). */
function toastAccent(level: AlertLevel): { border: string; dot: string } {
  switch (level) {
    case "danger":
      return { border: "border-danger/60", dot: "bg-danger" };
    case "warn":
      return { border: "border-warn/60", dot: "bg-warn" };
    case "notice":
      return { border: "border-notice/60", dot: "bg-notice" };
    default:
      return { border: "border-accent/60", dot: "bg-accent" };
  }
}

/** Icono de campana (SVG inline, sin dependencias). */
function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function ToastCard({ toast, onClose }: { toast: AlertToast; onClose: () => void }) {
  const { border, dot } = toastAccent(toast.level);
  return (
    <div
      role="status"
      className={`card pointer-events-auto flex w-80 max-w-[90vw] items-start gap-3 border ${border} p-3 shadow-soft animate-fade-in-up`}
    >
      <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-100">{toast.title}</p>
        {toast.body ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{toast.body}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Descartar notificación"
        className="btn-ghost -mr-1 -mt-1 rounded-md px-1.5 py-0.5 text-muted hover:text-slate-100"
      >
        ✕
      </button>
    </div>
  );
}

export function AlertNotifier() {
  const { t: tr } = useI18n();
  const { toasts, dismissToast, supported, permission, requestPermission } =
    useAlertNotifications();

  // La campana solo aparece cuando SE PUEDE pedir permiso (estado "default").
  // Si ya está concedido no hace falta; si el navegador lo bloqueó ("denied",
  // típico sobre http://IP-LAN sin HTTPS) tampoco la mostramos, porque el botón
  // no podría hacer nada y solo confundiría (los toasts in-app siguen activos).
  const showBell = supported && permission === "default";

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {/* Toasts in-app (fallback siempre visible). */}
      {toasts.map((t) => (
        <ToastCard key={t.key} toast={t} onClose={() => dismissToast(t.key)} />
      ))}

      {/* Campana para activar las notificaciones del SO (solo cuando se puede
          pedir permiso; si están bloqueadas no se muestra). */}
      {showBell ? (
        <button
          type="button"
          onClick={() => void requestPermission()}
          title={tr("Activar notificaciones del sistema")}
          className="btn-ghost pointer-events-auto bg-card/90 shadow-soft backdrop-blur"
        >
          <BellIcon className="h-4 w-4 text-accent" />
          <span>{tr("Activar notificaciones")}</span>
        </button>
      ) : null}
    </div>
  );
}
