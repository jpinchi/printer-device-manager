import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  deriveDesiredConditions,
  reconcile,
  evaluateAlerts,
} from "./engine.js";
import { evaluateAndPersist, runAlertEvaluationCycle } from "./persistence.js";
import type { PrinterStateSnapshot, ExistingActiveEvent } from "./types.js";

const online = (over: Partial<PrinterStateSnapshot> = {}): PrinterStateSnapshot => ({
  online: "ONLINE",
  conditions: [],
  supplies: [],
  ...over,
});

// --------------------------------------------------------------------------
// Lógica pura
// --------------------------------------------------------------------------
describe("deriveDesiredConditions", () => {
  it("deriva OFFLINE", () => {
    const d = deriveDesiredConditions({ ...online(), online: "OFFLINE" });
    expect(d.map((x) => x.type)).toContain("PRINTER_OFFLINE");
  });

  it("deriva TONER_LOW bajo el umbral y TONER_EMPTY en 0", () => {
    const d = deriveDesiredConditions(
      online({
        supplies: [
          { name: "Black", type: "TONER", color: "BLACK", percent: 10, level: 10 },
          { name: "Cyan", type: "TONER", color: "CYAN", percent: 0, level: 0 },
        ],
      }),
    );
    expect(d.find((x) => x.key === "TONER_LOW:BLACK")).toBeTruthy();
    expect(d.find((x) => x.key === "TONER_EMPTY:CYAN")).toBeTruthy();
  });

  it("deriva TONER_NOTICE (INFO) a la mitad o menos (16–50%)", () => {
    const d = deriveDesiredConditions(
      online({
        supplies: [{ name: "Black", type: "TONER", color: "BLACK", percent: 40, level: 40 }],
      }),
    );
    const n = d.find((x) => x.key === "TONER_NOTICE:BLACK");
    expect(n).toBeTruthy();
    expect(n?.severity).toBe("INFO");
    // Por encima del 50% NO hay aviso.
    const hi = deriveDesiredConditions(
      online({ supplies: [{ name: "Black", type: "TONER", color: "BLACK", percent: 55, level: 55 }] }),
    );
    expect(hi).toHaveLength(0);
  });

  it("no deriva alerta de tóner por encima del umbral", () => {
    const d = deriveDesiredConditions(
      online({ supplies: [{ name: "Black", type: "TONER", color: "BLACK", percent: 80, level: 80 }] }),
    );
    expect(d).toHaveLength(0);
  });

  it("deriva condiciones de dispositivo (atasco/error)", () => {
    const d = deriveDesiredConditions(online({ conditions: ["PAPER_JAM", "ERROR"] }));
    expect(d.map((x) => x.type)).toEqual(
      expect.arrayContaining(["PAPER_JAM", "DEVICE_ERROR"]),
    );
  });
});

describe("reconcile (dedupe / resolución / recuperación)", () => {
  it("no duplica si la condición ya está activa", () => {
    const desired = deriveDesiredConditions({ ...online(), online: "OFFLINE" });
    const active: ExistingActiveEvent[] = [
      { id: "e1", type: "PRINTER_OFFLINE", source: "PRINTER_OFFLINE" },
    ];
    const dec = reconcile(desired, active, { currentOnline: "OFFLINE" });
    expect(dec.toCreate).toHaveLength(0);
  });

  it("resuelve un offline activo y emite BACK_ONLINE al volver", () => {
    const desired = deriveDesiredConditions(online()); // ya no hay offline
    const active: ExistingActiveEvent[] = [
      { id: "e1", type: "PRINTER_OFFLINE", source: "PRINTER_OFFLINE" },
    ];
    const dec = reconcile(desired, active, { currentOnline: "ONLINE" });
    expect(dec.toResolve).toContain("e1");
    expect(dec.toCreate.some((e) => e.type === "PRINTER_BACK_ONLINE")).toBe(true);
  });

  it("el ack en source no rompe el dedupe", () => {
    const desired = deriveDesiredConditions({ ...online(), online: "OFFLINE" });
    const active: ExistingActiveEvent[] = [
      { id: "e1", type: "PRINTER_OFFLINE", source: "PRINTER_OFFLINE#ack=2026-01-01T00:00:00.000Z" },
    ];
    const dec = reconcile(desired, active, { currentOnline: "OFFLINE" });
    expect(dec.toCreate).toHaveLength(0);
  });
});

describe("evaluateAlerts", () => {
  it("crea TONER_LOW cuando corresponde y no hay activos", () => {
    const dec = evaluateAlerts(
      online({ supplies: [{ name: "Black", type: "TONER", color: "BLACK", percent: 5, level: 5 }] }),
      [],
    );
    expect(dec.toCreate.map((e) => e.type)).toContain("TONER_LOW");
  });
});

// --------------------------------------------------------------------------
// Persistencia en BD (IPs de prueba 10.98.0.x, con limpieza)
// --------------------------------------------------------------------------
const prisma = new PrismaClient();
const TEST_IPS = ["10.98.0.1", "10.98.0.2", "10.98.0.3", "10.98.1.1", "10.98.1.2"];

async function cleanup() {
  await prisma.printer.deleteMany({ where: { ipAddress: { in: TEST_IPS } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("evaluateAndPersist (BD)", () => {
  it("crea offline una vez (dedupe) y luego resuelve + BACK_ONLINE", async () => {
    const p = await prisma.printer.create({
      data: { name: "t1", ipAddress: "10.98.0.1", status: "OFFLINE" },
    });

    const r1 = await evaluateAndPersist(prisma, p.id);
    expect(r1.created).toBe(1);

    // Segunda evaluación con el mismo estado: NO duplica.
    const r2 = await evaluateAndPersist(prisma, p.id);
    expect(r2.created).toBe(0);

    const active = await prisma.printerEvent.count({
      where: { printerId: p.id, type: "PRINTER_OFFLINE", resolvedAt: null },
    });
    expect(active).toBe(1);

    // Vuelve ONLINE: resuelve el offline y emite recuperación.
    await prisma.printer.update({ where: { id: p.id }, data: { status: "ONLINE" } });
    const r3 = await evaluateAndPersist(prisma, p.id);
    expect(r3.resolved).toBe(1);

    const back = await prisma.printerEvent.count({
      where: { printerId: p.id, type: "PRINTER_BACK_ONLINE" },
    });
    expect(back).toBe(1);
  });

  it("crea TONER_LOW desde supplies en BD", async () => {
    const p = await prisma.printer.create({
      data: {
        name: "t2",
        ipAddress: "10.98.0.2",
        status: "ONLINE",
        supplies: {
          create: [
            { name: "Black Toner", type: "TONER", color: "BLACK", level: 8, maxCapacity: 100, percent: 8 },
          ],
        },
      },
    });

    const r = await evaluateAndPersist(prisma, p.id);
    expect(r.created).toBe(1);
    const low = await prisma.printerEvent.count({
      where: { printerId: p.id, type: "TONER_LOW", resolvedAt: null },
    });
    expect(low).toBe(1);
  });

  it("TONER_NOTICE nace RESUELTO (no activo) y no se duplica (dedupe 24h)", async () => {
    const p = await prisma.printer.create({
      data: {
        name: "t3",
        ipAddress: "10.98.0.3",
        status: "ONLINE",
        supplies: {
          create: [
            { name: "Black Toner", type: "TONER", color: "BLACK", level: 40, maxCapacity: 100, percent: 40 },
          ],
        },
      },
    });

    const r1 = await evaluateAndPersist(prisma, p.id);
    expect(r1.created).toBe(1);
    // Nace resuelto → NO figura como activo.
    const activeNotice = await prisma.printerEvent.count({
      where: { printerId: p.id, type: "TONER_NOTICE", resolvedAt: null },
    });
    expect(activeNotice).toBe(0);
    const totalNotice = await prisma.printerEvent.count({
      where: { printerId: p.id, type: "TONER_NOTICE" },
    });
    expect(totalNotice).toBe(1);

    // Segunda evaluación con el mismo estado: dedupe 24h → NO re-emite.
    const r2 = await evaluateAndPersist(prisma, p.id);
    expect(r2.created).toBe(0);
    const stillOne = await prisma.printerEvent.count({
      where: { printerId: p.id, type: "TONER_NOTICE" },
    });
    expect(stillOne).toBe(1);
  });
});

describe("runAlertEvaluationCycle (BD, escrituras por lote)", () => {
  it("evalúa varias impresoras a la vez: crea, dedupe y resuelve correctamente", async () => {
    const off = await prisma.printer.create({
      data: { name: "c1", ipAddress: "10.98.1.1", status: "OFFLINE" },
    });
    const low = await prisma.printer.create({
      data: {
        name: "c2",
        ipAddress: "10.98.1.2",
        status: "ONLINE",
        supplies: {
          create: [
            { name: "Black Toner", type: "TONER", color: "BLACK", level: 5, maxCapacity: 100, percent: 5 },
          ],
        },
      },
    });

    // 1ª pasada: una OFFLINE + una TONER_LOW = 2 creados (entre otras impresoras
    // del inventario, por eso comprobamos por-impresora y no el total global).
    await runAlertEvaluationCycle(prisma);
    const offActive = await prisma.printerEvent.count({
      where: { printerId: off.id, type: "PRINTER_OFFLINE", resolvedAt: null },
    });
    const lowActive = await prisma.printerEvent.count({
      where: { printerId: low.id, type: "TONER_LOW", resolvedAt: null },
    });
    expect(offActive).toBe(1);
    expect(lowActive).toBe(1);

    // 2ª pasada con el mismo estado: dedupe → sigue habiendo exactamente 1 de cada.
    await runAlertEvaluationCycle(prisma);
    const offStill = await prisma.printerEvent.count({
      where: { printerId: off.id, type: "PRINTER_OFFLINE", resolvedAt: null },
    });
    expect(offStill).toBe(1);

    // La impresora offline vuelve ONLINE: el lote la resuelve y emite BACK_ONLINE.
    await prisma.printer.update({ where: { id: off.id }, data: { status: "ONLINE" } });
    await runAlertEvaluationCycle(prisma);
    const offResolvedActive = await prisma.printerEvent.count({
      where: { printerId: off.id, type: "PRINTER_OFFLINE", resolvedAt: null },
    });
    const back = await prisma.printerEvent.count({
      where: { printerId: off.id, type: "PRINTER_BACK_ONLINE" },
    });
    expect(offResolvedActive).toBe(0);
    expect(back).toBe(1);
  });
});
