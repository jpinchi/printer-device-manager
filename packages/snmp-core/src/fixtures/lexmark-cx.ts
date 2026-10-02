/**
 * Fixture de una Lexmark CX (respuestas SNMP simuladas) — Fase 8.
 *
 * Mínimo para validar detección (enterprise 641) y un probe() estándar en modo
 * mock. El OID de firmware es ASUMIDO/PLACEHOLDER (ver oids.ts).
 */
import { LEXMARK } from "../oids.js";

export const lexmarkCxFixture: Record<string, unknown> = {
  // MIB-II / System
  "1.3.6.1.2.1.1.1.0": "Lexmark CX725de",
  "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.641.1.1", // enterprise 641 (Lexmark)
  "1.3.6.1.2.1.1.3.0": 63_000_000,
  "1.3.6.1.2.1.1.5.0": "Lexmark-Sales",
  "1.3.6.1.2.1.1.6.0": "Sales Floor",

  // Printer-MIB: identidad
  "1.3.6.1.2.1.43.5.1.1.16.1": "Lexmark CX725de",
  "1.3.6.1.2.1.43.5.1.1.17.1": "7526541230987",

  // Printer-MIB: contador total
  "1.3.6.1.2.1.43.10.2.1.4.1.1": 231987,

  // hrPrinterStatus (3 = idle)
  "1.3.6.1.2.1.25.3.5.1.1.1": 3,
  "1.3.6.1.2.1.25.3.5.1.2.1": Buffer.from([0x00, 0x00]),

  // MAC
  "1.3.6.1.2.1.2.2.1.6.1": Buffer.from([0x00, 0x20, 0x00, 0xde, 0xef, 0x01]),

  // Consumible: tóner negro
  "1.3.6.1.2.1.43.11.1.1.6.1.1": "Black Cartridge",
  "1.3.6.1.2.1.43.11.1.1.5.1.1": 3,
  "1.3.6.1.2.1.43.11.1.1.8.1.1": 100,
  "1.3.6.1.2.1.43.11.1.1.9.1.1": 22,

  // Bandeja
  "1.3.6.1.2.1.43.8.2.1.13.1.1": "Tray 1",
  "1.3.6.1.2.1.43.8.2.1.9.1.1": 250,
  "1.3.6.1.2.1.43.8.2.1.10.1.1": 90,
  "1.3.6.1.2.1.43.8.2.1.12.1.1": "Letter",

  // Firmware Lexmark (privado) — ASUMIDO
  [LEXMARK.firmwareVersion]: "CXTZJ.081.225",
};
