/**
 * Consultas de historial sobre Prisma (Fase 6, sección 30).
 *
 * Lecturas por impresora con rango de fechas opcional. No mutan nada. Devuelven
 * las filas crudas que luego alimentan a la capa PURA de agregación
 * (`aggregation.ts`) y a los exportadores CSV (`csv.ts`).
 *
 * Nota sobre "supply history": el esquema (congelado) guarda el consumible
 * actual en `PrinterSupply` como una instantánea que el polling reemplaza en
 * cada ciclo — no tiene serie temporal propia. El histórico de niveles de tóner
 * vive en las columnas `tonerBlack/Cyan/Magenta/Yellow` de
 * `PrinterStatusHistory`, así que la serie de consumibles se deriva de ahí.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  StatusHistoryRow,
  CounterHistoryRow,
} from "./aggregation.js";

/** Rango de fechas inclusivo/abierto. Ambos extremos son opcionales. */
export interface DateRange {
  from?: Date;
  to?: Date;
}

/** Traduce un `DateRange` a un filtro Prisma `{ gte, lte }` (o `undefined`). */
function whereTimestamp(range: DateRange | undefined, field: "timestamp" | "collectedAt" | "createdAt") {
  if (!range || (!range.from && !range.to)) return {};
  const cond: { gte?: Date; lte?: Date } = {};
  if (range.from) cond.gte = range.from;
  if (range.to) cond.lte = range.to;
  return { [field]: cond };
}

/** Límite defensivo de filas por consulta (evita respuestas enormes). */
const DEFAULT_LIMIT = 5000;

// ---------------------------------------------------------------------------
// Historial de estado
// ---------------------------------------------------------------------------

/** Historial de estado (disponibilidad + tóner) de una impresora. */
export async function getStatusHistory(
  prisma: PrismaClient,
  printerId: string,
  range?: DateRange,
  limit: number = DEFAULT_LIMIT,
): Promise<StatusHistoryRow[]> {
  const rows = await prisma.printerStatusHistory.findMany({
    where: { printerId, ...whereTimestamp(range, "timestamp") },
    orderBy: { timestamp: "asc" },
    take: limit,
    select: {
      timestamp: true,
      status: true,
      tonerBlack: true,
      tonerCyan: true,
      tonerMagenta: true,
      tonerYellow: true,
      totalPages: true,
    },
  });
  return rows;
}

/**
 * Los `limit` puntos MÁS RECIENTES de historial de estado (para el panel
 * "Historial reciente" del detalle). Consulta descendente y luego invierte para
 * devolverlos en orden cronológico ascendente.
 */
export async function getRecentStatusHistory(
  prisma: PrismaClient,
  printerId: string,
  limit: number,
): Promise<StatusHistoryRow[]> {
  const rows = await prisma.printerStatusHistory.findMany({
    where: { printerId },
    orderBy: { timestamp: "desc" },
    take: Math.max(1, limit),
    select: {
      timestamp: true,
      status: true,
      tonerBlack: true,
      tonerCyan: true,
      tonerMagenta: true,
      tonerYellow: true,
      totalPages: true,
    },
  });
  return rows.reverse();
}

// ---------------------------------------------------------------------------
// Historial de contadores
// ---------------------------------------------------------------------------

/** Historial de contadores de una impresora (opcionalmente por tipo). */
export async function getCounterHistory(
  prisma: PrismaClient,
  printerId: string,
  range?: DateRange,
  counterType?: string,
  limit: number = DEFAULT_LIMIT,
): Promise<CounterHistoryRow[]> {
  const rows = await prisma.printerCounter.findMany({
    where: {
      printerId,
      ...(counterType ? { counterType } : {}),
      ...whereTimestamp(range, "collectedAt"),
    },
    orderBy: { collectedAt: "asc" },
    take: limit,
    select: { counterType: true, value: true, collectedAt: true },
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Historial de consumibles (derivado del historial de estado)
// ---------------------------------------------------------------------------

/** Un punto de la serie temporal de un consumible (tóner) por color. */
export interface SupplyHistoryPoint {
  timestamp: Date;
  black: number | null;
  cyan: number | null;
  magenta: number | null;
  yellow: number | null;
}

/**
 * Serie temporal de niveles de tóner, derivada de `PrinterStatusHistory`.
 * Devuelve solo las muestras con al menos un color no nulo.
 */
export async function getSupplyHistory(
  prisma: PrismaClient,
  printerId: string,
  range?: DateRange,
  limit: number = DEFAULT_LIMIT,
): Promise<SupplyHistoryPoint[]> {
  const rows = await getStatusHistory(prisma, printerId, range, limit);
  return rows
    .filter(
      (r) =>
        r.tonerBlack !== null ||
        r.tonerCyan !== null ||
        r.tonerMagenta !== null ||
        r.tonerYellow !== null,
    )
    .map((r) => ({
      timestamp: r.timestamp,
      black: r.tonerBlack,
      cyan: r.tonerCyan,
      magenta: r.tonerMagenta,
      yellow: r.tonerYellow,
    }));
}

// ---------------------------------------------------------------------------
// Historial de errores
// ---------------------------------------------------------------------------

/** Un evento de error del historial (subconjunto de `PrinterEvent`). */
export interface ErrorHistoryRow {
  severity: string;
  type: string;
  message: string;
  source: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

/**
 * Historial de errores de una impresora (eventos con severidad ERROR).
 *
 * El motor de alertas (otro dominio) es quien escribe `PrinterEvent`; aquí solo
 * se leen para reportes de "errores frecuentes / períodos offline" (sección 18).
 */
export async function getErrorHistory(
  prisma: PrismaClient,
  printerId: string,
  range?: DateRange,
  limit: number = DEFAULT_LIMIT,
): Promise<ErrorHistoryRow[]> {
  const rows = await prisma.printerEvent.findMany({
    where: {
      printerId,
      severity: "ERROR",
      ...whereTimestamp(range, "createdAt"),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      severity: true,
      type: true,
      message: true,
      source: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
  return rows;
}
