/**
 * Cifrado de secretos EN REPOSO (M3 de la auditoría).
 *
 * Algunas credenciales se guardan en disco fuera de la BD cifrada del dominio:
 * la contraseña del hub delegado (`delegation.json`) y la contraseña SMTP de
 * alertas (columna `AppSettings.smtpPassword`). Antes iban en texto plano; aquí
 * se cifran con AES-256-GCM (autenticado: detecta manipulación).
 *
 * Llave maestra (orden de resolución, primero que exista gana):
 *   1. `PDM_SECRET_KEY` (env): passphrase de operaciones; se deriva a 32 bytes
 *      con scrypt. Úsala para compartir la misma llave entre varias máquinas.
 *   2. Archivo `.pdm-secret.key` en PDM_DATA_DIR: 32 bytes aleatorios en base64,
 *      creado automáticamente (modo 0600) la primera vez. Es lo normal en una
 *      instalación single-host (central o Desktop).
 *
 * MIGRACIÓN TRANSPARENTE (sin tocar los archivos existentes):
 *   - `decryptSecret` devuelve el texto plano tal cual si NO tiene el prefijo
 *     `enc.v1.` → los valores viejos siguen funcionando.
 *   - `encryptSecret` siempre produce el formato nuevo → al próximo guardado, el
 *     valor queda cifrado. No hay script de migración ni ventana de corte.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log.js";

const PREFIX = "enc.v1.";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM estándar
// Salt FIJO para derivar la llave desde PDM_SECRET_KEY: no es un secreto; su
// único fin es que scrypt produzca siempre la MISMA llave de 32 bytes a partir
// de la misma passphrase (determinismo), no resistir un diccionario offline.
const SCRYPT_SALT = Buffer.from("pdm-secret-key-v1");

const KEY_FILE = path.join(process.env.PDM_DATA_DIR || process.cwd(), ".pdm-secret.key");

let cachedKey: Buffer | null = null;

/** Resuelve (y cachea) la llave maestra de 32 bytes. Síncrono: se usa raramente. */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const env = process.env.PDM_SECRET_KEY?.trim();
  if (env) {
    cachedKey = crypto.scryptSync(env, SCRYPT_SALT, KEY_LEN);
    return cachedKey;
  }

  try {
    const raw = fs.readFileSync(KEY_FILE, "utf8").trim();
    const buf = Buffer.from(raw, "base64");
    if (buf.length === KEY_LEN) {
      cachedKey = buf;
      return cachedKey;
    }
    log.warn("secrets.keyfile_invalid", { file: KEY_FILE, bytes: buf.length });
  } catch {
    /* no existe aún: se crea abajo */
  }

  const key = crypto.randomBytes(KEY_LEN);
  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, key.toString("base64"), { encoding: "utf8", mode: 0o600 });
    // Refuerza permisos por si el archivo ya existía con un umask laxo.
    try {
      fs.chmodSync(KEY_FILE, 0o600);
    } catch {
      /* chmod no soportado (p.ej. algunos FS de Windows): el ACL del dir protege */
    }
    log.info("secrets.keyfile_created", { file: KEY_FILE });
  } catch (err) {
    log.error("secrets.keyfile_write_failed", {
      file: KEY_FILE,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  cachedKey = key;
  return key;
}

/** ¿El valor ya está cifrado con este esquema? */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Cifra un secreto. Devuelve `enc.v1.<iv>.<tag>.<ct>` (base64url cada parte).
 * Entradas vacías/nulas se devuelven tal cual (nada que cifrar). Idempotente:
 * si ya está cifrado, no lo vuelve a cifrar.
 */
export function encryptSecret(plain: string | null | undefined): string {
  if (plain === null || plain === undefined || plain === "") return plain ?? "";
  if (isEncrypted(plain)) return plain;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    [iv, tag, ct].map((b) => b.toString("base64url")).join(".")
  );
}

/**
 * Descifra un secreto. Si NO lleva el prefijo, se asume texto plano heredado y
 * se devuelve sin cambios (migración transparente). Si el descifrado falla
 * (llave cambiada o dato corrupto), se registra y se devuelve "" para no tumbar
 * el servicio: el admin vuelve a capturar la credencial.
 */
export function decryptSecret(stored: string | null | undefined): string {
  if (stored === null || stored === undefined || stored === "") return "";
  if (!isEncrypted(stored)) return stored; // texto plano heredado
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(".");
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const ct = Buffer.from(ctB64, "base64url");
    const decipher = crypto.createDecipheriv(ALGO, masterKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (err) {
    log.error("secrets.decrypt_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}
