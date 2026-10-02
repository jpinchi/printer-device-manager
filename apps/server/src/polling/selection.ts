/**
 * Lógica PURA de selección de pollers (sin efectos ni temporizadores).
 *
 * Separar "qué pollers tocan en este instante" de los `setInterval` permite
 * probar la cadencia sin depender del reloj real: se le pasa `now` y el mapa de
 * últimas ejecuciones, y devuelve los pollers vencidos.
 */
import type { PollingIntervals } from "./config.js";

/** Tipos de poller de la sección 16 del plan maestro. */
export type PollerKind =
  | "status"
  | "errors"
  | "supplies"
  | "trays"
  | "counters"
  | "deviceInfo";

/** Todos los pollers, en orden de frecuencia (más frecuente primero). */
export const POLLER_KINDS: readonly PollerKind[] = [
  "status",
  "errors",
  "supplies",
  "trays",
  "counters",
  "deviceInfo",
] as const;

/** Marca de tiempo (epoch ms) de la última vez que corrió cada poller. */
export type LastRunMap = Partial<Record<PollerKind, number>>;

/**
 * Devuelve los pollers vencidos en el instante `now`.
 *
 * Un poller vence si nunca ha corrido (no hay marca) o si transcurrió al menos
 * su intervalo desde la última corrida. Función pura y determinista.
 */
export function selectDuePollers(
  now: number,
  lastRun: LastRunMap,
  intervals: PollingIntervals,
): PollerKind[] {
  const due: PollerKind[] = [];
  for (const kind of POLLER_KINDS) {
    const last = lastRun[kind];
    const interval = intervals[kind];
    if (last === undefined || now - last >= interval) {
      due.push(kind);
    }
  }
  return due;
}

/**
 * Devuelve una copia de `lastRun` con los pollers indicados marcados en `now`.
 * Pura: no muta el mapa de entrada (facilita el testeo).
 */
export function markRan(lastRun: LastRunMap, kinds: PollerKind[], now: number): LastRunMap {
  const next: LastRunMap = { ...lastRun };
  for (const kind of kinds) next[kind] = now;
  return next;
}
