/**
 * @pdm/discovery — Motor de descubrimiento de red (Fase 2, secciones 13/14/26).
 *
 * API pública. El server (u otros consumidores) importa desde aquí, nunca de
 * rutas internas. Engancha con un futuro `POST /api/discovery/scan` llamando a
 * `scanRange(range, { credentials, concurrency, timeoutMs, mock })`.
 */
export * from "./types.js";
export {
  isValidIpv4,
  ipToLong,
  longToIp,
  parseCidr,
  isCidr,
  expandRange,
  InvalidRangeError,
  DEFAULT_MAX_HOSTS,
  type IpRangeSpec,
  type RangeInput,
  type ExpandRangeOptions,
} from "./parser.js";
export { dedupeDevices } from "./dedupe.js";
export {
  scanRange,
  toDiscoveredDevice,
  DEFAULT_CONCURRENCY,
  DEFAULT_TIMEOUT_MS,
  type ScanOptions,
  type ProbeFn,
} from "./scanner.js";
