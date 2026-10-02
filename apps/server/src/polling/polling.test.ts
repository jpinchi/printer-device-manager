/**
 * Pruebas del motor de polling (Fase 4).
 *
 * - Lógica PURA de selección de pollers (sin reloj real).
 * - `runPollingCycle` en modo mock: siembra impresoras ficticias (IPs 10.99.0.x
 *   para no chocar con otros agentes), corre un ciclo y verifica que
 *   status/lastSeen/historial se actualizan. Limpia todo al final.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db.js";
import { runPollingCycle } from "./cycle.js";
import { selectDuePollers, markRan, POLLER_KINDS } from "./selection.js";
import type { PollingIntervals } from "./config.js";

const intervals: PollingIntervals = {
  status: 1000,
  errors: 2000,
  supplies: 5000,
  trays: 5000,
  counters: 30000,
  deviceInfo: 100000,
};

// Prefijo de IPs ficticias exclusivo de esta prueba (aislamiento entre agentes).
const IP_PREFIX = "10.99.0.";
const IP_ONLINE = "10.99.0.11"; // fixture RICOH en modo mock
const IP_OFFLINE = "10.99.0.254"; // el mock trata .254 como offline

async function cleanup() {
  await prisma.printer.deleteMany({ where: { ipAddress: { startsWith: IP_PREFIX } } });
}

describe("selectDuePollers (lógica pura)", () => {
  it("marca TODOS los pollers como vencidos si nunca han corrido", () => {
    const due = selectDuePollers(1_000_000, {}, intervals);
    expect(due).toEqual([...POLLER_KINDS]);
  });

  it("no marca ninguno si todos corrieron hace un instante", () => {
    const now = 1_000_000;
    const lastRun = markRan({}, [...POLLER_KINDS], now);
    const due = selectDuePollers(now + 500, lastRun, intervals);
    expect(due).toEqual([]);
  });

  it("vence solo status cuando transcurre su intervalo pero no el de errores", () => {
    const now = 1_000_000;
    const lastRun = markRan({}, [...POLLER_KINDS], now);
    // +1000ms: status (1000) vence; errors (2000) todavía no.
    const due = selectDuePollers(now + 1000, lastRun, intervals);
    expect(due).toContain("status");
    expect(due).not.toContain("errors");
    expect(due).not.toContain("counters");
  });

  it("vence exactamente en el límite del intervalo (>=)", () => {
    const lastRun = { status: 0 };
    expect(selectDuePollers(999, lastRun, intervals)).not.toContain("status");
    expect(selectDuePollers(1000, lastRun, intervals)).toContain("status");
  });

  it("markRan no muta el mapa de entrada", () => {
    const original = { status: 1 };
    const next = markRan(original, ["errors"], 5);
    expect(original).toEqual({ status: 1 });
    expect(next).toEqual({ status: 1, errors: 5 });
  });
});

describe("runPollingCycle (modo mock)", () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("actualiza status/lastSeen/historial de una impresora alcanzable y marca OFFLINE la inalcanzable", async () => {
    // Sembrar dos impresoras ficticias en estado inicial UNKNOWN.
    const online = await prisma.printer.create({
      data: { name: "Test Online", ipAddress: IP_ONLINE, status: "UNKNOWN" },
    });
    const offline = await prisma.printer.create({
      data: { name: "Test Offline", ipAddress: IP_OFFLINE, status: "UNKNOWN" },
    });

    // Ejecutar un ciclo completo, acotado a nuestras IPs ficticias.
    const report = await runPollingCycle(prisma, {
      mock: true,
      where: { ipAddress: { startsWith: IP_PREFIX } },
    });

    expect(report.total).toBe(2);
    expect(report.online).toBe(1);
    expect(report.offline).toBe(1);
    expect(report.failed).toBe(0);

    // Impresora alcanzable: ONLINE, lastSeen fijado, snapshot y contadores escritos.
    const on = await prisma.printer.findUniqueOrThrow({
      where: { id: online.id },
      include: { supplies: true, counters: true, trays: true },
    });
    expect(on.status).toBe("ONLINE");
    expect(on.lastSeen).toBeInstanceOf(Date);
    expect(on.supplies.length).toBeGreaterThan(0);
    expect(on.counters.length).toBeGreaterThan(0);
    expect(on.trays.length).toBeGreaterThan(0);

    const onHistory = await prisma.printerStatusHistory.findMany({
      where: { printerId: online.id },
    });
    expect(onHistory.length).toBe(1);
    expect(onHistory[0]?.status).toBe("ONLINE");

    // Impresora inalcanzable: OFFLINE, sin lastSeen, con fila de historial.
    const off = await prisma.printer.findUniqueOrThrow({ where: { id: offline.id } });
    expect(off.status).toBe("OFFLINE");
    expect(off.lastSeen).toBeNull();

    const offHistory = await prisma.printerStatusHistory.findMany({
      where: { printerId: offline.id },
    });
    expect(offHistory.length).toBe(1);
    expect(offHistory[0]?.status).toBe("OFFLINE");
  });

  it("un segundo ciclo solo-status avanza lastSeen sin duplicar contadores", async () => {
    const before = await prisma.printer.findUniqueOrThrow({ where: { ipAddress: IP_ONLINE } });
    const countersBefore = await prisma.printerCounter.count({
      where: { printerId: before.id },
    });

    // Esperar un instante para que lastSeen sea estrictamente posterior.
    await new Promise((r) => setTimeout(r, 5));

    await runPollingCycle(prisma, {
      mock: true,
      kinds: ["status"],
      where: { ipAddress: IP_ONLINE },
    });

    const after = await prisma.printer.findUniqueOrThrow({ where: { id: before.id } });
    const countersAfter = await prisma.printerCounter.count({
      where: { printerId: before.id },
    });

    expect(after.lastSeen!.getTime()).toBeGreaterThanOrEqual(before.lastSeen!.getTime());
    // El ciclo solo-status NO debe tocar contadores.
    expect(countersAfter).toBe(countersBefore);
    // Y NO duplica el historial: mismo estado (ONLINE) dentro del intervalo de
    // snapshot (1 h por defecto) → shouldRecordStatusHistory no añade otra fila
    // (política anti-bloat de la sección 18). Sigue habiendo 1 punto.
    const history = await prisma.printerStatusHistory.count({ where: { printerId: before.id } });
    expect(history).toBe(1);
  });
});
