/**
 * Punto de entrada del módulo de autenticación (secciones 23/24).
 *
 * El ORQUESTADOR importa desde aquí para:
 *   - montar el router:      app.use("/api/auth", authRouter)
 *   - proteger rutas:        app.use("/api/discovery", requireAuth, requireRole("Administrator"), ...)
 */
export { authRouter } from "./auth-routes.js";
export { requireAuth, requireRole, type AuthContext } from "./middleware.js";
export { signToken, verifyToken, type TokenPayload, type TokenClaims } from "./token.js";
export { hashPassword, verifyPassword } from "./password.js";
export {
  ROLES,
  type Role,
  isRole,
  hasRoleAtLeast,
  roleSatisfies,
} from "./roles.js";
export {
  registerUser,
  authenticate,
  getUserById,
  toSafeUser,
  AuthError,
  type SafeUser,
} from "./service.js";
export { auditAuth, type AuthEvent } from "./audit.js";
export { authConfig, usingDevSecret } from "./config.js";
