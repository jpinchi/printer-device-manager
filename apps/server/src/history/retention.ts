/**
 * Políticas de retención y poda del historial (Fase 6, sección 18).
 *
 * La sección 18 recomienda NO guardar cada consulta SNMP indefinidamente y da
 * como ejemplo:
 *   - Raw status history ...... 30 días
 *   - Hourly summaries ........ 6 meses
 *   - Daily counter summaries . largo plazo
 *
 * El esquema (congelado) no tiene tablas para persistir resúmenes horarios/
 * diarios; esos resúmenes se calculan bajo demanda (ver `aggregation.ts`). Por
 * eso la poda opera sobre las tablas crudas existentes:
 *   - `PrinterStatusHistory` (estado + tóner) → retención `rawStatusDays`.
 *   - `PrinterEvent` (errores/eventos)        → retención `eventDays`.
 *   - `PrinterCounter` (contadores)           → retención `counterDays`
 *        (por defecto `null` = conservar a largo plazo, según la sección 18).
 *
 * `runRetention` es DESTRUCTIVO: borra filas antiguas. Solo borra dentro de las
 * políticas y, si se le pasa `printerIds`, únicamente de esas impresoras (útil
 * para pruebas aisladas). Nunca borra nada fuera de la política.
 */

import type { PrismaClient } from "@prisma/client";

/** Milisegundos en un día. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Política de retención configurable. Un valor `null` significa "conservar a
 * largo plazo" (no podar esa tabla).
 */
export interface RetentionPolicy {
  /** Días de historial de estado crudo a conservar. Sección 18: 30. */
  rawStatusDays: number | null;
  /** Días de eventos/errores a conservar. */
  eventDays: number | null;
  /**
   * Días de contadores crudos a conservar. `null` = largo plazo (por defecto),
   * coherente con "Daily counter summaries: long-term" de la sección 18.
   */
  counterDays: number | null;
}

/** Política por defecto (defaults de la sección 18). */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  rawStatusDays: 30,
  eventDays: 180, // ~6 meses de historial de errores
  counterDays: null, // conservar contadores a largo plazo
};

/** Resultado de una ejecución de poda: filas borradas por tabla. */
export interface RetentionResult {
  statusHistoryDeleted: number;
  eventsDeleted: number;
  countersDeleted: number;
  /** Fechas de corte efectivas (para logging/auditoría). */
  cutoffs: {
    statusBefore: string | null;
    eventsBefore: string | null;
    countersBefore: string | null;
  };
}

/** Opciones de ejecución de la poda. */
export interface RunRetentionOptions {
  /** Reloj de referencia (por defecto `new Date()`). Inyectable para pruebas. */
  now?: Date;
  /**
   * Si se especifica, la poda se limita a estas impresoras. Imprescindible en
   * pruebas para no tocar datos reales (sembrar IPs ficticias y pasar sus ids).
   */
  printerIds?: string[];
}

/** Calcula la fecha de corte para un número de días, o null si no aplica. */
function cutoffFor(days: number | null, now: Date): Date | null {
  if (days === null || !Number.isFinite(days) || days < 0) return null;
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * Poda el historial según la política. DESTRUCTIVO.
 *
 * Borra en cada tabla las filas más antiguas que su fecha de corte. Si
 * `opts.printerIds` está presente, restringe cada borrado a esas impresoras.
 * Devuelve el conteo de filas borradas por tabla.
 */
/**
 * Ejecuta `del(take)` en bucle (cada llamada borra hasta `take` filas y devuelve
 * cuántas borró) hasta que no quede nada, cediendo el event loop entre tandas
 * para no retener el lock de escritura de SQLite. Devuelve el total borrado.
 */
async function deleteInBatches(
  del: (take: number) => Promise<number>,
  batch = 1000,
): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await del(batch);
    total += n;
    if (n < batch) break;
    await new Promise((r) => setImmediate(r));
  }
  return total;
}

export async function runRetention(
  prisma: PrismaClient,
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
  opts: RunRetentionOptions = {},
): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const printerScope =
    opts.printerIds && opts.printerIds.length > 0
      ? { printerId: { in: opts.printerIds } }
      : {};

  const statusBefore = cutoffFor(policy.rawStatusDays, now);
  const eventsBefore = cutoffFor(policy.eventDays, now);
  const countersBefore = cutoffFor(policy.counterDays, now);

  let statusHistoryDeleted = 0;
  let eventsDeleted = 0;
  let countersDeleted = 0;

  // IMPORTANTE (robustez): borramos POR LOTES. Un `deleteMany` de decenas de
  // miles de filas es UNA transacción de escritura que retiene el lock de SQLite
  // durante todo el borrado y congela cualquier otra consulta (fue la causa del
  // cuelgue: "Socket timeout"). Troceando y cediendo el event loop entre tandas,
  // el lock se libera y el resto de operaciones avanza.
  if (statusBefore) {
    statusHistoryDeleted = await deleteInBatches((take) =>
      prisma.printerStatusHistory
        .findMany({ where: { ...printerScope, timestamp: { lt: statusBefore } }, select: { id: true }, take })
        .then((rows) =>
          rows.length
            ? prisma.printerStatusHistory
                .deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
                .then((r) => r.count)
            : 0,
        ),
    );
  }

  if (eventsBefore) {
    eventsDeleted = await deleteInBatches((take) =>
      prisma.printerEvent
        .findMany({ where: { ...printerScope, createdAt: { lt: eventsBefore } }, select: { id: true }, take })
        .then((rows) =>
          rows.length
            ? prisma.printerEvent
                .deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
                .then((r) => r.count)
            : 0,
        ),
    );
  }

  if (countersBefore) {
    countersDeleted = await deleteInBatches((take) =>
      prisma.printerCounter
        .findMany({ where: { ...printerScope, collectedAt: { lt: countersBefore } }, select: { id: true }, take })
        .then((rows) =>
          rows.length
            ? prisma.printerCounter
                .deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
                .then((r) => r.count)
            : 0,
        ),
    );
  }

  return {
    statusHistoryDeleted,
    eventsDeleted,
    countersDeleted,
    cutoffs: {
      statusBefore: statusBefore?.toISOString() ?? null,
      eventsBefore: eventsBefore?.toISOString() ?? null,
      countersBefore: countersBefore?.toISOString() ?? null,
    },
  };
}
