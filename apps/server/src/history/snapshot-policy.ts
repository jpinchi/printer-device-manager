/**
 * Política de muestreo del historial de estado.
 *
 * Antes se guardaba una fila de `PrinterStatusHistory` en CADA ciclo de sondeo,
 * lo que inflaba el historial (decenas de puntos por hora). Ahora se toma un
 * snapshot como máximo una vez por INTERVALO (por defecto 1 hora) por impresora,
 * con una excepción importante: si el estado CAMBIA (p. ej. pasa a OFFLINE o
 * vuelve ONLINE) se registra de inmediato, para no perder eventos de auditoría.
 *
 * El intervalo es configurable con `PDM_HISTORY_INTERVAL_MIN` (minutos).
 */
import type { PrismaClient } from "@prisma/client";

/** Intervalo mínimo entre snapshots del MISMO estado (ms). Default: 60 min. */
export const HISTORY_INTERVAL_MS =
  Math.max(1, Number(process.env.PDM_HISTORY_INTERVAL_MIN ?? 60)) * 60_000;

/** Nº de puntos "recientes" que muestra el detalle de la impresora. */
export const RECENT_HISTORY_POINTS = Math.max(1, Number(process.env.PDM_HISTORY_RECENT ?? 12));

/**
 * ¿Se debe guardar un nuevo punto de historial para esta impresora ahora?
 * Sí cuando: no hay puntos previos, el estado cambió, o ya pasó el intervalo
 * desde el último punto del mismo estado.
 */
export async function shouldRecordStatusHistory(
  prisma: PrismaClient,
  printerId: string,
  status: string,
  now: Date = new Date(),
): Promise<boolean> {
  const last = await prisma.printerStatusHistory.findFirst({
    where: { printerId },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true, status: true },
  });
  if (!last) return true; // primer punto
  if (last.status !== status) return true; // cambio de estado: registrar siempre
  return now.getTime() - last.timestamp.getTime() >= HISTORY_INTERVAL_MS;
}
