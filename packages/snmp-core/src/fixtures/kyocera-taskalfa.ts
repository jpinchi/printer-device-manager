/**
 * Fixture de una Kyocera TASKalfa (respuestas SNMP simuladas) — Fase 8.
 *
 * Mínimo para validar detección (enterprise 1347) y un probe() estándar en
 * modo mock. El OID de firmware es ASUMIDO/PLACEHOLDER (ver oids.ts).
 */
import { KYOCERA } from "../oids.js";

export const kyoceraTaskalfaFixture: Record<string, unknown> = {
  // MIB-II / System
  "1.3.6.1.2.1.1.1.0": "Kyocera TASKalfa 3554ci",
  "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.1347.42", // enterprise 1347 (Kyocera)
  "1.3.6.1.2.1.1.3.0": 410_000_000,
  "1.3.6.1.2.1.1.5.0": "Kyocera-Copyroom",
  "1.3.6.1.2.1.1.6.0": "Copy Room",

  // Printer-MIB: identidad
  "1.3.6.1.2.1.43.5.1.1.16.1": "TASKalfa 3554ci",
  "1.3.6.1.2.1.43.5.1.1.17.1": "R4G1234567",

  // Printer-MIB: contador total
  "1.3.6.1.2.1.43.10.2.1.4.1.1": 521003,

  // hrPrinterStatus (3 = idle)
  "1.3.6.1.2.1.25.3.5.1.1.1": 3,
  "1.3.6.1.2.1.25.3.5.1.2.1": Buffer.from([0x00, 0x00]),

  // MAC
  "1.3.6.1.2.1.2.2.1.6.1": Buffer.from([0x00, 0xc0, 0xee, 0x77, 0x88, 0x99]),

  // Consumible: tóner negro
  "1.3.6.1.2.1.43.11.1.1.6.1.1": "Black Toner TK-8365K",
  "1.3.6.1.2.1.43.11.1.1.5.1.1": 3,
  "1.3.6.1.2.1.43.11.1.1.8.1.1": 100,
  "1.3.6.1.2.1.43.11.1.1.9.1.1": 90,

  // Bandeja
  "1.3.6.1.2.1.43.8.2.1.13.1.1": "Cassette 1",
  "1.3.6.1.2.1.43.8.2.1.9.1.1": 500,
  "1.3.6.1.2.1.43.8.2.1.10.1.1": 480,
  "1.3.6.1.2.1.43.8.2.1.12.1.1": "A4",

  // Firmware Kyocera (privado) — ASUMIDO
  [KYOCERA.firmwareVersion]: "2VG_2000.006.011",
};
