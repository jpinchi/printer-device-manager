"use client";

/**
 * Hook de notificaciones de alertas en tiempo real (Tarea 4).
 *
 * Responsabilidades:
 *  - Sondear `api.listAlerts("active")` al montar, cada vez que `useRealtime`
 *    avisa de un cambio, y como respaldo cada ~30s.
 *  - Detectar alertas NUEVAS comparando los `id` activos contra un `Set` de
 *    ids ya vistos (ref). En la PRIMERA carga solo se marcan como vistas: no se
 *    notifica el histórico existente, solo lo que aparezca después.
 *  - Por cada alerta nueva: disparar una Notification nativa del SO (si hay
 *    permiso) y emitir un toast in-app.
 *
 * Robusto ante `Notification` inexistente o permiso "denied": en ese caso se
 * degrada a solo toast. La Web Notifications API requiere contexto seguro
 * (HTTPS o localhost); sobre http://IP-LAN puede estar bloqueada.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ApiAlert } from "@/lib/types";
import { useRealtime } from "@/hooks/useRealtime";
import { alertLevel, type AlertLevel } from "@/lib/format";

/** Estado de permiso ampliado con "unsupported" para navegadores sin la API. */
export type NotifPermission = NotificationPermission | "unsupported";

/** Toast in-app derivado de una alerta nueva. */
export interface AlertToast {
  /** id único del toast (permite mostrar la misma alerta más de una vez sin colisión de key). */
  key: string;
  /** id de la alerta de origen. */
  alertId: string;
  severity: "INFO" | "WARNING" | "ERROR" | string;
  /** Nivel de color: para tóner usa los tramos crítico/bajo (mismo que la app). */
  level: AlertLevel;
  title: string;
  body: string;
}

/** ¿Está disponible la Web Notifications API en este entorno? */
function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Emoji según severidad para el título de la notificación. */
function severityEmoji(sev?: string): string {
  switch ((sev || "").toUpperCase()) {
    case "ERROR":
      return "🛑";
    case "WARNING":
      return "⚠️";
    case "INFO":
      return "ℹ️";
    default:
      return "🔔";
  }
}

/** Etiqueta legible de la impresora afectada: nombre + ubicación (para identificarla). */
function printerLabel(a: ApiAlert): string {
  const base = a.printer?.name || a.printer?.ip || "Impresora";
  const loc = a.printer?.location;
  return loc ? `${base} · ${loc}` : base;
}

/** Construye título y cuerpo de la notificación/toast a partir de la alerta. */
function formatAlert(a: ApiAlert): { title: string; body: string } {
  const emoji = severityEmoji(a.severity);
  const asunto = a.type || a.message || "Alerta";
  // La UBICACIÓN va en el título para saber de inmediato QUÉ impresora es.
  const title = `${emoji} ${asunto} — ${printerLabel(a)}`;

  const p = a.printer;
  const detalles: string[] = [];
  if (a.message && a.message !== asunto) detalles.push(a.message);
  if (p?.location) detalles.push(`📍 ${p.location}`);
  if (p?.ip) detalles.push(p.ip);
  const body = detalles.join(" · ") || asunto;

  return { title, body };
}

let toastSeq = 0;

export interface UseAlertNotifications {
  /** Toasts activos (los más recientes primero). */
  toasts: AlertToast[];
  /** Descarta un toast por su `key`. */
  dismissToast: (key: string) => void;
  /** ¿Soporta el navegador la Web Notifications API? */
  supported: boolean;
  /** Permiso actual ("unsupported" si no hay API). */
  permission: NotifPermission;
  /** Pide permiso de notificaciones (debe llamarse por acción del usuario). */
  requestPermission: () => Promise<void>;
}

export function useAlertNotifications(): UseAlertNotifications {
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  // IMPORTANTE (hidratación): estos valores dependen del navegador y NO deben
  // leerse durante el render inicial (en el build/prerender no hay `window`).
  // Arrancan con valores neutros que coinciden con el HTML del build y se
  // actualizan tras montar, evitando un desajuste de hidratación (React #418).
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotifPermission>("unsupported");

  useEffect(() => {
    const ok = notificationsSupported();
    setSupported(ok);
    setPermission(ok ? Notification.permission : "unsupported");
  }, []);

  // Ids de alertas ya vistas (no volver a notificar). Persiste entre renders.
  const seen = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  // Timers de auto-descarte, para limpiarlos al desmontar.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((key: string) => {
    setToasts((prev) => prev.filter((t) => t.key !== key));
    const tm = timers.current.get(key);
    if (tm) {
      clearTimeout(tm);
      timers.current.delete(key);
    }
  }, []);

  /** Dispara la notificación nativa del SO si hay permiso concedido. */
  const fireOsNotification = useCallback((alert: ApiAlert) => {
    if (!notificationsSupported()) return;
    if (Notification.permission !== "granted") return;
    try {
      const { title, body } = formatAlert(alert);
      new Notification(title, {
        body,
        icon: "/icon.svg",
        tag: alert.id, // colapsa duplicados de la misma alerta a nivel del SO
      });
    } catch {
      // Algunos entornos (contexto no seguro, política del navegador) lanzan
      // al construir Notification. Degradamos silenciosamente a solo toast.
    }
  }, []);

  /** Agrega un toast in-app y programa su auto-descarte (~6s). */
  const pushToast = useCallback(
    (alert: ApiAlert) => {
      const { title, body } = formatAlert(alert);
      const key = `${alert.id}:${toastSeq++}`;
      const toast: AlertToast = {
        key,
        alertId: alert.id,
        severity: alert.severity || "INFO",
        level: alertLevel(alert),
        title,
        body,
      };
      setToasts((prev) => [toast, ...prev].slice(0, 5)); // como mucho 5 a la vez
      const tm = setTimeout(() => dismissToast(key), 6000);
      timers.current.set(key, tm);
    },
    [dismissToast],
  );

  /** Trae alertas activas y notifica solo las que sean nuevas. */
  const refresh = useCallback(async () => {
    const r = await api.listAlerts("active");
    const alerts = r.data ?? [];

    // En la primera carga solo marcamos como vistas: no notificamos histórico.
    if (firstLoad.current) {
      for (const a of alerts) if (a.id) seen.current.add(a.id);
      firstLoad.current = false;
      return;
    }

    for (const a of alerts) {
      if (!a.id || seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      fireOsNotification(a);
      pushToast(a);
    }

    // Poda: `seen` solo debe contener las alertas ACTIVAS ahora (ya notificadas).
    // Sin esto crecería sin límite en sesiones largas (pantallas 24/7). Las
    // resueltas se descartan; si una reaparece, se vuelve a notificar (correcto).
    seen.current = new Set(alerts.map((a) => a.id).filter((id): id is string => !!id));
  }, [fireOsNotification, pushToast]);

  // Refresco en tiempo real: cada aviso del WebSocket vuelve a consultar alertas.
  useRealtime(() => {
    void refresh();
  });

  // Carga inicial + respaldo periódico cada 30s. Se PAUSA cuando la pestaña está
  // oculta (no gastar red/CPU en un panel 24/7 en segundo plano) y se refresca al
  // volver a primer plano.
  useEffect(() => {
    void refresh();
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    }, 30_000);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Limpieza de timers de toasts al desmontar.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const tm of map.values()) clearTimeout(tm);
      map.clear();
    };
  }, []);

  /** Solicita permiso de notificaciones (por acción del usuario). */
  const requestPermission = useCallback(async () => {
    if (!notificationsSupported()) {
      setPermission("unsupported");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {
      // requestPermission puede rechazar en contexto no seguro (http://IP-LAN).
      // Mantenemos el toast como fallback; no rompemos la UI.
      setPermission(notificationsSupported() ? Notification.permission : "unsupported");
    }
  }, []);

  return {
    toasts,
    dismissToast,
    supported,
    permission,
    requestPermission,
  };
}
