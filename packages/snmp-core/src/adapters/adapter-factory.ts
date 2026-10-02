/**
 * Fábrica de adaptadores (sección 11).
 *
 * Selecciona el adaptador correcto según el fabricante detectado. Registrar un
 * fabricante nuevo = añadir una línea aquí. El StandardPrinterAdapter es el
 * fallback obligatorio (sección 32).
 */
import type { Manufacturer } from "@pdm/types";
import type { PrinterAdapter } from "./printer-adapter.js";
import { StandardPrinterAdapter } from "./standard-adapter.js";
import { RicohPrinterAdapter } from "./ricoh-adapter.js";
import { HpPrinterAdapter } from "./hp-adapter.js";
import { CanonPrinterAdapter } from "./canon-adapter.js";
import { BrotherPrinterAdapter } from "./brother-adapter.js";
import { KyoceraPrinterAdapter } from "./kyocera-adapter.js";
import { XeroxPrinterAdapter } from "./xerox-adapter.js";
import { LexmarkPrinterAdapter } from "./lexmark-adapter.js";
import { detectManufacturer } from "../parsers.js";

const registry: Partial<Record<Manufacturer, () => PrinterAdapter>> = {
  RICOH: () => new RicohPrinterAdapter(),
  // Fase 8 — otros fabricantes. Cada uno hereda de StandardPrinterAdapter.
  HP: () => new HpPrinterAdapter(),
  CANON: () => new CanonPrinterAdapter(),
  BROTHER: () => new BrotherPrinterAdapter(),
  KYOCERA: () => new KyoceraPrinterAdapter(),
  XEROX: () => new XeroxPrinterAdapter(),
  LEXMARK: () => new LexmarkPrinterAdapter(),
  // UNKNOWN NO se registra: selectAdapter cae al StandardPrinterAdapter (fallback).
};

export function selectAdapter(manufacturer: Manufacturer): PrinterAdapter {
  const build = registry[manufacturer];
  return build ? build() : new StandardPrinterAdapter();
}

export function selectAdapterFor(sysObjectId?: string, sysDescr?: string): PrinterAdapter {
  return selectAdapter(detectManufacturer(sysObjectId, sysDescr));
}
