/**
 * Logger mínimo estructurado (JSON por línea). Sin dependencias.
 * Sustituible por un logger real (pino/winston) sin cambiar los llamadores.
 */
type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = { ts: new Date().toISOString(), level, event, ...fields };
  const out = level === "error" ? console.error : console.log;
  try {
    out(JSON.stringify(line));
  } catch {
    out(`${line.ts} ${level} ${event}`);
  }
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
