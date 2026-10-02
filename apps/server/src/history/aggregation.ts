/**
 * Agregación de historial (Fase 6, sección 18 del plan maestro).
 *
 * Toda la lógica de esta capa es PURA y testeable: dado un array de filas con
 * marca de tiempo, produce "buckets" (resúmenes) por hora o por día. No toca la
 * base de datos ni el reloj del sistema, de modo que puede probarse con datos
 * sembrados y resultados deterministas.
 *
 * Estos resúmenes se calculan bajo demanda a partir del historial crudo. El
 * esquema (congelado) no tiene tablas para persistir resúmenes; si en el futuro
 * se quiere materializarlos (sección 18: "resúmenes horarios 6 meses"), haría
 * falta una tabla nueva — eso se reporta al orquestador, no se añade aquí.
 */

/** Unidad temporal de un bucket de agregación. */
export type BucketUnit = "hour" | "day";

/**
 * Trunca una fecha al inicio de su bucket (hora o día) en UTC y devuelve una
 * nueva `Date`. Se usa UTC para que la agrupación sea determinista e
 * independiente de la zona horaria del proceso.
 */
export function bucketStart(date: Date, unit: BucketUnit): Date {
  const d = new Date(date.getTime());
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  if (unit === "day") {
    d.setUTCHours(0);
  }
  return d;
}

/** Clave ISO estable del bucket al que pertenece una fecha. */
export function bucketKey(date: Date, unit: BucketUnit): string {
  return bucketStart(date, unit).toISOString();
}

// ---------------------------------------------------------------------------
// Historial de estado (disponibilidad + tóner)
// ---------------------------------------------------------------------------

/** Fila cruda de `PrinterStatusHistory` (lo mínimo que necesita la agregación). */
export interface StatusHistoryRow {
  timestamp: Date;
  status: string;
  tonerBlack: number | null;
  tonerCyan: number | null;
  tonerMagenta: number | null;
  tonerYellow: number | null;
  totalPages: number | null;
}

/** Resumen de estado por bucket (disponibilidad y niveles medios de tóner). */
export interface StatusSummary {
  /** Inicio del bucket en ISO 8601 (UTC). */
  bucket: string;
  unit: BucketUnit;
  /** Número de muestras en el bucket. */
  samples: number;
  onlineCount: number;
  offlineCount: number;
  unknownCount: number;
  /** Proporción de muestras ONLINE (0-1), útil para disponibilidad. */
  uptimeRatio: number;
  avgTonerBlack: number | null;
  avgTonerCyan: number | null;
  avgTonerMagenta: number | null;
  avgTonerYellow: number | null;
  /** Mayor `totalPages` observado (los contadores son monótonos crecientes). */
  maxTotalPages: number | null;
}

/** Promedio de los valores no nulos, o null si no hay ninguno. */
function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

/** Máximo de los valores no nulos, o null si no hay ninguno. */
function maxOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

/**
 * Resume un historial de estado en buckets por hora o por día.
 *
 * Función PURA: no muta la entrada. Los buckets salen ordenados
 * cronológicamente por su clave ISO.
 */
export function summarizeStatusHistory(
  rows: StatusHistoryRow[],
  unit: BucketUnit,
): StatusSummary[] {
  const groups = new Map<string, StatusHistoryRow[]>();
  for (const row of rows) {
    const key = bucketKey(row.timestamp, unit);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const summaries: StatusSummary[] = [];
  for (const [bucket, list] of groups) {
    const onlineCount = list.filter((r) => r.status === "ONLINE").length;
    const offlineCount = list.filter((r) => r.status === "OFFLINE").length;
    const unknownCount = list.length - onlineCount - offlineCount;
    summaries.push({
      bucket,
      unit,
      samples: list.length,
      onlineCount,
      offlineCount,
      unknownCount,
      uptimeRatio: list.length ? onlineCount / list.length : 0,
      avgTonerBlack: avg(list.map((r) => r.tonerBlack)),
      avgTonerCyan: avg(list.map((r) => r.tonerCyan)),
      avgTonerMagenta: avg(list.map((r) => r.tonerMagenta)),
      avgTonerYellow: avg(list.map((r) => r.tonerYellow)),
      maxTotalPages: maxOf(list.map((r) => r.totalPages)),
    });
  }

  summaries.sort((a, b) => a.bucket.localeCompare(b.bucket));
  return summaries;
}

// ---------------------------------------------------------------------------
// Historial de contadores (crecimiento de páginas)
// ---------------------------------------------------------------------------

/** Fila cruda de `PrinterCounter`. */
export interface CounterHistoryRow {
  counterType: string;
  value: number;
  collectedAt: Date;
}

/** Resumen de un contador en un bucket. */
export interface CounterSummary {
  bucket: string;
  unit: BucketUnit;
  counterType: string;
  samples: number;
  minValue: number;
  maxValue: number;
  /** Último valor del bucket (por `collectedAt`). */
  lastValue: number;
  /** Crecimiento dentro del bucket (max - min), nunca negativo. */
  delta: number;
}

/**
 * Resume el historial de contadores por bucket y por `counterType`.
 *
 * Función PURA. La clave de agrupación combina bucket + tipo de contador, de
 * modo que TOTAL, BLACK_WHITE, COLOR, etc. se resumen por separado.
 */
export function summarizeCounterHistory(
  rows: CounterHistoryRow[],
  unit: BucketUnit,
): CounterSummary[] {
  const groups = new Map<string, CounterHistoryRow[]>();
  for (const row of rows) {
    const key = `${bucketKey(row.collectedAt, unit)}|${row.counterType}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const summaries: CounterSummary[] = [];
  for (const [, list] of groups) {
    // Ordenar por marca de tiempo para identificar el último valor del bucket.
    const ordered = [...list].sort(
      (a, b) => a.collectedAt.getTime() - b.collectedAt.getTime(),
    );
    const values = ordered.map((r) => r.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    summaries.push({
      bucket: bucketKey(first.collectedAt, unit),
      unit,
      counterType: first.counterType,
      samples: ordered.length,
      minValue,
      maxValue,
      lastValue: last.value,
      delta: Math.max(0, maxValue - minValue),
    });
  }

  // Orden estable: primero por bucket, luego por tipo de contador.
  summaries.sort(
    (a, b) => a.bucket.localeCompare(b.bucket) || a.counterType.localeCompare(b.counterType),
  );
  return summaries;
}
