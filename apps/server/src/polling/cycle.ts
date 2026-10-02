/**
 * Ciclo de polling: UNA pasada sobre las impresoras de la BD.
 *
 * `runPollingCycle` está separada de los `setInterval` (ver `scheduler.ts`)
 * precisamente para poder probarla en modo mock sin esperar temporizadores:
 * siembra una impresora, corre un ciclo y verifica la BD.
 *
 * Para cada impresora: la consulta por SNMP con `probe()` y, según qué pollers
 * "tocan" en este ciclo (`kinds`), escribe solo el trozo correspondiente
 * reutilizando las escrituras dirigidas de `updates.ts`. Si el dispositivo no
 * es alcanzable, lo marca OFFLINE (detección automática, sección 28).
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import type { ProbeResult, SnmpCredentials } from "@pdm/types";
import { probe as defaultProbe, type ProbeCollector } from "@pdm/snmp-core";
import { config } from "../config.js";
import type { PollerKind } from "./selection.js";
import { POLLER_KINDS } from "./selection.js";
import {
  updatePrinterStatus,
  markPrinterOffline,
  updatePrinterSupplies,
  updatePrinterTrays,
  updatePrinterCounters,
  updatePrinterInfo,
} from "./updates.js";

/** Firma de `probe()`, inyectable para pruebas. */
export type ProbeFn = (
  ip: string,
  creds: SnmpCredentials,
  opts?: { mock?: boolean; collect?: ProbeCollector[] },
) => Promise<ProbeResult>;

/** Máximo de impresoras consultadas por SNMP en paralelo dentro de un ciclo. */
// Concurrencia del sondeo (I/O de red SNMP). Configurable por env para poder
// ajustar sin recompilar si la BD sufre bajo mucha escritura concurrente.
const POLL_CONCURRENCY = Math.max(1, Math.min(Number(process.env.POLL_CONCURRENCY) || 10, 32));

/** Traduce los pollers vencidos a los recolectores SNMP que hay que leer. */
function collectorsFor(kinds: PollerKind[]): ProbeCollector[] {
  const has = (k: PollerKind) => kinds.includes(k);
  const c: ProbeCollector[] = [];
  if (has("status") || has("errors")) c.push("status");
  if (has("supplies")) c.push("supplies");
  if (has("trays")) c.push("trays");
  if (has("counters")) c.push("counters");
  if (has("deviceInfo")) c.push("info");
  return c;
}

/** Ejecuta `fn` sobre `items` con un límite de concurrencia (orden libre). */
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export interface RunCycleOptions {
  /** Usa el cliente SNMP simulado (fixtures) en vez de la red real. */
  mock?: boolean;
  /** Qué pollers escribir en este ciclo. Por defecto, todos. */
  kinds?: PollerKind[];
  /** Filtro Prisma para acotar el conjunto de impresoras (útil en tests). */
  where?: Prisma.PrinterWhereInput;
  /** Implementación de probe (por defecto la de @pdm/snmp-core). */
  probeFn?: ProbeFn;
  /** Reloj inyectable (por defecto `new Date()`). */
  now?: () => Date;
}

/** Resumen de lo ocurrido en un ciclo. */
export interface CycleReport {
  total: number;
  online: number;
  offline: number;
  failed: number;
  kinds: PollerKind[];
}

/** Construye credenciales SNMP para una impresora concreta. */
function credsFor(snmpVersion: string): SnmpCredentials {
  return {
    version: (snmpVersion as SnmpCredentials["version"]) ?? config.snmp.defaultVersion,
    // La community cifrada por impresora es aún un placeholder (sección 23);
    // se usa la community por defecto del entorno, igual que el endpoint /poll.
    community: config.snmp.defaultCommunity,
    timeoutMs: config.snmp.timeoutMs,
    retries: config.snmp.retries,
  };
}

/**
 * Aplica a la BD el resultado de un probe alcanzable, escribiendo solo los
 * trozos cuyos pollers vencen (`kinds`).
 */
async function persistReachable(
  prisma: PrismaClient,
  printerId: string,
  result: ProbeResult,
  kinds: PollerKind[],
  now: Date,
): Promise<void> {
  const has = (k: PollerKind) => kinds.includes(k);

  // El historial de estado/lastSeen se escribe si vence status O errors (ambos
  // dependen de leer el estado del dispositivo).
  if (has("status") || has("errors")) {
    await updatePrinterStatus(prisma, printerId, result, now);
  }
  if (has("supplies")) await updatePrinterSupplies(prisma, printerId, result);
  if (has("trays")) await updatePrinterTrays(prisma, printerId, result);
  if (has("counters")) await updatePrinterCounters(prisma, printerId, result);
  if (has("deviceInfo")) await updatePrinterInfo(prisma, printerId, result);
}

/**
 * Ejecuta una pasada de polling sobre las impresoras seleccionadas.
 *
 * No lanza si una impresora individual falla: registra el fallo en el reporte y
 * continúa con las demás (tolerancia a fallos, sección 34).
 */
export async function runPollingCycle(
  prisma: PrismaClient,
  opts: RunCycleOptions = {},
): Promise<CycleReport> {
  const kinds = opts.kinds ?? [...POLLER_KINDS];
  const probeFn = opts.probeFn ?? defaultProbe;
  const nowFn = opts.now ?? (() => new Date());

  const printers = await prisma.printer.findMany({
    where: opts.where,
    select: { id: true, ipAddress: true, snmpVersion: true },
  });

  const report: CycleReport = {
    total: printers.length,
    online: 0,
    offline: 0,
    failed: 0,
    kinds,
  };

  // Solo se leen por SNMP los recolectores cuyos pollers vencen este ciclo
  // (ahorro grande: en el tick de 45s normalmente solo se lee "status").
  const collect = collectorsFor(kinds);

  // Concurrencia acotada: una impresora offline cuesta timeout×(reintentos+1);
  // en serie, unas pocas offline harían que el ciclo exceda su intervalo.
  await mapPool(printers, POLL_CONCURRENCY, async (p) => {
    try {
      const result = await probeFn(p.ipAddress, credsFor(p.snmpVersion), {
        mock: opts.mock ?? config.snmp.mock,
        collect,
      });

      if (result.reachable) {
        await persistReachable(prisma, p.id, result, kinds, nowFn());
        report.online++;
      } else {
        await markPrinterOffline(prisma, p.id);
        report.offline++;
      }
    } catch (err) {
      // Un fallo puntual (probe o escritura) no aborta el ciclo completo. Se
      // cuenta como `failed` (sin sumar también a `offline`: el total cuadra).
      report.failed++;
      console.error(
        `[polling] fallo al consultar ${p.ipAddress}:`,
        err instanceof Error ? err.message : err,
      );
      // Mejor esfuerzo: intentar marcar OFFLINE si el probe reventó.
      await markPrinterOffline(prisma, p.id).catch(() => {
        /* la BD podría estar caída; ya está contado como failed */
      });
    }
  });

  return report;
}
