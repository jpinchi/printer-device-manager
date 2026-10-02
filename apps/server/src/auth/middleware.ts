/**
 * Middleware de autorización (secciones 23/24).
 *
 * - `requireAuth`: valida el token del header `Authorization: Bearer <token>`
 *   y adjunta `req.auth = { userId, role }`.
 * - `requireRole(...roles)`: exige que el usuario autenticado cumpla, según la
 *   jerarquía de roles, al menos el menor de los roles indicados.
 *
 * EXPORTADOS para que el ORQUESTADOR los aplique a las rutas existentes; este
 * módulo NO edita otros routers.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyToken } from "./token.js";
import { roleSatisfies, type Role } from "./roles.js";
import { auditAuth } from "./audit.js";

/** Contexto de autenticación adjuntado a la request. */
export interface AuthContext {
  userId: string;
  role: string;
}

// Aumenta el tipo Request de Express con `auth` (opcional hasta requireAuth).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Extrae el token del header Authorization: Bearer <token>. */
function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}

/** Valida el token y adjunta req.auth; 401 si falta o es inválido/expirado. */
export const requireAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = bearerToken(req);
  if (!token) {
    auditAuth("auth_denied", { ip: req.ip, reason: "missing_token" });
    res.status(401).json({ error: "Falta el token de autenticación" });
    return;
  }
  const result = verifyToken(token);
  if (!result.valid) {
    auditAuth("auth_denied", { ip: req.ip, reason: result.reason });
    res.status(401).json({ error: "Token inválido o expirado" });
    return;
  }
  req.auth = { userId: result.payload.sub, role: result.payload.role };
  next();
};

/**
 * Exige un rol mínimo. Debe montarse DESPUÉS de requireAuth. Respeta la
 * jerarquía: requireRole("Technician") también admite Administrator.
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = req.auth;
    if (!ctx) {
      // Programación defensiva: requireAuth no se montó antes.
      res.status(401).json({ error: "No autenticado" });
      return;
    }
    if (!roleSatisfies(ctx.role, roles)) {
      auditAuth("role_denied", {
        userId: ctx.userId,
        role: ctx.role,
        ip: req.ip,
        reason: `requiere ${roles.join("|")}`,
      });
      res.status(403).json({ error: "Permisos insuficientes" });
      return;
    }
    next();
  };
}
