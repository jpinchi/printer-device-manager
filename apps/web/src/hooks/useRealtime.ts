"use client";

/**
 * Conexión de tiempo real (sección 19). Se suscribe al WebSocket del backend y
 * llama a `onChange` cuando el inventario cambia, para recargar sin refrescar.
 *
 * El WS apunta al backend (:3000) directamente; el proxy de Next es solo HTTP.
 * Reconexión automática con backoff simple.
 */
import { useEffect, useRef, useState } from "react";

function wsUrl(): string {
  const override = process.env.NEXT_PUBLIC_WS_URL;
  if (override) return override;
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  // En desarrollo el frontend corre en :3001 y el backend (con el WS) en :3000.
  // En producción todo se sirve por el MISMO puerto, así que usamos el origen.
  const host = window.location.port === "3001"
    ? `${window.location.hostname}:3000`
    : window.location.host;
  return `${proto}://${host}/ws`;
}

export function useRealtime(onChange: () => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = wsUrl();
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg?.type === "printers:changed") cb.current();
        } catch {
          /* ignorar mensajes no-JSON */
        }
      };
    }
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { connected };
}
