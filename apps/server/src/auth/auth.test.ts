/**
 * Pruebas del módulo de autenticación (secciones 23/24).
 *
 * Cubre: hashing scrypt, firma/verificación de token (válido/expirado/manipulado),
 * jerarquía de roles, middleware y el flujo real register→login→me sobre la BD
 * con usuarios ficticios (se siembran y se limpian).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import express from "express";
import { PrismaClient } from "@prisma/client";

import { hashPassword, verifyPassword } from "./password.js";
import { signToken, verifyToken } from "./token.js";
import { roleSatisfies, hasRoleAtLeast, isRole } from "./roles.js";
import { requireAuth, requireRole } from "./middleware.js";
import { authRouter } from "./auth-routes.js";
import {
  changeOwnPassword,
  resetWithRecoveryCode,
  adminResetPassword,
  adminSetRecoveryCode,
} from "./service.js";

const prisma = new PrismaClient();
// Prefijo único para no colisionar con datos reales; se limpia al final.
const PREFIX = `test_auth_${Date.now()}_`;

async function cleanup() {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// --------------------------------------------------------------------------
// Hashing scrypt
// --------------------------------------------------------------------------
describe("password hashing (scrypt)", () => {
  it("hashea con el formato scrypt$salt$hash y verifica la clave correcta", async () => {
    const hash = await hashPassword("S3guro!Pass");
    expect(hash.split("$")).toHaveLength(3);
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("S3guro!Pass", hash)).toBe(true);
  });

  it("rechaza una contraseña incorrecta", async () => {
    const hash = await hashPassword("S3guro!Pass");
    expect(await verifyPassword("otra-clave", hash)).toBe(false);
  });

  it("produce sales distintas para la misma contraseña", async () => {
    const a = await hashPassword("misma");
    const b = await hashPassword("misma");
    expect(a).not.toEqual(b);
  });

  it("no lanza ante un hash malformado", async () => {
    expect(await verifyPassword("x", "no-es-un-hash")).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Tokens JWT-lite (HMAC-SHA256)
// --------------------------------------------------------------------------
describe("token sign/verify", () => {
  it("firma y verifica un token válido con sub/role/exp", () => {
    const token = signToken({ sub: "user-1", role: "Administrator" });
    const result = verifyToken(token);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe("user-1");
      expect(result.payload.role).toBe("Administrator");
      expect(result.payload.exp).toBeGreaterThan(result.payload.iat);
    }
  });

  it("rechaza un token expirado", () => {
    const token = signToken({ sub: "u", role: "Viewer" }, -1); // exp en el pasado
    const result = verifyToken(token);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("expired");
  });

  it("rechaza un token manipulado (firma inválida)", () => {
    const token = signToken({ sub: "u", role: "Viewer" });
    const [h, p, s] = token.split(".");
    // Cambia el payload (rol) sin re-firmar → firma no coincide.
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: "u", role: "Administrator", iat: 1, exp: 9999999999 }),
    ).toString("base64url");
    const tampered = `${h}.${forgedPayload}.${s}`;
    const result = verifyToken(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("bad-signature");
    // Y un token con basura estructural es malformed.
    expect(verifyToken("a.b").valid).toBe(false);
    void p;
  });
});

// --------------------------------------------------------------------------
// Jerarquía de roles
// --------------------------------------------------------------------------
describe("role hierarchy", () => {
  it("Administrator satisface requisitos de Technician y Viewer", () => {
    expect(hasRoleAtLeast("Administrator", "Technician")).toBe(true);
    expect(roleSatisfies("Administrator", ["Technician"])).toBe(true);
    expect(roleSatisfies("Administrator", ["Viewer"])).toBe(true);
  });
  it("Viewer NO satisface Technician ni Administrator", () => {
    expect(roleSatisfies("Viewer", ["Technician"])).toBe(false);
    expect(roleSatisfies("Viewer", ["Administrator"])).toBe(false);
  });
  it("un rol desconocido no cumple nada", () => {
    expect(isRole("Superuser")).toBe(false);
    expect(roleSatisfies("Superuser", ["Viewer"])).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Middleware (con req/res simulados)
// --------------------------------------------------------------------------
describe("requireAuth / requireRole", () => {
  function mockRes() {
    const res: {
      statusCode: number;
      body: unknown;
      status: (c: number) => typeof res;
      json: (b: unknown) => typeof res;
    } = {
      statusCode: 200,
      body: undefined,
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      json(b: unknown) {
        this.body = b;
        return this;
      },
    };
    return res;
  }

  it("401 si falta el header Authorization", () => {
    const res = mockRes();
    let nexted = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireAuth({ headers: {} } as any, res as any, () => {
      nexted = true;
    });
    expect(res.statusCode).toBe(401);
    expect(nexted).toBe(false);
  });

  it("pasa con un Bearer válido y adjunta req.auth", () => {
    const token = signToken({ sub: "abc", role: "Technician" });
    const req = { headers: { authorization: `Bearer ${token}` } } as Record<string, unknown>;
    const res = mockRes();
    let nexted = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireAuth(req as any, res as any, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
    expect((req as { auth?: { role: string } }).auth?.role).toBe("Technician");
  });

  it("requireRole(Administrator) responde 403 a un Viewer", () => {
    const req = { auth: { userId: "u", role: "Viewer" } } as Record<string, unknown>;
    const res = mockRes();
    let nexted = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireRole("Administrator")(req as any, res as any, () => {
      nexted = true;
    });
    expect(res.statusCode).toBe(403);
    expect(nexted).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Flujo end-to-end: register → login → me (BD real, usuarios ficticios)
// --------------------------------------------------------------------------
describe("flujo register → login → me", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);

  let baseUrl = "";
  let server: ReturnType<typeof app.listen>;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });
  afterAll(() => {
    server.close();
  });

  it("login y /me: aceptan credenciales válidas y no exponen passwordHash", async () => {
    const username = `${PREFIX}user`;
    const password = "Contrasena-Segura-1";
    // El registro abierto está CERRADO tras el primer admin (blindaje), así que
    // el usuario de prueba se crea directamente en la BD (no por /register).
    const created = await prisma.user.create({
      data: { username, passwordHash: await hashPassword(password), role: "Administrator" },
    });
    try {
      expect(isRole(created.role)).toBe(true);

      // login
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      expect(login.status).toBe(200);
      const loginBody = (await login.json()) as { token: string; user: { id: string } };
      expect(typeof loginBody.token).toBe("string");
      expect(loginBody.user.id).toBe(created.id);

      // login con clave incorrecta → 401
      const bad = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: "incorrecta" }),
      });
      expect(bad.status).toBe(401);

      // me con token
      const me = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${loginBody.token}` },
      });
      expect(me.status).toBe(200);
      const meBody = (await me.json()) as { user: { id: string; username: string } };
      expect(meBody.user.id).toBe(created.id);
      expect(meBody.user.username).toBe(username);
      expect(meBody.user).not.toHaveProperty("passwordHash");

      // me sin token → 401
      const meNoAuth = await fetch(`${baseUrl}/api/auth/me`);
      expect(meNoAuth.status).toBe(401);
    } finally {
      await prisma.user.deleteMany({ where: { username } });
    }
  });

  it("el registro abierto está CERRADO cuando ya existen usuarios (403)", async () => {
    // Sembramos un usuario para garantizar count > 0 sin depender del estado de la BD.
    const seed = `${PREFIX}seed`;
    await prisma.user.create({
      data: { username: seed, passwordHash: await hashPassword("Contrasena-Segura-1"), role: "Viewer" },
    });
    try {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: `${PREFIX}dup`, password: "Contrasena-Segura-1" }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(String(body.error)).toMatch(/cerrad/i);
    } finally {
      await prisma.user.deleteMany({ where: { username: seed } });
    }
  });
});

// --------------------------------------------------------------------------
// Recuperación / cambio de contraseña (servicios, sobre la BD)
// --------------------------------------------------------------------------
describe("recuperación y cambio de contraseña", () => {
  async function seed(suffix: string, password: string) {
    return prisma.user.create({
      data: {
        username: `${PREFIX}${suffix}`,
        passwordHash: await hashPassword(password),
        role: "Technician",
      },
    });
  }

  it("changeOwnPassword: rechaza clave actual incorrecta y acepta la correcta", async () => {
    const u = await seed("chg", "Original-123");
    await expect(
      changeOwnPassword({ username: u.username, currentPassword: "mala", newPassword: "NuevaClave-1" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    const safe = await changeOwnPassword({
      username: u.username,
      currentPassword: "Original-123",
      newPassword: "NuevaClave-1",
    });
    expect(safe.mustChangePassword).toBe(false);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(await verifyPassword("NuevaClave-1", after!.passwordHash)).toBe(true);
  });

  it("changeOwnPassword: valida longitud mínima de la nueva contraseña", async () => {
    const u = await seed("chgshort", "Original-123");
    await expect(
      changeOwnPassword({ username: u.username, currentPassword: "Original-123", newPassword: "corta" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("adminResetPassword: fija temporal, exige cambio y la temporal funciona", async () => {
    const u = await seed("rst", "Vieja-123");
    const { user, tempPassword } = await adminResetPassword({ userId: u.id });
    expect(user.mustChangePassword).toBe(true);
    expect(typeof tempPassword).toBe("string");
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(await verifyPassword(tempPassword!, after!.passwordHash)).toBe(true);
    // La clave vieja ya no vale.
    expect(await verifyPassword("Vieja-123", after!.passwordHash)).toBe(false);
  });

  it("código de recuperación: sin código no se puede; con el código correcto se restablece", async () => {
    const u = await seed("rec", "Clave-123");
    // Aún sin código configurado → inválido (mismo error anti-enumeración).
    await expect(
      resetWithRecoveryCode({ username: u.username, recoveryCode: "loquesea", newPassword: "OtraClave-1" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    await adminSetRecoveryCode({ userId: u.id, code: "mi-codigo-secreto" });

    // Código equivocado → inválido.
    await expect(
      resetWithRecoveryCode({ username: u.username, recoveryCode: "incorrecto", newPassword: "OtraClave-1" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    // Código correcto → restablece y limpia mustChangePassword.
    const safe = await resetWithRecoveryCode({
      username: u.username,
      recoveryCode: "mi-codigo-secreto",
      newPassword: "OtraClave-1",
    });
    expect(safe.mustChangePassword).toBe(false);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(await verifyPassword("OtraClave-1", after!.passwordHash)).toBe(true);
  });
});
