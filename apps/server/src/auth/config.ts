/**
 * Configuración local del módulo de autenticación (secciones 22/23).
 *
 * Se lee de variables de entorno SIN tocar `apps/server/src/config.ts`
 * (fuera de mi dominio de escritura). `SESSION_SECRET` ya existe en
 * `.env.example`; `AUTH_TOKEN_TTL_HOURS` es opcional (default 8 h).
 *
 * Nunca se registra el secreto en logs (sección 23.4).
 */

// Carga .env si está disponible (Node >= 20.12), igual que config.ts.
try {
  (process as NodeJS.Process & { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  /* .env opcional */
}

// Valor de respaldo SOLO para desarrollo; en producción debe venir del entorno.
const DEV_FALLBACK_SECRET = "cambia-esto-en-produccion";

export const authConfig = {
  /** Secreto HMAC para firmar tokens. Nunca exponer ni loguear. */
  sessionSecret: process.env.SESSION_SECRET ?? DEV_FALLBACK_SECRET,
  /** Vida útil del token en horas (default 8). */
  tokenTtlHours: Number(process.env.AUTH_TOKEN_TTL_HOURS ?? 8),
} as const;

/** true si se está usando el secreto de desarrollo (para avisar en el arranque). */
export const usingDevSecret = authConfig.sessionSecret === DEV_FALLBACK_SECRET;
