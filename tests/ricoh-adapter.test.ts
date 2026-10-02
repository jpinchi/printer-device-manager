import { describe, it, expect } from "vitest";
import {
  probe,
  SnmpService,
  MockSnmpClient,
  RicohPrinterAdapter,
  OIDS,
} from "@pdm/snmp-core";
import { ricohImC4500Fixture } from "../packages/snmp-core/src/fixtures/ricoh-im-c4500.js";
import { ricohImC4500AdvancedFixture } from "../packages/snmp-core/src/fixtures/ricoh-im-c4500-advanced.js";

const creds = { version: "v2c" as const, community: "public" };

/** SnmpService en modo mock atado a un fixture concreto (inyección de cliente). */
function mockService(
  fixture: Record<string, unknown>,
  host = "10.0.0.1",
): SnmpService {
  const snmp = new SnmpService(host, creds, { mock: true });
  (snmp as unknown as { client: MockSnmpClient }).client = new MockSnmpClient(
    host,
    fixture,
  );
  return snmp;
}

describe("RicohPrinterAdapter — enriquecimiento RICOH (Fase 7)", () => {
  it("probe() añade firmware y contadores por función mapeados por NOMBRE (tabla RICOH)", async () => {
    const r = await probe("10.0.0.1", creds, { mock: true });

    // --- Estándar preservado ---
    expect(r.info.manufacturer).toBe("RICOH");
    expect(r.info.model).toContain("C4500");
    expect(r.info.serialNumber).toBe("3120R840012");
    expect(r.supplies).toHaveLength(4);
    expect(r.supplies.filter((s) => s.type === "TONER")).toHaveLength(4);
    expect(r.supplies.find((s) => s.color === "BLACK")?.percent).toBe(82);

    // --- Firmware ---
    expect(r.info.firmware).toBe("System 1.15 / Engine 2.03");

    // --- Contadores mapeados por nombre desde la tabla RICOH (verificada) ---
    const byType = (t: string) => r.counters.find((c) => c.type === t)?.value;
    expect(byType("TOTAL")).toBe(154332);
    expect(byType("COPIES")).toBe(40000);
    expect(byType("PRINTS")).toBe(100000);
    expect(byType("FAX")).toBe(1290);
    expect(byType("SCANS")).toBe(33456);
    expect(byType("DUPLEX")).toBe(5000);
    // B&W = Copy(15000) + Print(35000) + Fax(1290); Color = Copy(25000) + Print(65000).
    expect(byType("BLACK_WHITE")).toBe(51290);
    expect(byType("COLOR")).toBe(90000);
    // Un único TOTAL (no duplicado por el respaldo).
    expect(r.counters.filter((c) => c.type === "TOTAL")).toHaveLength(1);
  });

  it("getSupplies() añade consumibles avanzados RICOH de forma aditiva", async () => {
    const adapter = new RicohPrinterAdapter();
    const snmp = mockService(ricohImC4500AdvancedFixture);
    const supplies = await adapter.getSupplies(snmp);

    // Los 4 tóneres estándar siguen presentes...
    expect(supplies.filter((s) => s.type === "TONER")).toHaveLength(4);
    // ...y ahora también los consumibles avanzados RICOH.
    const waste = supplies.find((s) => s.type === "WASTE_TONER");
    const drum = supplies.find((s) => s.type === "DRUM");
    const fuser = supplies.find((s) => s.type === "FUSER");
    const kit = supplies.find((s) => s.type === "MAINTENANCE_KIT");

    expect(waste?.percent).toBe(30);
    expect(drum?.percent).toBe(88);
    expect(fuser?.percent).toBe(76);
    expect(kit?.percent).toBe(91);
    expect(supplies).toHaveLength(8);
  });

  it("tolera OIDs privados ausentes: conserva exactamente el resultado estándar", async () => {
    // Fixture SIN ningún OID privado RICOH (firmware/tabla de contadores).
    const bare: Record<string, unknown> = { ...ricohImC4500Fixture };
    delete bare[OIDS.RICOH.firmwareVersion];
    // Quitar toda la tabla de contadores RICOH (columnas .5 y .9 bajo .19.5.1).
    const tableBase = "1.3.6.1.4.1.367.3.2.1.2.19.5.1.";
    for (const k of Object.keys(bare)) if (k.startsWith(tableBase)) delete bare[k];

    const adapter = new RicohPrinterAdapter();

    const info = await adapter.getInfo(mockService(bare));
    expect(info.manufacturer).toBe("RICOH");
    expect(info.firmware).toBeUndefined(); // OID ausente → sin firmware

    const counters = await adapter.getCounters(mockService(bare));
    expect(counters).toHaveLength(1); // solo el TOTAL estándar
    expect(counters[0]).toEqual({ type: "TOTAL", value: 154332 });

    const supplies = await adapter.getSupplies(mockService(bare));
    expect(supplies).toHaveLength(4); // solo los 4 tóneres estándar
  });
});
