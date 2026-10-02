/**
 * Configuración del motor de polling (Fase 4, sección 16 del plan maestro).
 *
 * Los intervalos por tipo de dato son configurables desde el entorno. Los
 * valores por defecto siguen la recomendación de la sección 16:
 *   - Status / Online .......... ~30-60 s   (usamos 45 s)
 *   - Errores .................. ~1-2 min    (usamos 90 s)
 *   - Consumibles .............. ~5 min      (300 s)
 *   - Bandejas ................. ~5 min      (300 s)
 *   - Contadores ............... ~30 min     (1800 s)
 *   - Info de dispositivo ...... ~24 h       (86400 s)
 *
 * Este módulo pertenece al dominio del Agente Backend/Polling y NO reescribe
 * `apps/server/src/config.ts` (solo lo lee para heredar los defaults SNMP).
 */

/** Un minuto y una hora en milisegundos, para legibilidad de los defaults. */
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Convierte una variable de entorno a número, con default si falta o es inválida. */
function num(v: string | undefined, def: number): number {
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/** Convierte una variable de entorno booleana ("true"/"1"). */
function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === "true" || v === "1";
}

/** Intervalos (ms) de cada poller, configurables por entorno. */
export interface PollingIntervals {
  status: number;
  errors: number;
  supplies: number;
  trays: number;
  counters: number;
  deviceInfo: number;
}

export interface PollingConfig {
  /** Interruptor general del scheduler (POLLING_ENABLED). */
  enabled: boolean;
  /** Intervalos por tipo de poller. */
  intervals: PollingIntervals;
  /**
   * Cadencia del temporizador base del scheduler. Por defecto, el menor de los
   * intervalos configurados (así el poller más frecuente se respeta). Puede
   * forzarse con POLL_TICK_MS (útil en pruebas manuales con cadencias cortas).
   */
  tickMs: number;
}

/** Calcula el tick base como el menor intervalo configurado (mínimo 1 s). */
export function computeTickMs(intervals: PollingIntervals): number {
  const min = Math.min(
    intervals.status,
    intervals.errors,
    intervals.supplies,
    intervals.trays,
    intervals.counters,
    intervals.deviceInfo,
  );
  return Math.max(min, SECOND);
}

/** Lee la configuración de polling desde `process.env`. */
export function loadPollingConfig(env: NodeJS.ProcessEnv = process.env): PollingConfig {
  const intervals: PollingIntervals = {
    status: num(env.POLL_STATUS_MS, 45 * SECOND),
    errors: num(env.POLL_ERRORS_MS, 90 * SECOND),
    supplies: num(env.POLL_SUPPLIES_MS, 5 * MINUTE),
    trays: num(env.POLL_TRAYS_MS, 5 * MINUTE),
    counters: num(env.POLL_COUNTERS_MS, 30 * MINUTE),
    deviceInfo: num(env.POLL_DEVICE_INFO_MS, 24 * HOUR),
  };

  return {
    enabled: bool(env.POLLING_ENABLED, false),
    intervals,
    tickMs: num(env.POLL_TICK_MS, computeTickMs(intervals)),
  };
}

/** Configuración de polling ya resuelta para la app. */
export const pollingConfig = loadPollingConfig();
