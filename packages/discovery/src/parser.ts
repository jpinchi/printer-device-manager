/**
 * Parser de rangos IP (secciones 13, 14 y 23).
 *
 * Funciones PURAS y testeables: aceptan (start IP + end IP) o notación CIDR,
 * validan cada dirección y expanden a la lista de IPs a sondear.
 *
 * Seguridad (sección 23):
 *  - punto 9:  se validan TODAS las direcciones/rangos.
 *  - punto 10: se rechazan rangos absurdos/no autorizados (límite de hosts)
 *              para no permitir escaneos masivos accidentales.
 */

/** Rango explícito por IP inicial y final (ambas inclusive). */
export interface IpRangeSpec {
  start: string;
  end: string;
}

/** Entrada admitida: CIDR ("10.0.0.0/24") o rango {start, end}. */
export type RangeInput = string | IpRangeSpec;

export interface ExpandRangeOptions {
  /**
   * Máximo de hosts permitidos en un solo rango. Evita escaneos absurdos
   * (sección 23.10). Por defecto 4096 (un /20). Configurable por el llamador.
   */
  maxHosts?: number;
  /**
   * Permitir rangos hacia direcciones reservadas/multicast (0.0.0.0/8,
   * 224.0.0.0/4, 240.0.0.0/4). Por defecto false: se consideran "no
   * autorizadas". El loopback (127.0.0.0/8) SÍ se permite para pruebas locales.
   */
  allowReserved?: boolean;
}

export const DEFAULT_MAX_HOSTS = 4096;

/** Error tipado para problemas de validación de rango (sección 23.9/23.10). */
export class InvalidRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRangeError";
  }
}

/** ¿Es una IPv4 con formato válido (0-255 por octeto, sin ceros/zeros raros)? */
export function isValidIpv4(ip: string): boolean {
  if (typeof ip !== "string") return false;
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    // Solo dígitos, sin signos ni espacios. "01" se rechaza (ambiguo).
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part[0] === "0") return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

/** IPv4 -> entero sin signo de 32 bits. Lanza si la IP no es válida. */
export function ipToLong(ip: string): number {
  if (!isValidIpv4(ip)) {
    throw new InvalidRangeError(`IP inválida: "${ip}"`);
  }
  const [a, b, c, d] = ip.trim().split(".").map(Number);
  // >>> 0 fuerza a entero sin signo de 32 bits.
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** Entero de 32 bits -> IPv4 en notación decimal con puntos. */
export function longToIp(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new InvalidRangeError(`Entero fuera de rango IPv4: ${n}`);
  }
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(
    ".",
  );
}

/**
 * ¿La dirección cae en un bloque reservado/no ruteable que NO autorizamos a
 * escanear salvo opt-in? (0.0.0.0/8, 224.0.0.0/4 multicast, 240.0.0.0/4).
 */
function isReserved(long: number): boolean {
  const firstOctet = (long >>> 24) & 0xff;
  if (firstOctet === 0) return true; // 0.0.0.0/8 "this network"
  if (firstOctet >= 224) return true; // multicast + reservado/experimental
  return false;
}

/** Convierte un CIDR ("10.0.0.0/24") en su {start, end} de red inclusive. */
export function parseCidr(cidr: string): IpRangeSpec {
  const m = cidr.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) {
    throw new InvalidRangeError(`CIDR inválido: "${cidr}"`);
  }
  const [, base, prefixStr] = m;
  const prefix = Number(prefixStr);
  if (prefix < 0 || prefix > 32) {
    throw new InvalidRangeError(`Prefijo CIDR fuera de rango (0-32): /${prefix}`);
  }
  const baseLong = ipToLong(base);
  // Máscara de red. Para /0 la máscara es 0; para /32 es 0xffffffff.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (baseLong & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return { start: longToIp(network), end: longToIp(broadcast) };
}

/** ¿La entrada parece notación CIDR? */
export function isCidr(input: string): boolean {
  return /\//.test(input);
}

/**
 * Expande un rango (CIDR o {start,end}) a la lista de IPs, validando todo.
 *
 * Reglas:
 *  - Todas las IPs deben ser IPv4 válidas (sección 23.9).
 *  - start <= end.
 *  - El total de hosts no puede superar `maxHosts` (sección 23.10).
 *  - Direcciones reservadas/multicast se rechazan salvo `allowReserved`.
 */
export function expandRange(
  input: RangeInput,
  opts: ExpandRangeOptions = {},
): string[] {
  const maxHosts = opts.maxHosts ?? DEFAULT_MAX_HOSTS;
  if (maxHosts <= 0) {
    throw new InvalidRangeError(`maxHosts debe ser positivo: ${maxHosts}`);
  }

  let spec: IpRangeSpec;
  if (typeof input === "string") {
    spec = isCidr(input) ? parseCidr(input) : { start: input, end: input };
  } else {
    spec = input;
  }

  const startLong = ipToLong(spec.start);
  const endLong = ipToLong(spec.end);

  if (startLong > endLong) {
    throw new InvalidRangeError(
      `Rango invertido: la IP inicial (${spec.start}) es mayor que la final (${spec.end}).`,
    );
  }

  const count = endLong - startLong + 1;
  if (count > maxHosts) {
    throw new InvalidRangeError(
      `Rango demasiado grande: ${count} hosts (máximo ${maxHosts}). ` +
        `Reduce el rango o sube maxHosts explícitamente.`,
    );
  }

  if (!opts.allowReserved && (isReserved(startLong) || isReserved(endLong))) {
    throw new InvalidRangeError(
      `Rango no autorizado: incluye direcciones reservadas/multicast ` +
        `(${spec.start} - ${spec.end}). Usa allowReserved para forzarlo.`,
    );
  }

  const ips: string[] = [];
  for (let n = startLong; n <= endLong; n++) {
    ips.push(longToIp(n));
  }
  return ips;
}
