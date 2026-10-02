/**
 * Persistencia del motor de alertas (Fase 5).
 *
 * Puente entre la lógica PURA (`engine.ts`) y la BD (`PrinterEvent`). Construye
 * la instantánea de estado desde la BD (o la recibe ya hecha desde un probe),
 * evalúa, y aplica la decisión: crea eventos nuevos y resuelve los que ya no
 * aplican. NO modifica el esquema (el ack se codifica en `source`, ver engine).
 */
import type { PrismaClient } from "@prisma/client";
import type { OnlineState, SupplyColor, SupplyType } from "@pdm/types";
import { evaluateAlerts, type EvaluateOptions } from "./engine.js";
import type {
  ExistingActiveEvent,
  PrinterStateSnapshot,
  AlertThresholds,
} from "./types.js";

export interface PersistResult {
  printerId: string;
  created: number;
  resolved: number;
}

/** Impresora + consumibles tal como los devuelve Prisma (subconjunto usado). */
interface PrinterWithSupplies {
  id: string;
  status: string;
  supplies: Array<{
    name: string;
    type: string;
    color: string;
    percent: number | null;
    level: number;
  }>;
}

/** Normaliza el `status` de la BD al OnlineState del contrato. */
function toOnline(status: string): OnlineState {
  if (status === "ONLINE") return "ONLINE";
  if (status === "OFFLINE") return "OFFLINE";
  return "UNKNOWN";
}

/**
 * Construye la instantánea que evalúa el motor a partir de filas de BD. Las
 * `conditions[]` (atasco, error, etc.) NO se persisten en el esquema actual, así
 * que quedan vacías: desde BD solo se derivan alertas de OFFLINE y de tóner.
 * Para incluir condiciones de dispositivo, pásale un snapshot desde un probe.
 */
export function buildSnapshotFromDb(printer: PrinterWithSupplies): PrinterStateSnapshot {
  return {
    online: toOnline(printer.status),
    conditions: [],
    supplies: printer.supplies.map((s) => ({
      name: s.name,
      type: s.type as SupplyType,
      color: s.color as SupplyColor,
      percent: s.percent,
      level: s.level,
    })),
  };
}

async function getActiveEvents(
  prisma: PrismaClient,
  printerId: string,
): Promise<ExistingActiveEvent[]> {
  const rows = await prisma.printerEvent.findMany({
    where: { printerId, resolvedAt: null },
    select: { id: true, type: true, source: true },
  });
  return rows.map((r) => ({ id: r.id, type: r.type, source: r.source ?? "" }));
}

/** Ventana de dedupe para avisos auto-resueltos (TONER_NOTICE). */
const NOTICE_DEDUPE_MS = 24 * 60 * 60 * 1000;

/**
 * Claves (`source`) de avisos TONER_NOTICE emitidos en las últimas 24h para esta
 * impresora. Como nacen resueltos, no aparecen como "activos"; este dedupe evita
 * re-emitirlos en cada ciclo mientras el tóner siga a la mitad.
 */
async function getRecentNoticeKeys(
  prisma: PrismaClient,
  printerId: string,
): Promise<Set<string>> {
  const since = new Date(Date.now() - NOTICE_DEDUPE_MS);
  const rows = await prisma.printerEvent.findMany({
    where: { printerId, type: "TONER_NOTICE", createdAt: { gte: since } },
    select: { source: true },
  });
  return new Set(rows.map((r) => r.source ?? "").filter(Boolean));
}

export interface EvaluateAndPersistOptions extends EvaluateOptions {
  /** Snapshot explícito (p.ej. desde un probe con conditions). Si falta, se lee de BD. */
  state?: PrinterStateSnapshot;
  thresholds?: AlertThresholds;
}

/**
 * Evalúa y persiste alertas de UNA impresora. Idempotente frente a condiciones
 * activas (dedupe en el motor): llamarla dos veces con el mismo estado no
 * duplica eventos.
 */
export async function evaluateAndPersist(
  prisma: PrismaClient,
  printerId: string,
  opts: EvaluateAndPersistOptions = {},
): Promise<PersistResult> {
  let state = opts.state;
  if (!state) {
    const printer = await prisma.printer.findUnique({
      where: { id: printerId },
      select: {
        id: true,
        status: true,
        supplies: { select: { name: true, type: true, color: true, percent: true, level: true } },
      },
    });
    if (!printer) return { printerId, created: 0, resolved: 0 };
    state = buildSnapshotFromDb(printer);
  }

  const active = await getActiveEvents(prisma, printerId);
  const suppressNoticeKeys = await getRecentNoticeKeys(prisma, printerId);
  const decision = evaluateAlerts(state, active, {
    thresholds: opts.thresholds,
    previous: opts.previous,
    suppressNoticeKeys,
  });

  const now = new Date();

  if (decision.toCreate.length) {
    await prisma.printerEvent.createMany({
      data: decision.toCreate.map((e) => ({
        printerId,
        severity: e.severity,
        type: e.type,
        message: e.message,
        source: e.source,
        // Eventos informativos puntuales (Back Online) nacen ya resueltos.
        resolvedAt: e.autoResolve ? now : null,
      })),
    });
  }

  if (decision.toResolve.length) {
    await prisma.printerEvent.updateMany({
      where: { id: { in: decision.toResolve } },
      data: { resolvedAt: now },
    });
  }

  return {
    printerId,
    created: decision.toCreate.length,
    resolved: decision.toResolve.length,
  };
}

/**
 * Evalúa TODAS las impresoras del inventario (ciclo autónomo). Pensado para
 * correr en su propio intervalo o tras un ciclo de polling.
 *
 * Rendimiento (P4): evita el patrón N+1. En vez de 2 lecturas + 2 escrituras
 * POR impresora, agrupa todo en consultas por lote:
 *   1 lectura de impresoras + 1 de eventos activos + 1 de avisos recientes, y
 *   a lo sumo 1 createMany + 1 updateMany para TODO el inventario. El número de
 *   consultas es constante (~5) en vez de crecer con la cantidad de impresoras.
 */
export async function runAlertEvaluationCycle(
  prisma: PrismaClient,
  opts: { thresholds?: AlertThresholds } = {},
): Promise<{ printers: number; created: number; resolved: number }> {
  const printers = await prisma.printer.findMany({
    select: {
      id: true,
      status: true,
      supplies: { select: { name: true, type: true, color: true, percent: true, level: true } },
    },
  });
  if (printers.length === 0) return { printers: 0, created: 0, resolved: 0 };

  const ids = printers.map((p) => p.id);

  // (1 consulta) Eventos activos de TODAS las impresoras, agrupados por id.
  const activeRows = await prisma.printerEvent.findMany({
    where: { printerId: { in: ids }, resolvedAt: null },
    select: { id: true, printerId: true, type: true, source: true },
  });
  const activeByPrinter = new Map<string, ExistingActiveEvent[]>();
  for (const r of activeRows) {
    const list = activeByPrinter.get(r.printerId) ?? [];
    list.push({ id: r.id, type: r.type, source: r.source ?? "" });
    activeByPrinter.set(r.printerId, list);
  }

  // (1 consulta) Avisos TONER_NOTICE recientes de TODAS, agrupados por id.
  const since = new Date(Date.now() - NOTICE_DEDUPE_MS);
  const noticeRows = await prisma.printerEvent.findMany({
    where: { printerId: { in: ids }, type: "TONER_NOTICE", createdAt: { gte: since } },
    select: { printerId: true, source: true },
  });
  const noticeByPrinter = new Map<string, Set<string>>();
  for (const r of noticeRows) {
    const set = noticeByPrinter.get(r.printerId) ?? new Set<string>();
    if (r.source) set.add(r.source);
    noticeByPrinter.set(r.printerId, set);
  }

  // Evaluación PURA por impresora; se acumulan las decisiones para escribir en lote.
  const now = new Date();
  const toCreate: Array<{
    printerId: string;
    severity: string;
    type: string;
    message: string;
    source: string;
    resolvedAt: Date | null;
  }> = [];
  const toResolve: string[] = [];

  for (const p of printers) {
    const decision = evaluateAlerts(buildSnapshotFromDb(p), activeByPrinter.get(p.id) ?? [], {
      thresholds: opts.thresholds,
      suppressNoticeKeys: noticeByPrinter.get(p.id) ?? new Set<string>(),
    });
    for (const e of decision.toCreate) {
      toCreate.push({
        printerId: p.id,
        severity: e.severity,
        type: e.type,
        message: e.message,
        source: e.source,
        resolvedAt: e.autoResolve ? now : null,
      });
    }
    toResolve.push(...decision.toResolve);
  }

  // (≤1 consulta cada una) Escrituras agrupadas para todo el inventario.
  if (toCreate.length) await prisma.printerEvent.createMany({ data: toCreate });
  if (toResolve.length) {
    await prisma.printerEvent.updateMany({
      where: { id: { in: toResolve } },
      data: { resolvedAt: now },
    });
  }

  return { printers: printers.length, created: toCreate.length, resolved: toResolve.length };
}
