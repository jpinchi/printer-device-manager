/**
 * Hashing de contraseñas con `node:crypto` (scrypt) — SIN dependencias externas
 * (sección 23). Formato almacenado en `User.passwordHash`:
 *
 *   scrypt$<saltHex>$<hashHex>
 *
 * Así se verifica sin columnas adicionales en el esquema.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Parámetros de scrypt. N=16384 es el default de Node y un coste razonable
// para una app local. keylen=64 → 512 bits de derivación.
const KEYLEN = 64;
const SALT_BYTES = 16;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const PREFIX = "scrypt";

/** Promisifica scrypt para no bloquear el event loop. */
function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Genera el hash serializado `scrypt$<saltHex>$<hashHex>` para una contraseña. */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("La contraseña no puede estar vacía");
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt);
  return `${PREFIX}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verifica una contraseña contra un hash serializado. Comparación en tiempo
 * constante (timingSafeEqual) para evitar timing attacks. Nunca lanza por
 * contraseña incorrecta: devuelve false.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;

  const [, saltHex, hashHex] = parts;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEYLEN) return false;

  const derived = await scryptAsync(password, salt);
  // Ambos buffers tienen la misma longitud (KEYLEN); timingSafeEqual es seguro.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
