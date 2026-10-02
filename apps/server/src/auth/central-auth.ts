/**
 * Login de "cuenta única" (delegación a la central).
 *
 * Cuando un servidor (típicamente la app de escritorio) tiene configurada
 * `PDM_CENTRAL_URL`, las credenciales de login se validan contra la CENTRAL
 * en vez de solo contra la base local. Así una misma cuenta funciona en todas
 * las máquinas de la flota. Tras un login exitoso, la credencial se refleja
 * localmente (ver service.mirrorUser) para permitir entrar aunque la central
 * quede inaccesible más tarde.
 *
 * La CENTRAL no define `PDM_CENTRAL_URL` → sigue siendo la fuente de verdad y
 * valida contra su propia base. Un encabezado de reenvío evita bucles.
 */

import fs from "node:fs";
import path from "node:path";

/** Encabezado que marca una petición ya reenviada (previene bucles). */
export const FORWARD_HEADER = "x-pdm-auth-forward";

/**
 * Config persistente de a qué central/hub valida el login esta instalación.
 * Vive en `central.json` (PDM_DATA_DIR). Permite que cada sede apunte a
 * SU propio hub sin tocar el instalador. Precedencia: archivo > variable de
 * entorno (PDM_CENTRAL_URL, el valor por defecto que fija el Desktop) > ninguno
 * (la CENTRAL, que no define nada, es la fuente de verdad).
 */
const CONFIG_FILE = path.join(process.env.PDM_DATA_DIR || process.cwd(), "central.json");

function norm(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

function fromFile(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    const u = typeof raw?.centralUrl === "string" ? norm(raw.centralUrl) : "";
    return u || null;
  } catch {
    return null;
  }
}

function fromEnv(): string | null {
  const raw = process.env.PDM_CENTRAL_URL?.trim();
  return raw ? norm(raw) : null;
}

/** URL de la central/hub para validar el login, sin barra final. null = fuente de verdad local. */
export function centralUrl(): string | null {
  return fromFile() ?? fromEnv();
}

/** Config actual (para la pantalla de login): URL y de dónde sale. */
export function getCentralConfig(): { centralUrl: string; source: "file" | "env" | "none" } {
  const f = fromFile();
  if (f) return { centralUrl: f, source: "file" };
  const e = fromEnv();
  if (e) return { centralUrl: e, source: "env" };
  return { centralUrl: "", source: "none" };
}

/** Guarda (o borra, si vacío) la URL de central/hub en central.json. */
export function setCentralUrl(url: string | null): void {
  const clean = url ? norm(url) : "";
  if (!clean) {
    try {
      fs.rmSync(CONFIG_FILE);
    } catch {
      /* no existía */
    }
    return;
  }
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ centralUrl: clean }, null, 2), { encoding: "utf8" });
}

/** Resultado de consultar la central. */
export type CentralResult =
  | { ok: true; role: string; mustChangePassword: boolean }
  | { ok: false; status: number }
  | { unreachable: true };

/**
 * Valida credenciales contra la central. No lanza: devuelve `unreachable` si la
 * central no responde (para poder caer a la validación local).
 */
export async function centralLogin(username: string, password: string): Promise<CentralResult> {
  const base = centralUrl();
  if (!base) return { unreachable: true };
  try {
    const resp = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [FORWARD_HEADER]: "1" },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status === 200) {
      const data = (await resp.json().catch(() => null)) as
        | { user?: { role?: string; mustChangePassword?: boolean } }
        | null;
      return {
        ok: true,
        role: typeof data?.user?.role === "string" ? data.user.role : "Viewer",
        mustChangePassword: data?.user?.mustChangePassword === true,
      };
    }
    return { ok: false, status: resp.status };
  } catch {
    return { unreachable: true };
  }
}

/** Resultado de un cambio/reset reenviado a la central. */
export type CentralMutation =
  | { ok: true; role: string }
  | { ok: false; status: number; error?: string }
  | { unreachable: true };

/** Reenvía a la central una mutación de contraseña (cambio u olvido). */
async function forwardMutation(apiPath: string, body: unknown): Promise<CentralMutation> {
  const base = centralUrl();
  if (!base) return { unreachable: true };
  try {
    const resp = await fetch(`${base}${apiPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [FORWARD_HEADER]: "1" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await resp.json().catch(() => null)) as
      | { user?: { role?: string }; error?: string }
      | null;
    if (resp.status === 200) {
      return { ok: true, role: typeof data?.user?.role === "string" ? data.user.role : "Viewer" };
    }
    return { ok: false, status: resp.status, error: data?.error };
  } catch {
    return { unreachable: true };
  }
}

/** Cambio de contraseña propio, validado contra la central. */
export function centralChangePassword(body: {
  username: string;
  currentPassword: string;
  newPassword: string;
  recoveryCode?: string;
}): Promise<CentralMutation> {
  return forwardMutation("/api/auth/change-password", body);
}

/** Reset por código de recuperación, validado contra la central. */
export function centralForgotPassword(body: {
  username: string;
  recoveryCode: string;
  newPassword: string;
}): Promise<CentralMutation> {
  return forwardMutation("/api/auth/forgot-password", body);
}
