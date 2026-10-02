/**
 * Motor de escaneo SNMP (secciones 13, 14 y 26).
 *
 * Dado un rango + credenciales + concurrencia + timeout, sondea cada IP con
 * probe() de @pdm/snmp-core, con:
 *  - Concurrencia controlada (pool de N simultáneas configurable).
 *  - Timeout por IP configurable (nada de escaneos agresivos, sección 14).
 *  - Deduplicación por IP/MAC/serial (sección 26).
 *  - Resultado agregado con conteo por fabricante (sección 13).
 */
import type { SnmpCredentials, Manufacturer, ProbeResult } from "@pdm/types";
import { probe as defaultProbe } from "@pdm/snmp-core";
import { expandRange, type RangeInput } from "./parser.js";
import { dedupeDevices } from "./dedupe.js";
import type {
  DiscoveredDevice,
  DiscoveryResult,
  ManufacturerBreakdown,
} from "./types.js";

/** Firma de probe() que el scanner consume (inyectable para pruebas). */
export type ProbeFn = (
  ip: string,
  creds: SnmpCredentials,
  opts: { mock?: boolean },
) => Promise<ProbeResult>;

export interface ScanOptions {
  credentials: SnmpCredentials;
  /** Máximo de sondeos SNMP simultáneos. Por defecto 16. */
  concurrency?: number;
  /** Timeout por IP en ms. Por defecto 2000. Sustituye a creds.timeoutMs. */
  timeoutMs?: number;
  /** Modo mock (fixtures) — se propaga a probe(). */
  mock?: boolean;
  /** Máximo de hosts admitidos en el rango (se pasa al parser). */
  maxHosts?: number;
  /** Permitir direcciones reservadas/multicast (se pasa al parser). */
  allowReserved?: boolean;
  /**
   * Deduplicar por IP/MAC/serial (sección 26). Por defecto true. Ponlo en
   * false para inspeccionar el resultado crudo por IP (p. ej. en modo mock).
   */
  dedupe?: boolean;
  /** Callback opcional de progreso (para UI/CLI). */
  onProgress?: (done: number, total: number, device: DiscoveredDevice) => void;
  /** Inyección de probe() para pruebas unitarias. Por defecto el real. */
  probeFn?: ProbeFn;
}

export const DEFAULT_CONCURRENCY = 16;
export const DEFAULT_TIMEOUT_MS = 2000;

/** Proyecta un ProbeResult a la forma plana DiscoveredDevice (sección 26). */
export function toDiscoveredDevice(result: ProbeResult): DiscoveredDevice {
  return {
    ip: result.ip,
    reachable: result.reachable,
    isPrinter: result.isPrinter,
    manufacturer: result.info.manufacturer,
    model: result.info.model,
    serial: result.info.serialNumber,
    mac: result.info.macAddress,
  };
}

/** Envuelve una promesa con un timeout; resuelve `fallback` si expira. */
function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);

    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        // Un fallo del probe se trata como "no alcanzable", no aborta el pool.
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** DiscoveredDevice usado cuando una IP no responde o expira su timeout. */
function unreachable(ip: string): DiscoveredDevice {
  return {
    ip,
    reachable: false,
    isPrinter: false,
    manufacturer: "UNKNOWN",
  };
}

/** Construye el conteo de impresoras por fabricante (sección 13). */
function buildBreakdown(printers: DiscoveredDevice[]): ManufacturerBreakdown {
  const breakdown: ManufacturerBreakdown = {};
  for (const p of printers) {
    const key = p.manufacturer as Manufacturer;
    breakdown[key] = (breakdown[key] ?? 0) + 1;
  }
  return breakdown;
}

/**
 * Sondea un rango completo y devuelve el resultado agregado y deduplicado.
 *
 * El pool de concurrencia se implementa con N "workers" que consumen de un
 * índice compartido: nunca hay más de `concurrency` probes en vuelo.
 */
export async function scanRange(
  range: RangeInput,
  options: ScanOptions,
): Promise<DiscoveryResult> {
  const started = Date.now();
  const probeFn = options.probeFn ?? (defaultProbe as ProbeFn);
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const timeoutMs = options.timeoutMs ?? options.credentials.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // El parser valida y rechaza rangos inválidos/no autorizados (sección 23).
  const ips = expandRange(range, {
    maxHosts: options.maxHosts,
    allowReserved: options.allowReserved,
  });

  // Las credenciales que verá probe() usan el timeout efectivo del escaneo.
  const creds: SnmpCredentials = { ...options.credentials, timeoutMs };

  const results: DiscoveredDevice[] = new Array(ips.length);
  let cursor = 0;
  let done = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= ips.length) return;
      const ip = ips[index];

      const device = await withTimeout(
        probeFn(ip, creds, { mock: options.mock }).then(toDiscoveredDevice),
        timeoutMs,
        unreachable(ip),
      );

      results[index] = device;
      done++;
      options.onProgress?.(done, ips.length, device);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, ips.length) },
    () => runWorker(),
  );
  await Promise.all(workers);

  // Solo interesan los dispositivos alcanzables; luego se deduplican.
  const reachable = results.filter((d) => d.reachable);
  const devices =
    options.dedupe === false ? reachable : dedupeDevices(reachable);
  const printers = devices.filter((d) => d.isPrinter);

  return {
    scannedIps: ips.length,
    reachableCount: reachable.length,
    totalDevices: devices.length,
    printersFound: printers.length,
    byManufacturer: buildBreakdown(printers),
    devices,
    durationMs: Date.now() - started,
  };
}
