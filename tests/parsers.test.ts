import { describe, it, expect } from "vitest";
import {
  detectManufacturer,
  enterpriseNumberOf,
  supplyPercent,
  classifySupplyColor,
  classifySupplyType,
  ticksToSeconds,
  formatMac,
  looksLikePrinter,
  decodeOctetString,
} from "@pdm/snmp-core";

describe("decodeOctetString", () => {
  it("mantiene ASCII/UTF-8 válido", () => {
    expect(decodeOctetString(Buffer.from("Toner", "utf8"))).toBe("Toner");
    expect(decodeOctetString(Buffer.from("Tóner", "utf8"))).toBe("Tóner");
  });
  it("recupera texto Latin-1 (acentos) que en UTF-8 daría '�'", () => {
    // "Tóner" en Latin-1: ó = 0xF3 (byte alto suelto, inválido en UTF-8).
    expect(decodeOctetString(Buffer.from([0x54, 0xf3, 0x6e, 0x65, 0x72]))).toBe("Tóner");
    expect(decodeOctetString(Buffer.from("Tóner residual", "latin1"))).toBe("Tóner residual");
  });
});

describe("detectManufacturer", () => {
  it("detecta RICOH por sysObjectID (enterprise 367)", () => {
    expect(detectManufacturer("1.3.6.1.4.1.367.1.1")).toBe("RICOH");
  });
  it("detecta HP por enterprise 11", () => {
    expect(detectManufacturer("1.3.6.1.4.1.11.2.3")).toBe("HP");
  });
  it("cae a sysDescr cuando no hay OID conocido", () => {
    expect(detectManufacturer("1.3.6.1.4.1.99999", "Brother HL-L8360")).toBe("BROTHER");
  });
  it("devuelve UNKNOWN sin pistas", () => {
    expect(detectManufacturer(undefined, "Generic device")).toBe("UNKNOWN");
  });
});

describe("enterpriseNumberOf", () => {
  it("extrae el número de empresa", () => {
    expect(enterpriseNumberOf("1.3.6.1.4.1.367.1")).toBe(367);
  });
  it("null si no es rama enterprise", () => {
    expect(enterpriseNumberOf("1.3.6.1.2.1.1.1.0")).toBeNull();
  });
});

describe("supplyPercent", () => {
  it("calcula porcentaje normal", () => {
    expect(supplyPercent(82, 100)).toBe(82);
    expect(supplyPercent(1, 4)).toBe(25);
  });
  it("null en estados especiales negativos", () => {
    expect(supplyPercent(-1, 100)).toBeNull();
    expect(supplyPercent(50, -2)).toBeNull();
  });
  it("acota a 0-100", () => {
    expect(supplyPercent(150, 100)).toBe(100);
  });
});

describe("classifySupplyColor / Type", () => {
  it("clasifica colores", () => {
    expect(classifySupplyColor("Black Toner")).toBe("BLACK");
    expect(classifySupplyColor("Cartucho Amarillo")).toBe("YELLOW");
  });
  it("clasifica tipo por código Printer-MIB", () => {
    expect(classifySupplyType(3)).toBe("TONER");
    expect(classifySupplyType(9)).toBe("DRUM");
    expect(classifySupplyType(0, "Waste box")).toBe("WASTE_TONER");
  });
});

describe("ticksToSeconds", () => {
  it("convierte timeticks a segundos", () => {
    expect(ticksToSeconds(12345678)).toBe(123456);
  });
});

describe("formatMac", () => {
  it("formatea un buffer de 6 bytes", () => {
    expect(formatMac(Buffer.from([0x00, 0x26, 0x73, 0x1a, 0x2b, 0x3c]))).toBe(
      "00:26:73:1A:2B:3C",
    );
  });
  it("normaliza una MAC ya formateada", () => {
    expect(formatMac("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
  });
});

describe("looksLikePrinter", () => {
  it("true si hay Printer-MIB", () => {
    expect(looksLikePrinter(undefined, true)).toBe(true);
  });
  it("true por heurística de sysDescr", () => {
    expect(looksLikePrinter("RICOH IM C4500")).toBe(true);
  });
  it("false para un switch", () => {
    expect(looksLikePrinter("Cisco Catalyst 2960")).toBe(false);
  });
});
