/**
 * Fixture de una HP LaserJet (respuestas SNMP simuladas) — Fase 8.
 *
 * Incluye lo mínimo para validar detección (enterprise 11 en sysObjectID) y un
 * probe() estándar en modo mock: identidad, un consumible, un contador, MAC y
 * estado. El OID de firmware es ASUMIDO/PLACEHOLDER (ver oids.ts) y solo sirve
 * para ejercitar el enriquecimiento tolerante del HpPrinterAdapter.
 */
import { HP } from "../oids.js";

export const hpLaserJetFixture: Record<string, unknown> = {
  // MIB-II / System
  "1.3.6.1.2.1.1.1.0": "HP ETHERNET MULTI-ENVIRONMENT / HP LaserJet M507",
  "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.11.2.3.9.1", // enterprise 11 (HP)
  "1.3.6.1.2.1.1.3.0": 987_654_300,
  "1.3.6.1.2.1.1.5.0": "HP-Front-Desk",
  "1.3.6.1.2.1.1.6.0": "Reception",

  // Printer-MIB: identidad
  "1.3.6.1.2.1.43.5.1.1.16.1": "HP LaserJet M507",
  "1.3.6.1.2.1.43.5.1.1.17.1": "PHXYZ12345",

  // Printer-MIB: contador total (prtMarkerLifeCount)
  "1.3.6.1.2.1.43.10.2.1.4.1.1": 45211,

  // hrPrinterStatus (3 = idle/ready)
  "1.3.6.1.2.1.25.3.5.1.1.1": 3,
  "1.3.6.1.2.1.25.3.5.1.2.1": Buffer.from([0x00, 0x00]),

  // ifPhysAddress (MAC)
  "1.3.6.1.2.1.2.2.1.6.1": Buffer.from([0x00, 0x1b, 0x78, 0xaa, 0xbb, 0xcc]),

  // Consumible: cartucho negro (Printer-MIB estándar)
  "1.3.6.1.2.1.43.11.1.1.6.1.1": "Black Cartridge HP 89A",
  "1.3.6.1.2.1.43.11.1.1.5.1.1": 3, // toner
  "1.3.6.1.2.1.43.11.1.1.8.1.1": 100,
  "1.3.6.1.2.1.43.11.1.1.9.1.1": 47,

  // Bandeja de entrada
  "1.3.6.1.2.1.43.8.2.1.13.1.1": "Tray 2",
  "1.3.6.1.2.1.43.8.2.1.9.1.1": 550,
  "1.3.6.1.2.1.43.8.2.1.10.1.1": 410,
  "1.3.6.1.2.1.43.8.2.1.12.1.1": "Letter",

  // Firmware HP (privado) — ASUMIDO
  [HP.firmwareVersion]: "20240115 04.12.03",
};
