"use client";

/**
 * Hook que expone el tema actual ("dark" | "light") y se actualiza cuando el
 * atributo `data-theme` de <html> cambia (al pulsar el toggle).
 *
 * IMPORTANTE (rendimiento): usa UN ÚNICO `MutationObserver` a nivel de módulo,
 * compartido por todas las instancias (antes cada barra de tóner / fila de tabla
 * creaba el suyo → cientos de observers en flotas grandes, todos disparando en
 * cada cambio de tema). Con `useSyncExternalStore`, cada componente se suscribe
 * a un store común y re-renderiza una sola vez por cambio real.
 */
import { useSyncExternalStore } from "react";
import type { UiTheme } from "@/lib/format";

let currentTheme: UiTheme = "dark";
let observing = false;
const listeners = new Set<() => void>();

function readTheme(): UiTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function ensureObserver(): void {
  if (observing || typeof document === "undefined") return;
  observing = true;
  currentTheme = readTheme();
  const obs = new MutationObserver(() => {
    const next = readTheme();
    if (next !== currentTheme) {
      currentTheme = next;
      for (const l of listeners) l();
    }
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function subscribe(cb: () => void): () => void {
  ensureObserver();
  listeners.add(cb);
  // Sincroniza por si el atributo cambió entre el primer render y la suscripción.
  cb();
  return () => {
    listeners.delete(cb);
  };
}

export function useTheme(): UiTheme {
  return useSyncExternalStore(
    subscribe,
    () => currentTheme,
    () => "dark", // snapshot en servidor / prerender (coincide con el HTML por defecto)
  );
}
