/**
 * Fixture de una Xerox VersaLink (respuestas SNMP simuladas) — Fase 8.
 *
 * Mínimo para validar detección (enterprise 253) y un probe() estándar en modo
 * mock. El OID de firmware es ASUMIDO/PLACEHOLDER (ver oids.ts).
 */
import { XEROX } from "../oids.js";

export const xeroxVersaLinkFixture: Record<string, unknown> = {
  // MIB-II / System
  "1.3.6.1.2.1.1.1.0": "Xerox VersaLink C405; SS 073.060.147.07200",
  "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.253.8.62.1.25.1", // enterprise 253 (Xerox)
  "1.3.6.1.2.1.1.3.0": 88_000_000,
  "1.3.6.1.2.1.1.5.0": "Xerox-HR",
  "1.3.6.1.2.1.1.6.0": "HR Office",

  // Printer-MIB: identidad
  "1.3.6.1.2.1.43.5.1.1.16.1": "VersaLink C405",
  "1.3.6.1.2.1.43.5.1.1.17.1": "3948561247",

  // Printer-MIB: contador total
  "1.3.6.1.2.1.43.10.2.1.4.1.1": 76650,

  // hrPrinterStatus (3 = idle)
  "1.3.6.1.2.1.25.3.5.1.1.1": 3,
  "1.3.6.1.2.1.25.3.5.1.2.1": Buffer.from([0x00, 0x00]),

  // MAC
  "1.3.6.1.2.1.2.2.1.6.1": Buffer.from([0x00, 0x00, 0xaa, 0xab, 0xac, 0xad]),

  // Consumible: tóner negro
  "1.3.6.1.2.1.43.11.1.1.6.1.1": "Black Toner Cartridge",
  "1.3.6.1.2.1.43.11.1.1.5.1.1": 3,
  "1.3.6.1.2.1.43.11.1.1.8.1.1": 100,
  "1.3.6.1.2.1.43.11.1.1.9.1.1": 55,

  // Bandeja
  "1.3.6.1.2.1.43.8.2.1.13.1.1": "Tray 1",
  "1.3.6.1.2.1.43.8.2.1.9.1.1": 550,
  "1.3.6.1.2.1.43.8.2.1.10.1.1": 200,
  "1.3.6.1.2.1.43.8.2.1.12.1.1": "Letter",

  // Firmware Xerox (privado) — ASUMIDO
  [XEROX.firmwareVersion]: "073.060.147.07200",
};
