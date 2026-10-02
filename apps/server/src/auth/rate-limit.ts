/**
 * Limitador de intentos en memoria (anti-brute-force / anti-spam) para el login
 * y el registro. Sin dependencias externas. Pensado para una sola instancia (el
 * servidor de la app).
 *
 * Dos dimensiones de defensa:
 *  1. Por IP+usuario: frena la fuerza bruta contra UNA cuenta concreta. Como el
 *     bloqueo es por IP (no por cuenta), un atacante NO puede dejar fuera a un
 *     usuario legítimo — se bloquea la IP atacante, no la víctima.
 *  2. Por IP (global, todas las cuentas): frena el "password spraying" y la
 *     enumeración de usuarios (una IP que rota nombres de usuario). Sin esto, la
 *     dimensión (1) sola dejaría intentos casi ilimitados repartidos por usuario.
 *
 * Se limpia solo (barrido periódico) y tiene un tope de memoria (MAX_BUCKETS)
 * para que un atacante que rote IP+usuario no pueda hacerla crecer sin límite.
 */
interface Bucket {
  fails: number;
  first: number;
  blockedUntil: number;
}

// Por IP+usuario (fuerza bruta contra una cuenta).
const MAX_FAILS = 6; // fallos permitidos en la ventana antes de bloquear
const WINDOW_MS = 15 * 60_000; // ventana de conteo (15 min)
const BLOCK_MS = 15 * 60_000; // duración del bloqueo (15 min)

// Por IP (global, todas las cuentas): más alto para no molestar el uso legítimo
// de varias cuentas tras una misma IP, pero atajar el spraying/enumeración.
const IP_MAX_FAILS = 20;
const IP_WINDOW_MS = 15 * 60_000;
const IP_BLOCK_MS = 15 * 60_000;

// Tope de memoria: evita que rotar IP+usuario haga crecer el mapa sin fin. Al
// superarlo se descartan las entradas más antiguas (las más cercanas a expirar).
const MAX_BUCKETS = 20_000;

const buckets = new Map<string, Bucket>(); // IP+usuario
const ipBuckets = new Map<string, Bucket>(); // IP global

const key = (ip: string, id: string): string => `${ip}::${id.toLowerCase()}`;

/** Descarta las entradas más antiguas si el mapa supera el tope de memoria. */
function capMap(map: Map<string, Bucket>): void {
  if (map.size <= MAX_BUCKETS) return;
  const excess = map.size - MAX_BUCKETS;
  // Los Map iteran en orden de inserción → las primeras son las más antiguas.
  let i = 0;
  for (const k of map.keys()) {
    map.delete(k);
    if (++i >= excess) break;
  }
}

/** Segundos restantes de bloqueo de un bucket concreto (0 si no aplica). */
function remaining(map: Map<string, Bucket>, k: string, windowMs: number): number {
  const b = map.get(k);
  if (!b) return 0;
  const now = Date.now();
  if (b.blockedUntil > now) return Math.ceil((b.blockedUntil - now) / 1000);
  if (now - b.first > windowMs) map.delete(k);
  return 0;
}

/**
 * Segundos restantes de bloqueo (0 si no está bloqueado). Devuelve el MAYOR de
 * los dos bloqueos aplicables: el de IP+usuario y el global de la IP.
 */
export function blockedSeconds(ip: string, id: string): number {
  const perUser = remaining(buckets, key(ip, id), WINDOW_MS);
  const perIp = remaining(ipBuckets, ip, IP_WINDOW_MS);
  return Math.max(perUser, perIp);
}

/** Suma un fallo a un bucket y lo bloquea si supera el umbral. */
function bump(map: Map<string, Bucket>, k: string, windowMs: number, maxFails: number, blockMs: number): void {
  const now = Date.now();
  const b = map.get(k);
  if (!b || now - b.first > windowMs) {
    map.set(k, { fails: 1, first: now, blockedUntil: 0 });
    capMap(map);
    return;
  }
  b.fails += 1;
  if (b.fails >= maxFails) b.blockedUntil = now + blockMs;
}

/** Registra un intento fallido (cuenta en ambas dimensiones). */
export function recordFail(ip: string, id: string): void {
  bump(buckets, key(ip, id), WINDOW_MS, MAX_FAILS, BLOCK_MS);
  bump(ipBuckets, ip, IP_WINDOW_MS, IP_MAX_FAILS, IP_BLOCK_MS);
}

/**
 * Limpia el contador de IP+usuario tras un intento exitoso. NO borra el contador
 * global de la IP a propósito: si no, un atacante podría intercalar un login
 * válido para reiniciar el freno de spraying. El global decae solo por ventana.
 */
export function clearFails(ip: string, id: string): void {
  buckets.delete(key(ip, id));
}

// Limpieza periódica para evitar fuga de memoria.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.blockedUntil < now && now - b.first > WINDOW_MS) buckets.delete(k);
  }
  for (const [k, b] of ipBuckets) {
    if (b.blockedUntil < now && now - b.first > IP_WINDOW_MS) ipBuckets.delete(k);
  }
}, 5 * 60_000);
sweep.unref?.();

/** Solo para tests: reinicia el estado en memoria. */
export function __resetRateLimit(): void {
  buckets.clear();
  ipBuckets.clear();
}
