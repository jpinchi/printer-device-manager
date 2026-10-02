/**
 * Configuración centralizada leída de variables de entorno (sección 22).
 * Nunca hardcodear credenciales.
 */
import type { SnmpVersion } from "@pdm/types";

// Carga .env si está disponible (Node >= 20.12).
try {
  (process as NodeJS.Process & { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  /* .env opcional */
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === "true" || v === "1";
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  snmp: {
    mock: bool(process.env.SNMP_MOCK, false),
    defaultCommunity: process.env.SNMP_DEFAULT_COMMUNITY ?? "public",
    defaultVersion: (process.env.SNMP_DEFAULT_VERSION ?? "v2c") as SnmpVersion,
    timeoutMs: Number(process.env.SNMP_TIMEOUT_MS ?? 3000),
    retries: Number(process.env.SNMP_RETRIES ?? 1),
  },
} as const;

// Validación fail-fast: mejor abortar con un mensaje claro que arrancar con
// una configuración inválida (p. ej. PORT='abc' → NaN silencioso).
function assertConfig(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`⛔ Configuración inválida: ${msg}`);
    process.exit(1);
  }
}
assertConfig(Number.isInteger(config.port) && config.port > 0 && config.port < 65536, `PORT inválido: '${process.env.PORT}'`);
assertConfig(["v1", "v2c", "v3"].includes(config.snmp.defaultVersion), `SNMP_DEFAULT_VERSION inválido: '${config.snmp.defaultVersion}'`);
assertConfig(Number.isFinite(config.snmp.timeoutMs) && config.snmp.timeoutMs > 0, `SNMP_TIMEOUT_MS inválido: '${process.env.SNMP_TIMEOUT_MS}'`);
