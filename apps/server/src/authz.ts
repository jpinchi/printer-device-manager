/**
 * Política de autorización centralizada (secciones 23-24).
 *
 * Un único middleware que, cuando el enforcement está activo (AUTH_ENFORCE),
 * aplica autenticación + roles a TODA la API según una tabla de reglas, sin
 * tener que decorar cada ruta ni editar los routers de cada dominio.
 *
 * - `/api/health` y `/api/auth/*` son públicos.
 * - El resto exige token válido (Viewer como mínimo).
 * - Operaciones sensibles exigen un rol superior (jerarquía de la sección 24:
 *   Administrator > Technician > Viewer).
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyToken, hasRoleAtLeast, type Role } from "./auth/index.js";

interface Rule {
  method: string;
  test: RegExp;
  role: Role;
}

/**
 * Reglas de rol mínimo por método + ruta. Se evalúa la PRIMERA que coincida.
 * `method: "*"` coincide con cualquier método HTTP.
 */
const RULES: Rule[] = [
  { method: "*", test: /^\/api\/users/, role: "Administrator" }, // gestión de usuarios
  { method: "POST", test: /^\/api\/printers\/?$/, role: "Administrator" },
  { method: "DELETE", test: /^\/api\/printers\/[^/]+\/?$/, role: "Administrator" },
  { method: "PATCH", test: /^\/api\/printers\/[^/]+\/?$/, role: "Technician" }, // asignar ubicación
  { method: "POST", test: /^\/api\/printers\/poll-all\/?$/, role: "Technician" },
  { method: "POST", test: /^\/api\/printers\/[^/]+\/poll\/?$/, role: "Technician" },
  { method: "POST", test: /^\/api\/discovery\/scan\/?$/, role: "Administrator" },
  { method: "GET", test: /^\/api\/discovery\//, role: "Technician" },
  { method: "POST", test: /^\/api\/snmp\/test\/?$/, role: "Technician" }, // prueba de conectividad
  { method: "POST", test: /^\/api\/network\/ip-scan\/?$/, role: "Technician" }, // escáner de IPs
  { method: "POST", test: /^\/api\/network\/snmp-write-probe\/?$/, role: "Technician" }, // sonda SNMP-write
  { method: "POST", test: /^\/api\/network\/assign-ip\/?$/, role: "Administrator" }, // escribir IP (config de red)
  { method: "*", test: /^\/api\/remote-install\//, role: "Administrator" }, // instalación remota + delegación (hub)
  // Drivers: instalar en el host y toda escritura del catálogo → Administrator.
  { method: "POST", test: /^\/api\/drivers\/[^/]+\/install\/?$/, role: "Administrator" },
  { method: "POST", test: /^\/api\/drivers/, role: "Administrator" },
  { method: "PATCH", test: /^\/api\/drivers/, role: "Administrator" },
  { method: "DELETE", test: /^\/api\/drivers/, role: "Administrator" },
  { method: "PATCH", test: /^\/api\/settings/, role: "Administrator" }, // ajustes de la app
  { method: "POST", test: /^\/api\/model-images/, role: "Administrator" }, // fotos por modelo
  { method: "DELETE", test: /^\/api\/model-images/, role: "Administrator" },
  { method: "POST", test: /^\/api\/locations\/?$/, role: "Administrator" },
  { method: "DELETE", test: /^\/api\/locations\/[^/]+\/?$/, role: "Administrator" },
  { method: "POST", test: /^\/api\/workunits\/?$/, role: "Administrator" },
  { method: "DELETE", test: /^\/api\/workunits\/[^/]+\/?$/, role: "Administrator" },
  { method: "*", test: /^\/api\/import\//, role: "Administrator" }, // importar datos de la central
  { method: "*", test: /^\/api\/sync\//, role: "Administrator" }, // sincronización Desktop ↔ hub
  { method: "POST", test: /^\/api\/alerts\//, role: "Technician" }, // ack/resolve
];

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}

export const authorize: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const p = req.path;

  // Solo se gobierna la API; los assets estáticos pasan.
  if (!p.startsWith("/api/")) return next();
  // Públicos: salud, autenticación y las fotos por modelo (solo GET; se usan en
  // <img> que no puede enviar cabecera de auth; son fotos de producto no
  // sensibles). La escritura de model-images sí exige rol (reglas abajo).
  if (p === "/api/health" || p.startsWith("/api/auth/")) return next();
  // Versión/auto-update del hub: la pantalla de login (sin sesión) los consulta.
  if (p.startsWith("/api/hub/")) return next();
  if (req.method === "GET" && p.startsWith("/api/model-images")) return next();
  // La descarga de la app de escritorio se ofrece en la pantalla de login (sin auth).
  if (req.method === "GET" && p.startsWith("/api/desktop")) return next();

  // Autenticación obligatoria.
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: "Falta el token de autenticación" });
    return;
  }
  const result = verifyToken(token);
  if (!result.valid) {
    res.status(401).json({ error: "Token inválido o expirado" });
    return;
  }
  req.auth = { userId: result.payload.sub, role: result.payload.role };

  // Autorización por rol: la primera regla que coincida; si ninguna, Viewer.
  const rule = RULES.find(
    (r) => (r.method === "*" || r.method === req.method) && r.test.test(p),
  );
  const required: Role = rule ? rule.role : "Viewer";
  if (!hasRoleAtLeast(req.auth.role, required)) {
    res.status(403).json({ error: `Permisos insuficientes (requiere ${required})` });
    return;
  }

  next();
};
