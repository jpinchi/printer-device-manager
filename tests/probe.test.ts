import { describe, it, expect } from "vitest";
import { probe } from "@pdm/snmp-core";

const creds = { version: "v2c" as const, community: "public" };

describe("probe (modo mock)", () => {
  it("descubre la RICOH IM C4500 de fixture end-to-end", async () => {
    const r = await probe("10.0.0.1", creds, { mock: true });

    expect(r.reachable).toBe(true);
    expect(r.isPrinter).toBe(true);
    expect(r.info.manufacturer).toBe("RICOH");
    expect(r.info.model).toContain("C4500");
    expect(r.info.serialNumber).toBe("3120R840012");
    expect(r.info.macAddress).toBe("00:26:73:1A:2B:3C");
    expect(r.info.uptimeSeconds).toBeGreaterThan(0);

    // Consumibles: 4 tóneres con porcentaje
    const black = r.supplies.find((s) => s.color === "BLACK");
    expect(black?.percent).toBe(82);
    expect(r.supplies).toHaveLength(4);

    // Contador total
    expect(r.counters.find((c) => c.type === "TOTAL")?.value).toBe(154332);

    // Bandeja
    expect(r.trays[0]?.name).toBe("Tray 1");
  });

  it("reporta offline cuando no hay respuesta SNMP (.254)", async () => {
    const r = await probe("10.0.0.254", creds, { mock: true });
    expect(r.reachable).toBe(false);
    expect(r.status.online).toBe("OFFLINE");
  });
});
