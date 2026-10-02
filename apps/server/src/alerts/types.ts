/**
 * Tipos del motor de alertas (Fase 5, secciones 17 y 29).
 *
 * Pertenece al dominio Backend/Alerts (`apps/server/src/alerts/**`). Consume el
 * contrato congelado `@pdm/types` (estado del dispositivo, consumibles) y el
 * modelo `PrinterEvent` de Prisma, pero NO los reescribe.
 */
import type {
  DeviceCondition,
  OnlineState,
  SupplyColor,
  SupplyType,
} from "@pdm/types";

/**
 * Tipos de alerta soportados (sección 17). Se persisten tal cual en
 * `PrinterEvent.type`. `PRINTER_BACK_ONLINE` es un evento informativo
 * puntual (recuperación), no una condición persistente.
 */
export type AlertType =
  | "PRINTER_OFFLINE"
  | "PRINTER_BACK_ONLINE"
  | "TONER_NOTICE"
  | "TONER_LOW"
  | "TONER_EMPTY"
  | "PAPER_EMPTY"
  | "PAPER_JAM"
  | "DEVICE_ERROR"
  | "MAINTENANCE_REQUIRED";

/** Severidad persistida en `PrinterEvent.severity`. */
export type AlertSeverity = "INFO" | "WARNING" | "ERROR";

/**
 * Umbrales configurables (sección 17: toner low < 15%). Los porcentajes usan
 * la misma escala 0-100 ya normalizada por el SNMP core (`Supply.percent`).
 */
export interface AlertThresholds {
  /** Toner en o por debajo de este % => TONER_NOTICE (aviso "a la mitad"). Por defecto 50. */
  tonerNoticePercent: number;
  /** Toner por DEBAJO de este % => TONER_LOW. Por defecto 15. */
  tonerLowPercent: number;
  /** Toner en o por debajo de este % => TONER_EMPTY. Por defecto 0. */
  tonerEmptyPercent: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  tonerNoticePercent: 50,
  tonerLowPercent: 15,
  tonerEmptyPercent: 0,
};

/** Consumible normalizado que necesita el motor (subconjunto de `Supply`). */
export interface SupplySnapshot {
  name: string;
  type: SupplyType;
  color: SupplyColor;
  /** Porcentaje 0-100 o null si no se puede calcular. */
  percent: number | null;
  level: number;
}

/**
 * Instantánea del estado de UNA impresora que evalúa el motor. Es una vista
 * normalizada: puede construirse desde un `ProbeResult` (tras un poll) o desde
 * las filas de la BD (impresora + supplies).
 */
export interface PrinterStateSnapshot {
  online: OnlineState;
  /** Condiciones del dispositivo (PAPER_JAM, ERROR, ...). Vacío si no se conocen. */
  conditions: DeviceCondition[];
  supplies: SupplySnapshot[];
}

/**
 * Condición que DEBERÍA estar activa ahora mismo según el estado actual.
 * `key` es el identificador estable de la condición (scope de dedupe); se
 * guarda en `PrinterEvent.source`.
 */
export interface DesiredCondition {
  type: AlertType;
  key: string;
  severity: AlertSeverity;
  message: string;
  /**
   * true => el evento nace ya RESUELTO (informativo puntual). No figura como
   * "activo"; sirve para avisos que no deben acumularse (p.ej. TONER_NOTICE).
   */
  autoResolve?: boolean;
}

/** Evento a crear en la BD. */
export interface NewEvent {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  /** Clave de condición (dedupe) o marcador; se guarda en `source`. */
  source: string;
  /**
   * true para eventos informativos puntuales (p.ej. PRINTER_BACK_ONLINE): se
   * crean ya resueltos para que no figuren como "activos".
   */
  autoResolve?: boolean;
}

/** Evento activo existente (resolvedAt = null) leído de la BD. */
export interface ExistingActiveEvent {
  id: string;
  type: string;
  /** Valor crudo de `PrinterEvent.source` (puede llevar sufijo de ack). */
  source: string;
}

/** Decisión del motor: qué crear y qué resolver. Ambas listas pueden ir vacías. */
export interface AlertDecision {
  toCreate: NewEvent[];
  /** IDs de eventos existentes que deben marcarse como resueltos. */
  toResolve: string[];
}
