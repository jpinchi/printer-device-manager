/**
 * Motor de alertas — LÓGICA PURA (sección 17).
 *
 * Sin efectos secundarios ni acceso a BD: dadas (a) la instantánea de estado
 * actual de una impresora y (b) los eventos que ya están activos, decide qué
 * eventos crear y cuáles resolver. La persistencia vive en `persistence.ts`.
 *
 * Reglas clave:
 *  - Dedupe: no se crea un evento si ya hay uno ACTIVO con la misma `key`
 *    (sección 17: "evitar alertas duplicadas mientras la condición siga
 *    activa").
 *  - Resolución: un evento activo cuya condición ya no aparece se marca para
 *    resolver.
 *  - Recuperación: al resolver un PRINTER_OFFLINE con el equipo de vuelta
 *    ONLINE, se emite un PRINTER_BACK_ONLINE informativo.
 */
import type {
  DeviceCondition,
  OnlineState,
  SupplyColor,
} from "@pdm/types";
import {
  DEFAULT_THRESHOLDS,
  type AlertDecision,
  type AlertSeverity,
  type AlertThresholds,
  type AlertType,
  type DesiredCondition,
  type ExistingActiveEvent,
  type NewEvent,
  type PrinterStateSnapshot,
} from "./types.js";

// ---------------------------------------------------------------------------
// Códec de `source`: guarda la clave de condición y, opcionalmente, el ack.
// El esquema Prisma no tiene columna de acknowledgment; para no modificar el
// contrato, el estado de ack se codifica en `source` como sufijo. La clave de
// dedupe sigue siendo recuperable, así que el reconocimiento NO rompe el dedupe.
// Formato:  "<key>"  o  "<key>#ack=<ISO>"
// ---------------------------------------------------------------------------

const ACK_SEP = "#ack=";

export function encodeSource(key: string, ackAt?: Date | null): string {
  return ackAt ? `${key}${ACK_SEP}${ackAt.toISOString()}` : key;
}

export function decodeSource(source: string | null | undefined): {
  key: string;
  ackAt: string | null;
} {
  const s = source ?? "";
  const i = s.indexOf(ACK_SEP);
  if (i < 0) return { key: s, ackAt: null };
  return { key: s.slice(0, i), ackAt: s.slice(i + ACK_SEP.length) || null };
}

// ---------------------------------------------------------------------------
// Mensajes en español (comentarios y textos en español, convención del repo).
// ---------------------------------------------------------------------------

function colorLabel(c: SupplyColor): string {
  switch (c) {
    case "BLACK":
      return "negro";
    case "CYAN":
      return "cian";
    case "MAGENTA":
      return "magenta";
    case "YELLOW":
      return "amarillo";
    default:
      return "";
  }
}

/** Sufijo " negro" / "" para intercalar en los mensajes de tóner. */
function colorSuffix(c: SupplyColor): string {
  const label = colorLabel(c);
  return label ? ` ${label}` : "";
}

// ---------------------------------------------------------------------------
// Derivación de condiciones deseadas a partir del estado actual (PURA).
// ---------------------------------------------------------------------------

/** Condiciones de dispositivo (no-tóner) que mapean 1:1 a una alerta. */
const DEVICE_CONDITION_ALERTS: ReadonlyArray<
  readonly [DeviceCondition, AlertType, AlertSeverity, string]
> = [
  ["PAPER_EMPTY", "PAPER_EMPTY", "WARNING", "No hay papel (bandeja vacía)."],
  ["PAPER_JAM", "PAPER_JAM", "ERROR", "Atasco de papel detectado."],
  [
    "MAINTENANCE_REQUIRED",
    "MAINTENANCE_REQUIRED",
    "WARNING",
    "El dispositivo requiere mantenimiento.",
  ],
  ["ERROR", "DEVICE_ERROR", "ERROR", "El dispositivo reporta un error."],
];

/**
 * Calcula el conjunto de condiciones que DEBERÍAN estar activas dado el estado
 * actual. Función pura y determinista. Deduplica por `key`.
 *
 * - Offline: se deriva de `online === "OFFLINE"`.
 * - Tóner low/empty: se derivan de los porcentajes de los consumibles
 *   TONER/INK (por color). "Empty" reemplaza a "Low" (distinta `key`), lo que
 *   produce una escalada limpia al resolver el "Low" previo.
 * - Papel/atasco/error/mantenimiento: se derivan de `conditions[]`, que solo
 *   están disponibles tras un probe (no se persisten en el esquema actual).
 */
export function deriveDesiredConditions(
  state: PrinterStateSnapshot,
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS,
): DesiredCondition[] {
  const out: DesiredCondition[] = [];

  if (state.online === "OFFLINE") {
    out.push({
      type: "PRINTER_OFFLINE",
      key: "PRINTER_OFFLINE",
      severity: "ERROR",
      message: "La impresora no responde (estado OFFLINE).",
    });
  }

  for (const s of state.supplies) {
    if (s.type !== "TONER" && s.type !== "INK") continue;
    if (s.percent === null) continue;
    const suffix = colorSuffix(s.color);
    if (s.percent <= thresholds.tonerEmptyPercent) {
      out.push({
        type: "TONER_EMPTY",
        key: `TONER_EMPTY:${s.color}`,
        severity: "ERROR",
        message: `El tóner${suffix} está agotado. Nivel actual: ${s.percent}%.`,
      });
    } else if (s.percent < thresholds.tonerLowPercent) {
      out.push({
        type: "TONER_LOW",
        key: `TONER_LOW:${s.color}`,
        severity: "WARNING",
        message: `El tóner${suffix} está por debajo del ${thresholds.tonerLowPercent}%. Nivel actual: ${s.percent}%.`,
      });
    } else if (s.percent <= thresholds.tonerNoticePercent) {
      out.push({
        type: "TONER_NOTICE",
        key: `TONER_NOTICE:${s.color}`,
        severity: "INFO",
        message: `El tóner${suffix} está a la mitad o menos (≤${thresholds.tonerNoticePercent}%). Nivel actual: ${s.percent}%.`,
        // Aviso puntual: nace resuelto (no se queda "activo").
        autoResolve: true,
      });
    }
  }

  for (const [cond, type, severity, message] of DEVICE_CONDITION_ALERTS) {
    if (state.conditions.includes(cond)) {
      out.push({ type, key: type, severity, message });
    }
  }

  // Dedupe defensivo por key (p.ej. dos consumibles del mismo color).
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true)));
}

// ---------------------------------------------------------------------------
// Reconciliación deseado vs. activo (PURA).
// ---------------------------------------------------------------------------

interface ReconcileContext {
  currentOnline: OnlineState;
  previousOnline?: OnlineState;
  /**
   * Claves para las que NO se debe crear un evento nuevo (dedupe externo). Se
   * usa con los avisos auto-resueltos (TONER_NOTICE) para no re-emitirlos en
   * cada ciclo: persistencia pasa las claves ya avisadas hace poco.
   */
  suppressCreateKeys?: Set<string>;
}

const BACK_ONLINE_EVENT: NewEvent = {
  type: "PRINTER_BACK_ONLINE",
  severity: "INFO",
  message: "La impresora volvió a estar en línea (ONLINE).",
  source: "PRINTER_BACK_ONLINE",
  autoResolve: true,
};

/**
 * Compara las condiciones deseadas con los eventos ya activos y produce la
 * decisión (crear/resolver). El dedupe se hace por la `key` decodificada de
 * `source`, de modo que el ack (sufijo en source) no genera duplicados.
 */
export function reconcile(
  desired: DesiredCondition[],
  existingActive: ExistingActiveEvent[],
  ctx: ReconcileContext,
): AlertDecision {
  const desiredByKey = new Map(desired.map((d) => [d.key, d]));
  const activeKeys = new Set(
    existingActive.map((e) => decodeSource(e.source).key),
  );

  const toCreate: NewEvent[] = [];
  for (const d of desired) {
    if (activeKeys.has(d.key)) continue;
    // Avisos auto-resueltos ya emitidos hace poco: no re-emitir (evita spam).
    if (d.autoResolve && ctx.suppressCreateKeys?.has(d.key)) continue;
    toCreate.push({
      type: d.type,
      severity: d.severity,
      message: d.message,
      source: d.key,
      autoResolve: d.autoResolve,
    });
  }

  const toResolve: string[] = [];
  let resolvedOffline = false;
  for (const e of existingActive) {
    const { key } = decodeSource(e.source);
    if (!desiredByKey.has(key)) {
      toResolve.push(e.id);
      if (e.type === "PRINTER_OFFLINE") resolvedOffline = true;
    }
  }

  // Recuperación: emitir "Back Online" cuando el equipo está ONLINE y venía de
  // OFFLINE (bien porque resolvemos un evento offline activo, bien porque el
  // estado previo era OFFLINE). Se emite a lo sumo una vez por evaluación.
  const cameFromOffline = resolvedOffline || ctx.previousOnline === "OFFLINE";
  if (cameFromOffline && ctx.currentOnline === "ONLINE") {
    toCreate.push({ ...BACK_ONLINE_EVENT });
  }

  return { toCreate, toResolve };
}

// ---------------------------------------------------------------------------
// Función pública de evaluación (PURA): deriva + reconcilia.
// ---------------------------------------------------------------------------

export interface EvaluateOptions {
  thresholds?: AlertThresholds;
  /** Estado previo (opcional): habilita la detección de recuperación. */
  previous?: Pick<PrinterStateSnapshot, "online">;
  /** Claves de avisos auto-resueltos ya emitidos hace poco (no re-emitir). */
  suppressNoticeKeys?: Set<string>;
}

/**
 * Evalúa el estado de UNA impresora y devuelve qué eventos crear/resolver.
 * Totalmente pura: no toca la BD ni el reloj.
 */
export function evaluateAlerts(
  state: PrinterStateSnapshot,
  existingActive: ExistingActiveEvent[],
  opts: EvaluateOptions = {},
): AlertDecision {
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const desired = deriveDesiredConditions(state, thresholds);
  return reconcile(desired, existingActive, {
    currentOnline: state.online,
    previousOnline: opts.previous?.online,
    suppressCreateKeys: opts.suppressNoticeKeys,
  });
}
