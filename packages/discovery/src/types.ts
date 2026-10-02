/**
 * Tipos propios del motor de descubrimiento (@pdm/discovery).
 *
 * Reutilizan el contrato congelado de @pdm/types (Manufacturer, SnmpCredentials,
 * ProbeResult). NO redefinen nada de ese contrato; solo modelan la salida
 * agregada del discovery (secciones 13, 14 y 26 del plan).
 */
import type { Manufacturer } from "@pdm/types";

/**
 * Un dispositivo descubierto tras sondear una IP. Es la proyección "plana"
 * del ProbeResult que pide la sección 26 (dedupe por IP/MAC/serial).
 */
export interface DiscoveredDevice {
  ip: string;
  /** ¿Respondió a SNMP? */
  reachable: boolean;
  /** ¿Se identificó como impresora? */
  isPrinter: boolean;
  manufacturer: Manufacturer;
  model?: string;
  serial?: string;
  mac?: string;
}

/** Conteo de impresoras por fabricante (sección 13). */
export type ManufacturerBreakdown = Partial<Record<Manufacturer, number>>;

/**
 * Resultado agregado de un escaneo, con la forma de la pantalla de resultados
 * de la sección 13:
 *   "47 network devices discovered / 32 printers found / 24 Ricoh ...".
 */
export interface DiscoveryResult {
  /** IPs efectivamente sondeadas (tamaño del rango expandido). */
  scannedIps: number;
  /**
   * Dispositivos que respondieron a SNMP ANTES de deduplicar. Útil para el
   * modo mock, donde toda IP responde con el MISMO fixture (mismo MAC/serial)
   * y por tanto el dedupe las colapsa a un solo dispositivo físico.
   */
  reachableCount: number;
  /** Dispositivos alcanzables y únicos por SNMP (tras dedupe). */
  totalDevices: number;
  /** Impresoras encontradas (tras dedupe). */
  printersFound: number;
  /** Conteo de impresoras por fabricante. */
  byManufacturer: ManufacturerBreakdown;
  /** Lista deduplicada de dispositivos alcanzables. */
  devices: DiscoveredDevice[];
  /** Duración total del escaneo en milisegundos. */
  durationMs: number;
}
