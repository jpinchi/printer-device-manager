/**
 * @pdm/snmp-core — API pública del paquete.
 *
 * El resto del sistema (server, discovery, polling) importa desde aquí, nunca
 * de rutas internas.
 */
export * from "./probe.js";
export * from "./snmp-service.js";
export * from "./snmp-client.js";
export * from "./mock-client.js";
export * from "./parsers.js";
export * as OIDS from "./oids.js";

export type { PrinterAdapter } from "./adapters/printer-adapter.js";
export { StandardPrinterAdapter } from "./adapters/standard-adapter.js";
export { RicohPrinterAdapter } from "./adapters/ricoh-adapter.js";
// Fase 8 — adaptadores de otros fabricantes.
export { HpPrinterAdapter } from "./adapters/hp-adapter.js";
export { CanonPrinterAdapter } from "./adapters/canon-adapter.js";
export { BrotherPrinterAdapter } from "./adapters/brother-adapter.js";
export { KyoceraPrinterAdapter } from "./adapters/kyocera-adapter.js";
export { XeroxPrinterAdapter } from "./adapters/xerox-adapter.js";
export { LexmarkPrinterAdapter } from "./adapters/lexmark-adapter.js";
export { selectAdapter, selectAdapterFor } from "./adapters/adapter-factory.js";
