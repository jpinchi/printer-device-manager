/**
 * Fixture de una Canon imageRUNNER (respuestas SNMP simuladas) — Fase 8.
 *
 * Mínimo para validar detección (enterprise 1602) y un probe() estándar en
 * modo mock. El OID de firmware es ASUMIDO/PLACEHOLDER (ver oids.ts).
 */
import { CANON } from "../oids.js";

export const canonImageRunnerFixture: Record<string, unknown> = {
  // MIB-II / System
  "1.3.6.1.2.1.1.1.0": "Canon iR-ADV C5560 /P",
  "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.1602.4.7.1.1", // enterprise 1602 (Canon)
  "1.3.6.1.2.1.1.3.0": 555_123_400,
  "1.3.6.1.2.1.1.5.0": "Canon-Marketing",
  "1.3.6.1.2.1.1.6.0": "Marketing",

  // Printer-MIB: identidad
  "1.3.6.1.2.1.43.5.1.1.16.1": "iR-ADV C5560",
  "1.3.6.1.2.1.43.5.1.1.17.1": "GHK54321",

  // Printer-MIB: contador total
  "1.3.6.1.2.1.43.10.2.1.4.1.1": 302144,

  // hrPrinterStatus (3 = idle)
  "1.3.6.1.2.1.25.3.5.1.1.1": 3,
  "1.3.6.1.2.1.25.3.5.1.2.1": Buffer.from([0x00, 0x00]),

  // MAC
  "1.3.6.1.2.1.2.2.1.6.1": Buffer.from([0x00, 0x1e, 0x8f, 0x11, 0x22, 0x33]),

  // Consumible: tóner negro
  "1.3.6.1.2.1.43.11.1.1.6.1.1": "Black Toner",
  "1.3.6.1.2.1.43.11.1.1.5.1.1": 3,
  "1.3.6.1.2.1.43.11.1.1.8.1.1": 100,
  "1.3.6.1.2.1.43.11.1.1.9.1.1": 68,

  // Bandeja
  "1.3.6.1.2.1.43.8.2.1.13.1.1": "Cassette 1",
  "1.3.6.1.2.1.43.8.2.1.9.1.1": 550,
  "1.3.6.1.2.1.43.8.2.1.10.1.1": 500,
  "1.3.6.1.2.1.43.8.2.1.12.1.1": "A4",

  // Firmware Canon (privado) — ASUMIDO
  [CANON.firmwareVersion]: "Ver. 78.11",
};
