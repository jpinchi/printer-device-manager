/**
 * Registro de acciones administrativas / eventos de auth (sección 23.8).
 *
 * Utilidad simple a consola. REGLA DE SEGURIDAD (sección 23.4): NUNCA se
 * registran contraseñas, hashes ni el secreto de firma. Solo metadatos:
 * evento, usuario, rol, IP y resultado.
 */

export type AuthEvent =
  | "register"
  | "register_blocked"
  | "login_ok"
  | "login_failed"
  | "login_blocked"
  | "auth_denied"
  | "role_denied"
  | "password_changed"
  | "password_reset"
  | "admin_reset_password"
  | "admin_set_recovery";

export interface AuditFields {
  /** username involucrado (si se conoce). */
  username?: string;
  /** userId (si se conoce). */
  userId?: string;
  /** rol involucrado. */
  role?: string;
  /** IP de origen de la petición. */
  ip?: string;
  /** motivo, en fallos (sin datos sensibles). */
  reason?: string;
}

/** Campos que jamás deben registrarse, por si llegan por error. */
const FORBIDDEN_KEYS = new Set(["password", "passwordHash", "hash", "secret", "token"]);

function sanitize(fields: AuditFields): AuditFields {
  const clean: AuditFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (v === undefined || v === null) continue;
    (clean as Record<string, unknown>)[k] = v;
  }
  return clean;
}

/**
 * Emite una línea de auditoría estructurada. Sustituible por un logger real
 * (winston/pino) en una fase posterior sin cambiar los llamadores.
 */
export function auditAuth(event: AuthEvent, fields: AuditFields = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    scope: "auth",
    event,
    ...sanitize(fields),
  };
  console.log(`[audit] ${JSON.stringify(entry)}`);
}
