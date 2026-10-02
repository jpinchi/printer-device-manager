/**
 * Lógica de negocio de autenticación: creación de usuarios, validación de
 * credenciales y proyección segura del usuario (sin `passwordHash`).
 *
 * Usa el cliente Prisma compartido (`db.ts`) y el modelo `User` existente
 * (contrato congelado — no se añaden columnas).
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { hashPassword, verifyPassword } from "./password.js";
import { isRole, type Role } from "./roles.js";

/** Usuario expuesto al cliente: nunca incluye passwordHash ni recoveryCodeHash. */
export interface SafeUser {
  id: string;
  username: string;
  role: string;
  active: boolean;
  /** true = debe cambiar la contraseña en el próximo login (tras un reset). */
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Errores de negocio con código estable para mapear a HTTP en el router. */
export class AuthError extends Error {
  constructor(
    public code:
      | "USERNAME_TAKEN"
      | "INVALID_INPUT"
      | "INVALID_CREDENTIALS"
      | "USER_INACTIVE",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Proyecta un registro de usuario a su forma segura (descarta hashes). */
export function toSafeUser(user: {
  id: string;
  username: string;
  role: string;
  active: boolean;
  mustChangePassword?: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SafeUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword ?? false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Regla del primer usuario (bootstrap): si NO existe ningún usuario, el que se
 * registra se vuelve Administrator; el resto son Viewer por defecto. La creación
 * de roles elevados posteriores es tarea de un endpoint de administración
 * protegido por requireRole("Administrator") — no del registro abierto.
 */
export async function registerUser(input: {
  username?: unknown;
  password?: unknown;
}): Promise<SafeUser> {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (username.length < 3) {
    throw new AuthError("INVALID_INPUT", "El usuario debe tener al menos 3 caracteres");
  }
  if (password.length < 8) {
    throw new AuthError("INVALID_INPUT", "La contraseña debe tener al menos 8 caracteres");
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw new AuthError("USERNAME_TAKEN", "El nombre de usuario ya está en uso");
  }

  const userCount = await prisma.user.count();
  const role: Role = userCount === 0 ? "Administrator" : "Viewer";

  const passwordHash = await hashPassword(password);
  const created = await prisma.user.create({
    data: { username, passwordHash, role },
  });
  return toSafeUser(created);
}

/** Resultado de validar credenciales: el usuario seguro si son correctas. */
export async function authenticate(input: {
  username?: unknown;
  password?: unknown;
}): Promise<SafeUser> {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!username || !password) {
    throw new AuthError("INVALID_CREDENTIALS", "Credenciales inválidas");
  }

  const user = await prisma.user.findUnique({ where: { username } });
  // Mismo error para "no existe" y "clave mala" (evita enumeración de usuarios).
  if (!user) {
    // Se verifica igualmente contra un hash ficticio para nivelar el tiempo.
    await verifyPassword(password, "scrypt$00$00");
    throw new AuthError("INVALID_CREDENTIALS", "Credenciales inválidas");
  }
  if (!user.active) {
    throw new AuthError("USER_INACTIVE", "La cuenta está desactivada");
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw new AuthError("INVALID_CREDENTIALS", "Credenciales inválidas");
  }
  return toSafeUser(user);
}

/**
 * Refleja localmente una cuenta que YA validó la central (login de "cuenta
 * única"): crea o actualiza el usuario local con la misma credencial (hash
 * scrypt) y rol. Así los tokens y la autorización locales funcionan, y si más
 * tarde la central no está accesible, el usuario aún puede entrar con la última
 * credencial conocida (resiliencia offline). No devuelve nunca el passwordHash.
 */
export async function mirrorUser(
  usernameRaw: unknown,
  passwordRaw: unknown,
  roleRaw: unknown,
  mustChangePassword = false,
): Promise<SafeUser> {
  const username = typeof usernameRaw === "string" ? usernameRaw.trim() : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  if (!username || !password) {
    throw new AuthError("INVALID_CREDENTIALS", "Credenciales inválidas");
  }
  const role: Role = isRole(roleRaw) ? roleRaw : "Viewer";
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, role, active: true, mustChangePassword },
    create: { username, passwordHash, role, mustChangePassword },
  });
  return toSafeUser(user);
}

/** Recupera un usuario seguro por id (para GET /me). null si no existe. */
export async function getUserById(id: string): Promise<SafeUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toSafeUser(user) : null;
}

// ---------------------------------------------------------------------------
// Recuperación / cambio de contraseña
// ---------------------------------------------------------------------------

/** Longitud mínima común para contraseñas y códigos de recuperación. */
const MIN_SECRET = 8;

/**
 * Cambio de contraseña propio: valida la contraseña ACTUAL como prueba de
 * identidad (así funciona sin token, reenviable a la central) y fija la nueva.
 * Opcionalmente define/actualiza el código de recuperación en el mismo paso.
 * Limpia `mustChangePassword` (sirve también para la pantalla de cambio forzado).
 */
export async function changeOwnPassword(input: {
  username?: unknown;
  currentPassword?: unknown;
  newPassword?: unknown;
  recoveryCode?: unknown;
}): Promise<SafeUser> {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
  const next = typeof input.newPassword === "string" ? input.newPassword : "";
  const recovery = typeof input.recoveryCode === "string" ? input.recoveryCode.trim() : "";

  if (next.length < MIN_SECRET) {
    throw new AuthError("INVALID_INPUT", `La nueva contraseña debe tener al menos ${MIN_SECRET} caracteres`);
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    await verifyPassword(current, "scrypt$00$00"); // nivela el tiempo
    throw new AuthError("INVALID_CREDENTIALS", "Credenciales inválidas");
  }
  if (!user.active) throw new AuthError("USER_INACTIVE", "La cuenta está desactivada");
  if (!(await verifyPassword(current, user.passwordHash))) {
    throw new AuthError("INVALID_CREDENTIALS", "La contraseña actual no es correcta");
  }

  const data: { passwordHash: string; mustChangePassword: boolean; recoveryCodeHash?: string } = {
    passwordHash: await hashPassword(next),
    mustChangePassword: false,
  };
  if (recovery) {
    if (recovery.length < MIN_SECRET) {
      throw new AuthError("INVALID_INPUT", `El código de recuperación debe tener al menos ${MIN_SECRET} caracteres`);
    }
    data.recoveryCodeHash = await hashPassword(recovery);
  }
  const updated = await prisma.user.update({ where: { id: user.id }, data });
  return toSafeUser(updated);
}

/**
 * Autoservicio "olvidé mi contraseña": valida el CÓDIGO DE RECUPERACIÓN (mismo
 * tratamiento anti-enumeración y tiempo constante que el login) y fija una
 * contraseña nueva. Requiere que el usuario tenga un código configurado.
 */
export async function resetWithRecoveryCode(input: {
  username?: unknown;
  recoveryCode?: unknown;
  newPassword?: unknown;
}): Promise<SafeUser> {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const code = typeof input.recoveryCode === "string" ? input.recoveryCode.trim() : "";
  const next = typeof input.newPassword === "string" ? input.newPassword : "";

  if (next.length < MIN_SECRET) {
    throw new AuthError("INVALID_INPUT", `La nueva contraseña debe tener al menos ${MIN_SECRET} caracteres`);
  }
  const user = await prisma.user.findUnique({ where: { username } });
  // Mismo error para "no existe", "sin código" y "código malo" (anti-enumeración).
  if (!user || !user.recoveryCodeHash) {
    await verifyPassword(code, "scrypt$00$00");
    throw new AuthError("INVALID_CREDENTIALS", "Usuario o código de recuperación inválidos");
  }
  if (!user.active) throw new AuthError("USER_INACTIVE", "La cuenta está desactivada");
  if (!(await verifyPassword(code, user.recoveryCodeHash))) {
    throw new AuthError("INVALID_CREDENTIALS", "Usuario o código de recuperación inválidos");
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), mustChangePassword: false },
  });
  return toSafeUser(updated);
}

/**
 * Reset por un administrador: fija una contraseña (o una temporal generada) y
 * MARCA la cuenta para cambio obligatorio en el próximo login. Devuelve el
 * usuario seguro y, si se generó una temporal, su valor en claro (una sola vez,
 * para que el admin se la comunique al usuario). Nunca la registra en logs.
 */
export async function adminResetPassword(input: {
  userId: string;
  newPassword?: unknown;
}): Promise<{ user: SafeUser; tempPassword?: string }> {
  const provided = typeof input.newPassword === "string" ? input.newPassword : "";
  if (provided && provided.length < MIN_SECRET) {
    throw new AuthError("INVALID_INPUT", `La contraseña debe tener al menos ${MIN_SECRET} caracteres`);
  }
  const tempPassword = provided || generateTempPassword();
  const user = await prisma.user.update({
    where: { id: input.userId },
    data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true },
  });
  return { user: toSafeUser(user), tempPassword: provided ? undefined : tempPassword };
}

/** Define/actualiza (admin) el código de recuperación de una cuenta. */
export async function adminSetRecoveryCode(input: {
  userId: string;
  code?: unknown;
}): Promise<SafeUser> {
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (code.length < MIN_SECRET) {
    throw new AuthError("INVALID_INPUT", `El código de recuperación debe tener al menos ${MIN_SECRET} caracteres`);
  }
  const user = await prisma.user.update({
    where: { id: input.userId },
    data: { recoveryCodeHash: await hashPassword(code) },
  });
  return toSafeUser(user);
}

/** Contraseña temporal legible (sin caracteres ambiguos) para el reset admin. */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Re-export por conveniencia del router.
export { isRole };
