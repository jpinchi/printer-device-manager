/**
 * Generación de CSV a mano (Fase 6, sección 30: "Export CSV").
 *
 * Sin librerías externas (regla de coordinación: el módulo de historial no
 * instala dependencias). Todo aquí es PURO y testeable: dado un conjunto de
 * filas, produce una cadena CSV con el escapado correcto de comillas, comas y
 * saltos de línea según RFC 4180.
 */

import type { StatusHistoryRow, CounterHistoryRow } from "./aggregation.js";

/** Valor admitido en una celda antes de serializar. */
export type CsvValue = string | number | boolean | null | undefined | Date;

/**
 * Escapa un único campo CSV.
 *
 * Regla RFC 4180: si el campo contiene comillas dobles, comas o saltos de
 * línea, se envuelve entre comillas dobles y cada comilla interna se duplica.
 * `null`/`undefined` se serializan como cadena vacía.
 */
export function csvEscapeField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let str = value instanceof Date ? value.toISOString() : String(value);
  // Anti-inyección de fórmulas (Excel/Sheets): una celda de TEXTO que empiece
  // por = + - @ (o tab/CR) puede ejecutarse como fórmula. Se antepone una
  // comilla para neutralizarla. Solo aplica a strings (no toca números).
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Serializa una fila (array de campos) a una línea CSV. */
export function csvRow(fields: CsvValue[]): string {
  return fields.map(csvEscapeField).join(",");
}

/**
 * Construye un documento CSV completo a partir de cabeceras y filas.
 *
 * Usa CRLF como separador de líneas (RFC 4180). Función PURA.
 */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [csvRow(headers), ...rows.map((r) => csvRow(r))];
  return lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// Exportadores específicos de historial
// ---------------------------------------------------------------------------

/** CSV del historial de estado (disponibilidad + tóner + páginas). */
export function statusHistoryToCsv(rows: StatusHistoryRow[]): string {
  const headers = [
    "timestamp",
    "status",
    "tonerBlack",
    "tonerCyan",
    "tonerMagenta",
    "tonerYellow",
    "totalPages",
  ];
  const body: CsvValue[][] = rows.map((r) => [
    r.timestamp,
    r.status,
    r.tonerBlack,
    r.tonerCyan,
    r.tonerMagenta,
    r.tonerYellow,
    r.totalPages,
  ]);
  return toCsv(headers, body);
}

/** CSV del historial de contadores. */
export function counterHistoryToCsv(rows: CounterHistoryRow[]): string {
  const headers = ["collectedAt", "counterType", "value"];
  const body: CsvValue[][] = rows.map((r) => [r.collectedAt, r.counterType, r.value]);
  return toCsv(headers, body);
}
