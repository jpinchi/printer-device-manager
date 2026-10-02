/**
 * Fixture de una Brother MFC (respuestas SNMP simuladas) — Fase 8.
 *
 * Mínimo para validar detección (enterprise 2435) y un probe() estándar en
 * modo mock. El OID de firmware es ASUMIDO/PLACEHOLDER (ver oids.ts).
 */
import { BROTHER } from "../oids.js";

export const brotherMfcFixture: Record<string, unknown> = {
  // MIB-II / System
  "1.3.6.1.2.1.1.1.0": "Brother MFC-L8900CDW series",
  "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.2435.2.3.9.1", // enterprise 2435 (Brother)
  "1.3.6.1.2.1.1.3.0": 120_450_000,
  "1.3.6.1.2.1.1.5.0": "Brother-Legal",
  "1.3.6.1.2.1.1.6.0": "Legal Dept",

  // Printer-MIB: identidad
  "1.3.6.1.2.1.43.5.1.1.16.1": "Brother MFC-L8900CDW",
  "1.3.6.1.2.1.43.5.1.1.17.1": "U63812K1N123456",

  // Printer-MIB: contador total
  "1.3.6.1.2.1.43.10.2.1.4.1.1": 18922,

  // hrPrinterStatus (3 = idle)
  "1.3.6.1.2.1.25.3.5.1.1.1": 3,
  "1.3.6.1.2.1.25.3.5.1.2.1": Buffer.from([0x00, 0x00]),

  // MAC
  "1.3.6.1.2.1.2.2.1.6.1": Buffer.from([0x30, 0x05, 0x5c, 0x44, 0x55, 0x66]),

  // Consumible: tóner negro
  "1.3.6.1.2.1.43.11.1.1.6.1.1": "Black Toner Cartridge",
  "1.3.6.1.2.1.43.11.1.1.5.1.1": 3,
  "1.3.6.1.2.1.43.11.1.1.8.1.1": 100,
  "1.3.6.1.2.1.43.11.1.1.9.1.1": 34,

  // Bandeja
  "1.3.6.1.2.1.43.8.2.1.13.1.1": "Tray 1",
  "1.3.6.1.2.1.43.8.2.1.9.1.1": 250,
  "1.3.6.1.2.1.43.8.2.1.10.1.1": 130,
  "1.3.6.1.2.1.43.8.2.1.12.1.1": "A4",

  // Firmware Brother (privado) — ASUMIDO
  [BROTHER.firmwareVersion]: "1.34",
};
