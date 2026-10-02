/**
 * Router de gestión de usuarios (sección 24 — Administration).
 *
 * SOLO Administrator (el enforcement de rol lo aplica authz.ts sobre /api/users).
 * Permite listar, crear, cambiar rol/estado y eliminar usuarios. Nunca expone
 * `passwordHash`. Evita que un admin se deje a sí mismo sin acceso.
 */
import { Router } from "express";
import { prisma } from "./db.js";
import { hashPassword, isRole, ROLES } from "./auth/index.js";
import { adminResetPassword, adminSetRecoveryCode, AuthError } from "./auth/service.js";
import { auditAuth } from "./auth/audit.js";

export const usersRouter = Router();

const SAFE_SELECT = {
  id: true,
  username: true,
  role: true,
  active: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
} as const;

// --- Listado ---------------------------------------------------------------
// Expone además `hasRecoveryCode` (booleano derivado) sin filtrar el hash.
usersRouter.get("/", async (_req, res) => {
  const rows = await prisma.user.findMany({
    select: { ...SAFE_SELECT, recoveryCodeHash: true },
    orderBy: { username: "asc" },
  });
  const users = rows.map(({ recoveryCodeHash, ...u }) => ({ ...u, hasRecoveryCode: !!recoveryCodeHash }));
  res.json(users);
});

// --- Creación --------------------------------------------------------------
usersRouter.post("/", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const role = String(req.body?.role ?? "Viewer");

  if (!username || password.length < 8) {
    return res
      .status(400)
      .json({ error: "username requerido y password de al menos 8 caracteres" });
  }
  if (!isRole(role)) {
    return res.status(400).json({ error: `Rol inválido (usa ${ROLES.join("|")})` });
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { username, passwordHash, role, active: true },
      select: SAFE_SELECT,
    });
    res.status(201).json(user);
  } catch {
    res.status(409).json({ error: `El usuario '${username}' ya existe` });
  }
});

// --- Actualización de rol / estado -----------------------------------------
usersRouter.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const selfId = req.auth?.userId;

  const data: { role?: string; active?: boolean } = {};
  if (req.body?.role !== undefined) {
    if (!isRole(req.body.role)) {
      return res.status(400).json({ error: `Rol inválido (usa ${ROLES.join("|")})` });
    }
    data.role = req.body.role;
  }
  if (req.body?.active !== undefined) {
    data.active = Boolean(req.body.active);
  }

  // Salvaguarda: un admin no puede degradarse ni desactivarse a sí mismo
  // (evita quedarse sin ningún administrador activo por error).
  if (id === selfId && (data.role === "Viewer" || data.role === "Technician" || data.active === false)) {
    return res.status(400).json({ error: "No puedes degradarte ni desactivar tu propia cuenta" });
  }

  try {
    const user = await prisma.user.update({ where: { id }, data, select: SAFE_SELECT });
    res.json(user);
  } catch {
    res.status(404).json({ error: "Usuario no encontrado" });
  }
});

// --- Reset de contraseña (admin) -------------------------------------------
// Fija una contraseña temporal (o la indicada) y obliga a cambiarla en el
// próximo login. Devuelve la temporal EN CLARO una sola vez si se generó, para
// que el admin se la comunique al usuario (nunca se registra en logs).
usersRouter.post("/:id/reset-password", async (req, res) => {
  try {
    const { user, tempPassword } = await adminResetPassword({
      userId: req.params.id,
      newPassword: req.body?.newPassword,
    });
    auditAuth("admin_reset_password", { userId: user.id, username: user.username, role: req.auth?.role });
    res.json({ user, tempPassword });
  } catch (err) {
    if (err instanceof AuthError) return res.status(400).json({ error: err.message });
    res.status(404).json({ error: "Usuario no encontrado" });
  }
});

// --- Código de recuperación (admin) ----------------------------------------
usersRouter.post("/:id/recovery-code", async (req, res) => {
  try {
    const user = await adminSetRecoveryCode({ userId: req.params.id, code: req.body?.code });
    auditAuth("admin_set_recovery", { userId: user.id, username: user.username, role: req.auth?.role });
    res.json({ user });
  } catch (err) {
    if (err instanceof AuthError) return res.status(400).json({ error: err.message });
    res.status(404).json({ error: "Usuario no encontrado" });
  }
});

// --- Eliminación -----------------------------------------------------------
usersRouter.delete("/:id", async (req, res) => {
  if (req.params.id === req.auth?.userId) {
    return res.status(400).json({ error: "No puedes eliminar tu propia cuenta" });
  }
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "Usuario no encontrado" });
  }
});
