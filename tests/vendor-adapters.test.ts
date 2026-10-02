import { describe, it, expect } from "vitest";
import {
  probe,
  selectAdapterFor,
  StandardPrinterAdapter,
  HpPrinterAdapter,
  CanonPrinterAdapter,
  BrotherPrinterAdapter,
  KyoceraPrinterAdapter,
  XeroxPrinterAdapter,
  LexmarkPrinterAdapter,
  RicohPrinterAdapter,
} from "@pdm/snmp-core";

const creds = { version: "v2c" as const, community: "public" };

/**
 * (a) Selección de adaptador por sysObjectID (número de empresa) para los 6
 * fabricantes de la Fase 8 + RICOH. Es el camino fiable de detección.
 */
describe("selectAdapterFor — detección por sysObjectID (Fase 8)", () => {
  const cases: Array<{
    name: string;
    sysObjectId: string;
    manufacturer: string;
    ctor: new () => object;
  }> = [
    { name: "HP", sysObjectId: "1.3.6.1.4.1.11.2.3.9.1", manufacturer: "HP", ctor: HpPrinterAdapter },
    { name: "Canon", sysObjectId: "1.3.6.1.4.1.1602.4.7.1.1", manufacturer: "CANON", ctor: CanonPrinterAdapter },
    { name: "Brother", sysObjectId: "1.3.6.1.4.1.2435.2.3.9.1", manufacturer: "BROTHER", ctor: BrotherPrinterAdapter },
    { name: "Kyocera", sysObjectId: "1.3.6.1.4.1.1347.42", manufacturer: "KYOCERA", ctor: KyoceraPrinterAdapter },
    { name: "Xerox", sysObjectId: "1.3.6.1.4.1.253.8.62.1", manufacturer: "XEROX", ctor: XeroxPrinterAdapter },
    { name: "Lexmark", sysObjectId: "1.3.6.1.4.1.641.1.1", manufacturer: "LEXMARK", ctor: LexmarkPrinterAdapter },
    { name: "RICOH", sysObjectId: "1.3.6.1.4.1.367.1.1", manufacturer: "RICOH", ctor: RicohPrinterAdapter },
  ];

  for (const c of cases) {
    it(`selecciona ${c.name} por enterprise`, () => {
      const adapter = selectAdapterFor(c.sysObjectId);
      expect(adapter).toBeInstanceOf(c.ctor);
      expect((adapter as { manufacturer: string }).manufacturer).toBe(c.manufacturer);
    });
  }
});

/**
 * Fallback por texto de sysDescr cuando el sysObjectID no aporta enterprise
 * conocido (mismo patrón que RICOH).
 */
describe("selectAdapterFor — fallback por sysDescr", () => {
  it("detecta HP por texto aunque el sysObjectID sea genérico", () => {
    const adapter = selectAdapterFor("1.3.6.1.4.1.8072.3.2.10", "HP LaserJet M507");
    expect(adapter).toBeInstanceOf(HpPrinterAdapter);
  });

  it("detecta Kyocera por texto", () => {
    const adapter = selectAdapterFor(undefined, "Kyocera TASKalfa 3554ci");
    expect(adapter).toBeInstanceOf(KyoceraPrinterAdapter);
  });
});

/**
 * (b) UNKNOWN → StandardPrinterAdapter como fallback obligatorio (sección 32).
 */
describe("selectAdapterFor — fallback UNKNOWN", () => {
  it("cae a StandardPrinterAdapter con enterprise desconocido y sysDescr no reconocible", () => {
    const adapter = selectAdapterFor("1.3.6.1.4.1.99999.1", "Generic Network Device");
    expect(adapter).toBeInstanceOf(StandardPrinterAdapter);
    expect(adapter.constructor.name).toBe("StandardPrinterAdapter");
    expect((adapter as { manufacturer: string }).manufacturer).toBe("UNKNOWN");
  });

  it("cae a StandardPrinterAdapter sin ninguna pista", () => {
    const adapter = selectAdapterFor();
    expect(adapter).toBeInstanceOf(StandardPrinterAdapter);
  });
});

/**
 * (c) probe() end-to-end en modo mock para fabricantes NO-RICOH usando el
 * registro host→fixture del MockSnmpClient. Valida detección + herencia
 * estándar (identidad, consumible, contador, bandeja) + enriquecimiento
 * tolerante de firmware (OID privado ASUMIDO presente en el fixture).
 */
describe("probe() end-to-end (mock) por fabricante — Fase 8", () => {
  it("HP LaserJet (host 10.0.0.11)", async () => {
    const r = await probe("10.0.0.11", creds, { mock: true });
    expect(r.reachable).toBe(true);
    expect(r.isPrinter).toBe(true);
    expect(r.info.manufacturer).toBe("HP");
    expect(r.info.model).toContain("M507");
    expect(r.info.serialNumber).toBe("PHXYZ12345");
    expect(r.info.firmware).toBe("20240115 04.12.03"); // enriquecimiento tolerante
    expect(r.supplies.find((s) => s.color === "BLACK")?.percent).toBe(47);
    expect(r.counters.find((c) => c.type === "TOTAL")?.value).toBe(45211);
    expect(r.trays[0]?.name).toBe("Tray 2");
  });

  it("Canon imageRUNNER (host 10.0.0.16)", async () => {
    const r = await probe("10.0.0.16", creds, { mock: true });
    expect(r.info.manufacturer).toBe("CANON");
    expect(r.info.serialNumber).toBe("GHK54321");
    expect(r.info.firmware).toBe("Ver. 78.11");
    expect(r.counters.find((c) => c.type === "TOTAL")?.value).toBe(302144);
  });

  it("Brother MFC (host 10.0.0.24)", async () => {
    const r = await probe("10.0.0.24", creds, { mock: true });
    expect(r.info.manufacturer).toBe("BROTHER");
    expect(r.info.serialNumber).toBe("U63812K1N123456");
    expect(r.info.firmware).toBe("1.34");
  });

  it("Kyocera TASKalfa (host 10.0.0.13)", async () => {
    const r = await probe("10.0.0.13", creds, { mock: true });
    expect(r.info.manufacturer).toBe("KYOCERA");
    expect(r.info.serialNumber).toBe("R4G1234567");
    expect(r.info.firmware).toBe("2VG_2000.006.011");
  });

  it("Xerox VersaLink (host 10.0.0.25)", async () => {
    const r = await probe("10.0.0.25", creds, { mock: true });
    expect(r.info.manufacturer).toBe("XEROX");
    expect(r.info.serialNumber).toBe("3948561247");
    expect(r.info.firmware).toBe("073.060.147.07200");
  });

  it("Lexmark CX (host 10.0.0.64)", async () => {
    const r = await probe("10.0.0.64", creds, { mock: true });
    expect(r.info.manufacturer).toBe("LEXMARK");
    expect(r.info.serialNumber).toBe("7526541230987");
    expect(r.info.firmware).toBe("CXTZJ.081.225");
    expect(r.supplies.find((s) => s.color === "BLACK")?.percent).toBe(22);
  });
});

/**
 * Regresión: un host no listado en el registro sigue devolviendo la RICOH por
 * defecto (comportamiento previo preservado), y .254 sigue offline.
 */
describe("MockSnmpClient — comportamiento por defecto preservado", () => {
  it("host por defecto sigue siendo RICOH", async () => {
    const r = await probe("10.0.0.1", creds, { mock: true });
    expect(r.info.manufacturer).toBe("RICOH");
  });

  it(".254 sigue offline", async () => {
    const r = await probe("10.0.0.254", creds, { mock: true });
    expect(r.reachable).toBe(false);
    expect(r.status.online).toBe("OFFLINE");
  });
});
