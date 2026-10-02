/**
 * Pruebas unitarias del motor de descubrimiento (Fase 2).
 *
 * Cubren las funciones puras exigidas por el criterio de "hecho":
 *  - parser de rangos IP (CIDR + start/end, validación, límites)
 *  - deduplicación por IP/MAC/serial
 * Y un test del motor de escaneo con probe() inyectado (sin red) + un test
 * end-to-end en modo mock real.
 */
import { describe, it, expect } from "vitest";
import type { ProbeResult, SnmpCredentials } from "@pdm/types";
import {
  expandRange,
  parseCidr,
  ipToLong,
  longToIp,
  isValidIpv4,
  InvalidRangeError,
  dedupeDevices,
  scanRange,
  type DiscoveredDevice,
  type ProbeFn,
} from "./index.js";

const creds: SnmpCredentials = { version: "v2c", community: "public" };

// ---------------------------------------------------------------------------
// Parser de rangos IP
// ---------------------------------------------------------------------------

describe("isValidIpv4", () => {
  it("acepta IPs válidas", () => {
    expect(isValidIpv4("0.0.0.0")).toBe(true);
    expect(isValidIpv4("192.0.2.1")).toBe(true);
    expect(isValidIpv4("255.255.255.255")).toBe(true);
  });

  it("rechaza formatos inválidos", () => {
    expect(isValidIpv4("256.0.0.1")).toBe(false); // octeto > 255
    expect(isValidIpv4("10.0.0")).toBe(false); // faltan octetos
    expect(isValidIpv4("10.0.0.1.5")).toBe(false); // sobran octetos
    expect(isValidIpv4("10.0.0.01")).toBe(false); // cero a la izquierda
    expect(isValidIpv4("10.0.0.-1")).toBe(false);
    expect(isValidIpv4("a.b.c.d")).toBe(false);
    expect(isValidIpv4(" 10.0.0.1 ")).toBe(true); // trim tolerado
  });
});

describe("ipToLong / longToIp", () => {
  it("son inversas entre sí", () => {
    for (const ip of ["0.0.0.0", "192.0.2.1", "192.168.1.254", "255.255.255.255"]) {
      expect(longToIp(ipToLong(ip))).toBe(ip);
    }
  });

  it("ipToLong lanza con IP inválida", () => {
    expect(() => ipToLong("999.0.0.1")).toThrow(InvalidRangeError);
  });
});

describe("parseCidr", () => {
  it("expande /24 a red y broadcast correctos", () => {
    expect(parseCidr("192.0.2.0/24")).toEqual({
      start: "192.0.2.0",
      end: "192.0.2.255",
    });
  });

  it("normaliza una IP no alineada a su red", () => {
    expect(parseCidr("192.0.2.130/24")).toEqual({
      start: "192.0.2.0",
      end: "192.0.2.255",
    });
  });

  it("maneja /32 (una sola IP)", () => {
    expect(parseCidr("10.0.0.5/32")).toEqual({
      start: "10.0.0.5",
      end: "10.0.0.5",
    });
  });

  it("maneja /30 (4 direcciones)", () => {
    expect(parseCidr("10.0.0.4/30")).toEqual({
      start: "10.0.0.4",
      end: "10.0.0.7",
    });
  });

  it("rechaza prefijos y formatos inválidos", () => {
    expect(() => parseCidr("10.0.0.0/33")).toThrow(InvalidRangeError);
    expect(() => parseCidr("10.0.0.0")).toThrow(InvalidRangeError);
  });
});

describe("expandRange", () => {
  it("expande un par start/end inclusive", () => {
    expect(expandRange({ start: "10.0.0.1", end: "10.0.0.3" })).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);
  });

  it("acepta una sola IP como string", () => {
    expect(expandRange("10.0.0.7")).toEqual(["10.0.0.7"]);
  });

  it("acepta notación CIDR", () => {
    expect(expandRange("10.0.0.0/30")).toEqual([
      "10.0.0.0",
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);
  });

  it("cruza fronteras de octeto correctamente", () => {
    expect(expandRange({ start: "10.0.0.254", end: "10.0.1.1" })).toEqual([
      "10.0.0.254",
      "10.0.0.255",
      "10.0.1.0",
      "10.0.1.1",
    ]);
  });

  it("rechaza rango invertido (start > end)", () => {
    expect(() =>
      expandRange({ start: "10.0.0.10", end: "10.0.0.1" }),
    ).toThrow(InvalidRangeError);
  });

  it("rechaza rangos absurdos por encima de maxHosts (sección 23.10)", () => {
    // /8 = 16M hosts, muy por encima del máximo por defecto.
    expect(() => expandRange("10.0.0.0/8")).toThrow(InvalidRangeError);
  });

  it("respeta un maxHosts configurable", () => {
    expect(() =>
      expandRange({ start: "10.0.0.1", end: "10.0.0.10" }, { maxHosts: 5 }),
    ).toThrow(InvalidRangeError);
    expect(
      expandRange({ start: "10.0.0.1", end: "10.0.0.5" }, { maxHosts: 5 }),
    ).toHaveLength(5);
  });

  it("rechaza direcciones reservadas/multicast salvo opt-in (sección 23)", () => {
    expect(() => expandRange({ start: "224.0.0.1", end: "224.0.0.2" })).toThrow(
      InvalidRangeError,
    );
    expect(() => expandRange({ start: "0.0.0.1", end: "0.0.0.2" })).toThrow(
      InvalidRangeError,
    );
    expect(
      expandRange({ start: "224.0.0.1", end: "224.0.0.2" }, { allowReserved: true }),
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Deduplicación
// ---------------------------------------------------------------------------

function dev(partial: Partial<DiscoveredDevice> & { ip: string }): DiscoveredDevice {
  return {
    reachable: true,
    isPrinter: true,
    manufacturer: "RICOH",
    ...partial,
  };
}

describe("dedupeDevices", () => {
  it("elimina duplicados por IP conservando el primero", () => {
    const out = dedupeDevices([
      dev({ ip: "10.0.0.1", model: "A" }),
      dev({ ip: "10.0.0.1", model: "B" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].model).toBe("A");
  });

  it("elimina duplicados por MAC aunque cambie la IP", () => {
    const out = dedupeDevices([
      dev({ ip: "10.0.0.1", mac: "AA:BB:CC:DD:EE:FF" }),
      dev({ ip: "10.0.0.2", mac: "aa-bb-cc-dd-ee-ff" }), // misma MAC, otro formato
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].ip).toBe("10.0.0.1");
  });

  it("elimina duplicados por serial (case/space-insensitive)", () => {
    const out = dedupeDevices([
      dev({ ip: "10.0.0.1", serial: "3120R840012" }),
      dev({ ip: "10.0.0.2", serial: " 3120r840012 " }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("no colapsa dispositivos distintos sin MAC/serial", () => {
    const out = dedupeDevices([
      dev({ ip: "10.0.0.1" }),
      dev({ ip: "10.0.0.2" }),
    ]);
    expect(out).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Motor de escaneo (probe inyectado, sin red)
// ---------------------------------------------------------------------------

/** Fabrica un ProbeResult mínimo para el probe inyectado. */
function fakeResult(ip: string, over: Partial<ProbeResult> = {}): ProbeResult {
  return {
    ip,
    reachable: true,
    isPrinter: true,
    info: { manufacturer: "RICOH", model: "IM C4500", serialNumber: ip, macAddress: ip },
    supplies: [],
    counters: [],
    trays: [],
    status: { online: "ONLINE", conditions: ["READY"] },
    errors: [],
    queriedAt: new Date().toISOString(),
    ...over,
  };
}

describe("scanRange (probe inyectado)", () => {
  it("agrega, cuenta por fabricante y respeta la concurrencia", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const probeFn: ProbeFn = async (ip) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      // .254 offline, .3 es un HP, el resto RICOH.
      if (ip.endsWith(".254")) {
        return fakeResult(ip, { reachable: false, isPrinter: false, info: { manufacturer: "UNKNOWN" } });
      }
      if (ip.endsWith(".3")) {
        return fakeResult(ip, { info: { manufacturer: "HP", serialNumber: ip, macAddress: ip } });
      }
      return fakeResult(ip);
    };

    const result = await scanRange(
      { start: "10.0.0.1", end: "10.0.0.5" },
      { credentials: creds, concurrency: 2, probeFn },
    );

    expect(result.scannedIps).toBe(5);
    // .1 .2 .3 .5 responden; .4 responde (RICOH) también; .254 no está en rango.
    expect(result.reachableCount).toBe(5);
    expect(result.totalDevices).toBe(5); // seriales/mac únicos por IP -> sin colapso
    expect(result.printersFound).toBe(5);
    expect(result.byManufacturer.RICOH).toBe(4);
    expect(result.byManufacturer.HP).toBe(1);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("marca offline las IPs sin respuesta y las excluye del agregado", async () => {
    const probeFn: ProbeFn = async (ip) =>
      fakeResult(ip, ip.endsWith(".254") ? { reachable: false, isPrinter: false } : {});

    const result = await scanRange(
      { start: "10.0.0.253", end: "10.0.0.254" },
      { credentials: creds, concurrency: 4, probeFn },
    );
    expect(result.reachableCount).toBe(1);
    expect(result.devices.every((d) => d.reachable)).toBe(true);
  });

  it("trata un timeout del probe como no alcanzable sin abortar el pool", async () => {
    const probeFn: ProbeFn = async (ip) => {
      if (ip.endsWith(".2")) {
        // Nunca resuelve dentro del timeout.
        await new Promise((r) => setTimeout(r, 1000));
      }
      return fakeResult(ip);
    };

    const result = await scanRange(
      { start: "10.0.0.1", end: "10.0.0.3" },
      { credentials: creds, concurrency: 3, timeoutMs: 30, probeFn },
    );
    // .1 y .3 responden; .2 expira -> no alcanzable.
    expect(result.reachableCount).toBe(2);
  });
});
