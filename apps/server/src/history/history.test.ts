/**
 * Pruebas del módulo de Historial y reportes (Fase 6, secciones 18/30).
 *
 * - Agregación por hora/día: lógica PURA, sin BD ni reloj real.
 * - Generación/escapado de CSV: lógica PURA.
 * - `runRetention`: prueba de integración sobre impresoras ficticias con IPs
 *   10.97.0.x sembradas con timestamps antiguos controlados. Verifica que borra
 *   lo viejo y conserva lo reciente, y LIMPIA todo al final. Nunca corre
 *   retención global contra la BD real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db.js";
import {
  summarizeStatusHistory,
  summarizeCounterHistory,
  bucketKey,
  type StatusHistoryRow,
  type CounterHistoryRow,
} from "./aggregation.js";
import {
  csvEscapeField,
  toCsv,
  statusHistoryToCsv,
  counterHistoryToCsv,
} from "./csv.js";
import { runRetention, type RetentionPolicy } from "./retention.js";

// ---------------------------------------------------------------------------
// Agregación (pura)
// ---------------------------------------------------------------------------
describe("agregación de historial (pura)", () => {
  it("bucketKey trunca a la hora y al día en UTC", () => {
    const d = new Date("2026-08-24T13:47:32.500Z");
    expect(bucketKey(d, "hour")).toBe("2026-08-24T13:00:00.000Z");
    expect(bucketKey(d, "day")).toBe("2026-08-24T00:00:00.000Z");
  });

  it("resume el estado por hora: disponibilidad y promedio de tóner", () => {
    const rows: StatusHistoryRow[] = [
      row("2026-08-24T10:05:00Z", "ONLINE", 50, 100),
      row("2026-08-24T10:35:00Z", "OFFLINE", 40, 100),
      row("2026-08-24T11:05:00Z", "ONLINE", 30, 120),
    ];
    const byHour = summarizeStatusHistory(rows, "hour");
    expect(byHour).toHaveLength(2);

    const h10 = byHour[0]!;
    expect(h10.bucket).toBe("2026-08-24T10:00:00.000Z");
    expect(h10.samples).toBe(2);
    expect(h10.onlineCount).toBe(1);
    expect(h10.offlineCount).toBe(1);
    expect(h10.uptimeRatio).toBe(0.5);
    expect(h10.avgTonerBlack).toBe(45); // (50+40)/2
    expect(h10.maxTotalPages).toBe(100);

    const h11 = byHour[1]!;
    expect(h11.bucket).toBe("2026-08-24T11:00:00.000Z");
    expect(h11.uptimeRatio).toBe(1);
    expect(h11.maxTotalPages).toBe(120);
  });

  it("resume el estado por día agrupando todas las horas", () => {
    const rows: StatusHistoryRow[] = [
      row("2026-08-24T10:05:00Z", "ONLINE", 50, 100),
      row("2026-08-24T23:59:00Z", "ONLINE", 30, 150),
    ];
    const byDay = summarizeStatusHistory(rows, "day");
    expect(byDay).toHaveLength(1);
    expect(byDay[0]!.bucket).toBe("2026-08-24T00:00:00.000Z");
    expect(byDay[0]!.samples).toBe(2);
    expect(byDay[0]!.maxTotalPages).toBe(150);
  });

  it("promedia ignorando nulos y devuelve null si no hay datos", () => {
    const rows: StatusHistoryRow[] = [
      { timestamp: new Date("2026-08-24T10:00:00Z"), status: "ONLINE", tonerBlack: null, tonerCyan: null, tonerMagenta: null, tonerYellow: null, totalPages: null },
      { timestamp: new Date("2026-08-24T10:30:00Z"), status: "ONLINE", tonerBlack: 20, tonerCyan: null, tonerMagenta: null, tonerYellow: null, totalPages: null },
    ];
    const [s] = summarizeStatusHistory(rows, "hour");
    expect(s!.avgTonerBlack).toBe(20); // solo cuenta el valor no nulo
    expect(s!.avgTonerCyan).toBeNull();
    expect(s!.maxTotalPages).toBeNull();
  });

  it("resume contadores por tipo y calcula el delta (crecimiento)", () => {
    const rows: CounterHistoryRow[] = [
      counter("2026-08-24T10:05:00Z", "TOTAL", 1000),
      counter("2026-08-24T10:45:00Z", "TOTAL", 1050),
      counter("2026-08-24T10:20:00Z", "COLOR", 200),
    ];
    const byHour = summarizeCounterHistory(rows, "hour");
    expect(byHour).toHaveLength(2); // TOTAL y COLOR por separado

    const total = byHour.find((s) => s.counterType === "TOTAL")!;
    expect(total.minValue).toBe(1000);
    expect(total.maxValue).toBe(1050);
    expect(total.lastValue).toBe(1050);
    expect(total.delta).toBe(50);

    const color = byHour.find((s) => s.counterType === "COLOR")!;
    expect(color.delta).toBe(0); // una sola muestra
  });
});

// ---------------------------------------------------------------------------
// CSV (puro)
// ---------------------------------------------------------------------------
describe("generación de CSV (pura)", () => {
  it("escapa comas, comillas y saltos de línea (RFC 4180)", () => {
    expect(csvEscapeField("simple")).toBe("simple");
    expect(csvEscapeField("a,b")).toBe('"a,b"');
    expect(csvEscapeField('di"jo')).toBe('"di""jo"');
    expect(csvEscapeField("línea1\nlínea2")).toBe('"línea1\nlínea2"');
    expect(csvEscapeField(null)).toBe("");
    expect(csvEscapeField(undefined)).toBe("");
    expect(csvEscapeField(42)).toBe("42");
  });

  it("construye un documento CSV con cabeceras y filas (CRLF)", () => {
    const csv = toCsv(["a", "b"], [
      [1, "x"],
      [2, "y,z"],
    ]);
    expect(csv).toBe('a,b\r\n1,x\r\n2,"y,z"');
  });

  it("serializa historial de estado con fechas en ISO", () => {
    const csv = statusHistoryToCsv([
      { timestamp: new Date("2026-08-24T10:00:00Z"), status: "ONLINE", tonerBlack: 50, tonerCyan: null, tonerMagenta: null, tonerYellow: null, totalPages: 1000 },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("timestamp,status,tonerBlack,tonerCyan,tonerMagenta,tonerYellow,totalPages");
    expect(lines[1]).toBe("2026-08-24T10:00:00.000Z,ONLINE,50,,,,1000");
  });

  it("serializa historial de contadores", () => {
    const csv = counterHistoryToCsv([
      { collectedAt: new Date("2026-08-24T10:00:00Z"), counterType: "TOTAL", value: 1234 },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("collectedAt,counterType,value");
    expect(lines[1]).toBe("2026-08-24T10:00:00.000Z,TOTAL,1234");
  });
});

// ---------------------------------------------------------------------------
// Retención (integración sobre impresoras ficticias 10.97.0.x)
// ---------------------------------------------------------------------------
const IP_PREFIX = "10.97.0.";
const DAY_MS = 24 * 60 * 60 * 1000;

async function cleanup() {
  // Cascade borra historial/eventos/contadores asociados.
  await prisma.printer.deleteMany({ where: { ipAddress: { startsWith: IP_PREFIX } } });
}

describe("runRetention (integración, impresoras 10.97.0.x)", () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("borra filas antiguas y conserva las recientes, solo del scope indicado", async () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const old = new Date(now.getTime() - 40 * DAY_MS); // 40 días → fuera de 30
    const recent = new Date(now.getTime() - 5 * DAY_MS); // 5 días → dentro de 30

    // Impresora bajo prueba.
    const printer = await prisma.printer.create({
      data: { name: "Retention Test", ipAddress: `${IP_PREFIX}10`, status: "ONLINE" },
    });
    // Impresora de control (mismo prefijo) que NO va en el scope: no debe tocarse.
    const control = await prisma.printer.create({
      data: { name: "Control", ipAddress: `${IP_PREFIX}20`, status: "ONLINE" },
    });

    // Historial de estado: uno viejo, uno reciente, en cada impresora.
    await prisma.printerStatusHistory.createMany({
      data: [
        { printerId: printer.id, status: "ONLINE", timestamp: old },
        { printerId: printer.id, status: "ONLINE", timestamp: recent },
        { printerId: control.id, status: "ONLINE", timestamp: old },
      ],
    });
    // Eventos ERROR: uno viejo (fuera de 180d), uno reciente.
    await prisma.printerEvent.createMany({
      data: [
        { printerId: printer.id, severity: "ERROR", type: "JAM", message: "old", createdAt: new Date(now.getTime() - 200 * DAY_MS) },
        { printerId: printer.id, severity: "ERROR", type: "JAM", message: "recent", createdAt: recent },
      ],
    });
    // Contadores viejos: con counterDays=null NO deben borrarse.
    await prisma.printerCounter.create({
      data: { printerId: printer.id, counterType: "TOTAL", value: 1, collectedAt: old },
    });

    const policy: RetentionPolicy = {
      rawStatusDays: 30,
      eventDays: 180,
      counterDays: null, // conservar contadores
    };

    const result = await runRetention(prisma, policy, {
      now,
      printerIds: [printer.id], // scope acotado: no toca la de control
    });

    expect(result.statusHistoryDeleted).toBe(1); // solo el viejo de `printer`
    expect(result.eventsDeleted).toBe(1); // solo el evento de 200 días
    expect(result.countersDeleted).toBe(0); // contadores conservados

    // La impresora bajo prueba: queda solo lo reciente.
    const statusLeft = await prisma.printerStatusHistory.count({ where: { printerId: printer.id } });
    expect(statusLeft).toBe(1);
    const eventsLeft = await prisma.printerEvent.count({ where: { printerId: printer.id } });
    expect(eventsLeft).toBe(1);
    const countersLeft = await prisma.printerCounter.count({ where: { printerId: printer.id } });
    expect(countersLeft).toBe(1);

    // La impresora de control (fuera del scope) queda intacta.
    const controlLeft = await prisma.printerStatusHistory.count({ where: { printerId: control.id } });
    expect(controlLeft).toBe(1);
  });
});

// --- helpers de construcción de filas ---
function row(ts: string, status: string, tonerBlack: number, totalPages: number): StatusHistoryRow {
  return {
    timestamp: new Date(ts),
    status,
    tonerBlack,
    tonerCyan: null,
    tonerMagenta: null,
    tonerYellow: null,
    totalPages,
  };
}

function counter(ts: string, counterType: string, value: number): CounterHistoryRow {
  return { collectedAt: new Date(ts), counterType, value };
}
