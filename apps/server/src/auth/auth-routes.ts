/**
 * Router de autenticación (sección 23/24). El ORQUESTADOR lo monta en
 * `/api/auth` (p.ej. `app.use("/api/auth", authRouter)`).
 *
 * Endpoints:
 *   POST /register — crea usuario (hash scrypt). Primer usuario = Administrator.
 *   POST /login    — valida credenciales y devuelve un token firmado.
 *   GET  /me       — devuelve el usuario autenticado (sin passwordHash).
 *
 * NUNCA se registran contraseñas ni el secreto (sección 23.4).
 */
import { Router } from "express";
import {
  registerUser,
  authenticate,
  getUserById,
  mirrorUser,
  changeOwnPassword,
  resetWithRecoveryCode,
  AuthError,
} from "./service.js";
import { isDbUnavailable } from "../http-errors.js";
import { signToken } from "./token.js";
import { requireAuth } from "./middleware.js";
import { auditAuth } from "./audit.js";
import { blockedSeconds, recordFail, clearFails } from "./rate-limit.js";
import {
  centralUrl,
  centralLogin,
  centralChangePassword,
  centralForgotPassword,
  getCentralConfig,
  setCentralUrl,
  FORWARD_HEADER,
} from "./central-auth.js";
import { prisma } from "../db.js";

export const authRouter = Router();

/** Retardo corto para frenar fuerza bruta (los aciertos no se retardan). */
const slowDown = () => new Promise((r) => setTimeout(r, 400));

// GET /setup-needed — público. true si NO hay usuarios todavía (instalación
// limpia): la UI muestra el asistente de "crear administrador". El primer
// usuario registrado se vuelve Administrator (ver service.registerUser).
authRouter.get("/setup-needed", async (_req, res) => {
  try {
    const count = await prisma.user.count();
    res.json({ needed: count === 0 });
  } catch {
    res.json({ needed: false });
  }
});

// GET /server — público. Muestra a qué central/hub valida el login esta
// instalación (para el ajuste "Servidor" de la pantalla de inicio).
authRouter.get("/server", (_req, res) => {
  res.json(getCentralConfig());
});

// PUT /server — cambia la central/hub de esta instalación. Solo se permite
// desde la PROPIA máquina (loopback): así nadie en la red puede redirigir a
// dónde se validan las credenciales. Body: { centralUrl }.
authRouter.put("/server", (req, res) => {
  const ip = req.ip ?? "";
  const isLocal = ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";
  if (!isLocal) {
    return res.status(403).json({ error: "El servidor solo se puede cambiar desde esta máquina." });
  }
  const url = typeof req.body?.centralUrl === "string" ? req.body.centralUrl.trim() : "";
  if (url && !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "La URL debe empezar con http:// o https://" });
  }
  try {
    setCentralUrl(url || null);
    res.json(getCentralConfig());
  } catch {
    res.status(500).json({ error: "No se pudo guardar la configuración del servidor." });
  }
});

/** Mapea AuthError.code a un status HTTP. */
function statusFor(code: AuthError["code"]): number {
  switch (code) {
    case "USERNAME_TAKEN":
      return 409;
    case "INVALID_INPUT":
      return 400;
    case "INVALID_CREDENTIALS":
      return 401;
    case "USER_INACTIVE":
      return 403;
    default:
      return 400;
  }
}

// POST /register — SOLO para crear el primer administrador (bootstrap). Una vez
// existe algún usuario, el registro abierto queda CERRADO: las demás cuentas se
// crean desde Administración → Usuarios (endpoint protegido por Administrator).
authRouter.post("/register", async (req, res, next) => {
  const ip = req.ip ?? "?";
  try {
    // Anti-spam del registro.
    const blk = blockedSeconds(ip, "register");
    if (blk > 0) {
      res.set("Retry-After", String(blk));
      return res.status(429).json({ error: `Demasiados intentos. Espera ${Math.ceil(blk / 60)} min.` });
    }
    // Cerrado si ya hay usuarios (evita auto-registro no autorizado en la red).
    const count = await prisma.user.count();
    if (count > 0) {
      recordFail(ip, "register");
      await slowDown();
      auditAuth("register_blocked", { ip, reason: "closed" });
      return res.status(403).json({ error: "El registro está cerrado. Un administrador debe crear las cuentas." });
    }
    const user = await registerUser({
      username: req.body?.username,
      password: req.body?.password,
    });
    auditAuth("register", { username: user.username, userId: user.id, role: user.role, ip });
    res.status(201).json({ user });
  } catch (err) {
    if (err instanceof AuthError) {
      recordFail(ip, "register");
      return res.status(statusFor(err.code)).json({ error: err.message });
    }
    if (isDbUnavailable(err)) {
      return res.status(503).json({ error: "Servicio no disponible (base de datos)" });
    }
    next(err);
  }
});

// POST /login — con límite de intentos (anti-brute-force): tras varios fallos
// por IP+usuario se bloquea temporalmente (429). Los fallos añaden un retardo.
authRouter.post("/login", async (req, res, next) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const ip = req.ip ?? "?";

  const blk = blockedSeconds(ip, username);
  if (blk > 0) {
    auditAuth("login_blocked", { username, ip, reason: "rate_limited" });
    res.set("Retry-After", String(blk));
    return res.status(429).json({ error: `Demasiados intentos fallidos. Espera ${Math.ceil(blk / 60)} min e inténtalo de nuevo.` });
  }

  // Login de "cuenta única": si hay una central configurada y esta petición no
  // es ya un reenvío, validamos contra la central. Si la central acepta, se
  // refleja la cuenta localmente y se emite un token local. Si la central NO
  // responde, caemos a la validación local (última credencial conocida).
  const forwarded = req.get(FORWARD_HEADER) === "1";
  if (centralUrl() && !forwarded) {
    const r = await centralLogin(username, typeof req.body?.password === "string" ? req.body.password : "");
    if ("ok" in r && r.ok) {
      try {
        const user = await mirrorUser(username, req.body?.password, r.role, r.mustChangePassword);
        clearFails(ip, username);
        const token = signToken({ sub: user.id, role: user.role });
        auditAuth("login_ok", { username: user.username, userId: user.id, role: user.role, ip, reason: "central" });
        return res.json({ token, user });
      } catch (err) {
        if (isDbUnavailable(err)) {
          return res.status(503).json({ error: "Servicio no disponible (base de datos)" });
        }
        return next(err);
      }
    }
    if ("ok" in r && !r.ok) {
      // La central es la fuente de verdad: si rechaza, se rechaza.
      if (r.status === 429) {
        res.set("Retry-After", "300");
        return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." });
      }
      recordFail(ip, username);
      await slowDown();
      auditAuth("login_failed", { username, ip, reason: "central_reject" });
      return res.status(r.status === 403 ? 403 : 401).json({ error: r.status === 403 ? "La cuenta está desactivada" : "Credenciales inválidas" });
    }
    // r.unreachable → continúa a la validación local (resiliencia offline).
  }

  try {
    const user = await authenticate({
      username: req.body?.username,
      password: req.body?.password,
    });
    clearFails(ip, username); // login correcto → reinicia el contador
    const token = signToken({ sub: user.id, role: user.role });
    auditAuth("login_ok", { username: user.username, userId: user.id, role: user.role, ip });
    res.json({ token, user });
  } catch (err) {
    if (err instanceof AuthError) {
      recordFail(ip, username);
      await slowDown();
      // Se audita el fallo SIN la contraseña (solo el username intentado).
      auditAuth("login_failed", { username, ip, reason: err.code });
      return res.status(statusFor(err.code)).json({ error: err.message });
    }
    if (isDbUnavailable(err)) {
      return res.status(503).json({ error: "Servicio no disponible (base de datos)" });
    }
    next(err);
  }
});

// POST /change-password — cambio de contraseña propio. La contraseña ACTUAL es
// la prueba de identidad (no requiere token → es reenviable a la central). Sirve
// también para la pantalla de cambio OBLIGATORIO tras un reset. Puede definir de
// paso el código de recuperación. Body: { username, currentPassword, newPassword, recoveryCode? }.
authRouter.post("/change-password", async (req, res, next) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  const recoveryCode = typeof req.body?.recoveryCode === "string" ? req.body.recoveryCode : "";
  const ip = req.ip ?? "?";

  const blk = blockedSeconds(ip, username);
  if (blk > 0) {
    res.set("Retry-After", String(blk));
    return res.status(429).json({ error: `Demasiados intentos. Espera ${Math.ceil(blk / 60)} min.` });
  }

  const forwarded = req.get(FORWARD_HEADER) === "1";
  if (centralUrl() && !forwarded) {
    const r = await centralChangePassword({ username, currentPassword, newPassword, recoveryCode });
    if ("ok" in r && r.ok) {
      try {
        const user = await mirrorUser(username, newPassword, r.role, false);
        clearFails(ip, username);
        const token = signToken({ sub: user.id, role: user.role });
        auditAuth("password_changed", { username, ip, reason: "central" });
        return res.json({ token, user });
      } catch (err) {
        if (isDbUnavailable(err)) return res.status(503).json({ error: "Servicio no disponible (base de datos)" });
        return next(err);
      }
    }
    if ("ok" in r && !r.ok) {
      recordFail(ip, username);
      await slowDown();
      return res.status(r.status === 403 ? 403 : r.status === 400 ? 400 : 401).json({ error: r.error ?? "No se pudo cambiar la contraseña" });
    }
    // unreachable → validación local (la central es la fuente, pero permitimos
    // el cambio local para no bloquear; se re-sincroniza al volver la central).
  }

  try {
    const user = await changeOwnPassword({ username, currentPassword, newPassword, recoveryCode });
    clearFails(ip, username);
    const token = signToken({ sub: user.id, role: user.role });
    auditAuth("password_changed", { username, ip });
    res.json({ token, user });
  } catch (err) {
    if (err instanceof AuthError) {
      recordFail(ip, username);
      await slowDown();
      return res.status(statusFor(err.code)).json({ error: err.message });
    }
    if (isDbUnavailable(err)) return res.status(503).json({ error: "Servicio no disponible (base de datos)" });
    next(err);
  }
});

// POST /forgot-password — autoservicio "olvidé mi contraseña": valida el CÓDIGO
// DE RECUPERACIÓN y fija una contraseña nueva. Público (no requiere sesión) y
// reenviable a la central. Body: { username, recoveryCode, newPassword }.
authRouter.post("/forgot-password", async (req, res, next) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const recoveryCode = typeof req.body?.recoveryCode === "string" ? req.body.recoveryCode : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  const ip = req.ip ?? "?";

  const blk = blockedSeconds(ip, username);
  if (blk > 0) {
    res.set("Retry-After", String(blk));
    return res.status(429).json({ error: `Demasiados intentos. Espera ${Math.ceil(blk / 60)} min.` });
  }

  const forwarded = req.get(FORWARD_HEADER) === "1";
  if (centralUrl() && !forwarded) {
    const r = await centralForgotPassword({ username, recoveryCode, newPassword });
    if ("ok" in r && r.ok) {
      try {
        const user = await mirrorUser(username, newPassword, r.role, false);
        clearFails(ip, username);
        const token = signToken({ sub: user.id, role: user.role });
        auditAuth("password_reset", { username, ip, reason: "central" });
        return res.json({ token, user });
      } catch (err) {
        if (isDbUnavailable(err)) return res.status(503).json({ error: "Servicio no disponible (base de datos)" });
        return next(err);
      }
    }
    if ("ok" in r && !r.ok) {
      recordFail(ip, username);
      await slowDown();
      return res.status(r.status === 403 ? 403 : r.status === 400 ? 400 : 401).json({ error: r.error ?? "Usuario o código de recuperación inválidos" });
    }
    // unreachable → validación local.
  }

  try {
    const user = await resetWithRecoveryCode({ username, recoveryCode, newPassword });
    clearFails(ip, username);
    const token = signToken({ sub: user.id, role: user.role });
    auditAuth("password_reset", { username, ip });
    res.json({ token, user });
  } catch (err) {
    if (err instanceof AuthError) {
      recordFail(ip, username);
      await slowDown();
      return res.status(statusFor(err.code)).json({ error: err.message });
    }
    if (isDbUnavailable(err)) return res.status(503).json({ error: "Servicio no disponible (base de datos)" });
    next(err);
  }
});

// GET /me — requiere token válido.
authRouter.get("/me", requireAuth, async (req, res) => {
  const ctx = req.auth!; // garantizado por requireAuth
  const user = await getUserById(ctx.userId);
  if (!user) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }
  res.json({ user });
});
