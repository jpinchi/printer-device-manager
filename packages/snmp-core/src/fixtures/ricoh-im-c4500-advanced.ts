/**
 * Fixture "avanzado" de la RICOH IM C4500.
 *
 * Extiende de forma ADITIVA el fixture base (`ricoh-im-c4500.ts`) añadiendo los
 * OIDs privados RICOH de CONSUMIBLES AVANZADOS (waste toner, drum, fuser,
 * maintenance kit). Se mantiene separado del fixture base a propósito:
 *
 *   - El fixture base es el que consume el resto del sistema y otros agentes
 *     (p.ej. tests/probe.test.ts) esperando exactamente los 4 consumibles
 *     estándar del Printer-MIB.
 *   - Este fixture avanzado ejercita el enriquecimiento RICOH de `getSupplies`
 *     sin alterar ese contrato.
 *
 * Los sufijos privados son ASUMIDOS/PLACEHOLDER (ver oids.ts / docs/ricoh-oids.md).
 * Cada valor es el NIVEL actual normalizado 0-100.
 */
import { ricohImC4500Fixture } from "./ricoh-im-c4500.js";
import { RICOH } from "../oids.js";

export const ricohImC4500AdvancedFixture: Record<string, unknown> = {
  ...ricohImC4500Fixture,

  // Consumibles avanzados RICOH (RICOH.supplies.*) — ASUMIDOS
  [RICOH.supplies.wasteTonerLevel]: 30, // botella de tóner residual
  [RICOH.supplies.drumLevel]: 88, // unidad de tambor
  [RICOH.supplies.fuserLevel]: 76, // unidad de fusión
  [RICOH.supplies.maintenanceKitLevel]: 91, // kit de mantenimiento
};
