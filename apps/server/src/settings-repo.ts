/**
 * Acceso a los ajustes de la aplicación (fila única id="app"). Provee la forma
 * pública (sin exponer la contraseña SMTP) y los umbrales para el motor de
 * alertas.
 */
import { prisma } from "./db.js";
import type { AlertThresholds } from "./alerts/index.js";
import { decryptSecret } from "./secrets.js";

export type AppSettings = Awaited<ReturnType<typeof getSettings>>;

/** Crea la fila de ajustes por defecto si no existe (llamar una vez al arrancar). */
export async function ensureSettings() {
  return prisma.appSettings.upsert({
    where: { id: "app" },
    create: { id: "app" },
    update: {},
  });
}

/**
 * Devuelve los ajustes. LECTURA pura (findUnique) en el camino caliente: se
 * invoca tras cada ciclo de polling y en cada evaluación de alertas, así que NO
 * debe escribir. La fila se crea una sola vez (ensureSettings, al arrancar); si
 * aún no existiera, se crea de forma diferida.
 */
export async function getSettings() {
  const s = await prisma.appSettings.findUnique({ where: { id: "app" } });
  return s ?? ensureSettings();
}

/** Forma pública: enmascara la contraseña SMTP (solo se informa si está puesta). */
export function toPublicSettings(s: Awaited<ReturnType<typeof getSettings>>) {
  const { smtpPassword, ...rest } = s;
  return { ...rest, hasSmtpPassword: !!smtpPassword };
}

/**
 * Contraseña SMTP en CLARO para el mailer. La columna guarda el valor cifrado
 * (o texto plano heredado); esta es la única puerta de descifrado. Devuelve ""
 * si no hay contraseña configurada.
 */
export async function getSmtpPassword(): Promise<string> {
  const s = await getSettings();
  return decryptSecret(s.smtpPassword);
}

/** Umbrales de alerta para el motor, tomados de los ajustes. */
export async function getThresholds(): Promise<AlertThresholds> {
  const s = await getSettings();
  return {
    // Aviso "a la mitad": fijo en 50% (no se guarda en BD).
    tonerNoticePercent: 50,
    tonerLowPercent: s.tonerLowPercent,
    tonerEmptyPercent: s.tonerEmptyPercent,
  };
}
