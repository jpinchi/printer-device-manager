/**
 * Auto-actualización del HUB (servidor headless de una sede).
 *
 * El hub corre como tarea programada (SYSTEM) desde la instalación del Desktop;
 * el auto-update de Electron NO aplica (es de la ventana GUI). Aquí el hub
 * consulta al central la versión disponible y, si hay una nueva, descarga el
 * instalador y lanza un helper DESACOPLADO que: detiene la tarea del hub,
 * reinstala en silencio (sobre la misma carpeta) y vuelve a arrancar la tarea
 * (que carga el bundle nuevo; ensureSchema migra la BD del hub al arrancar).
 */
import { spawn } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./log.js";
import { fetchWithTimeout, safeForwardUrl } from "./safe-url.js";

const HUB_TASK = "PDM Install Hub";

/** Versión leída una sola vez (env inyectado en el bundle, o el package.json del repo). */
let cachedVersion: string | null = null;
function resolveVersion(): string {
  if (process.env.PDM_APP_VERSION) return process.env.PDM_APP_VERSION;
  // El central corre desde el repo (tsx, sin inyección): lee apps/desktop/package.json.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url)); // apps/server/src (o /dist)
    for (const rel of ["../../desktop/package.json", "../../../apps/desktop/package.json"]) {
      try {
        const pkg = JSON.parse(readFileSync(path.resolve(here, rel), "utf8"));
        if (pkg?.version) return String(pkg.version);
      } catch { /* siguiente candidata */ }
    }
  } catch { /* sin repo a la vista */ }
  return "0.0.0";
}

/** URL del central que sirve el feed de instaladores (fija; overridable por env). */
export function updateBase(): string {
  return (process.env.PDM_UPDATE_URL || "http://192.0.2.24:2626").replace(/\/+$/, "");
}

/** Versión de este servidor (env inyectado en el bundle, o el package.json del repo). */
export function currentVersion(): string {
  if (cachedVersion === null) cachedVersion = resolveVersion();
  return cachedVersion;
}

/** ¿Este proceso es un HUB? Corre headless desde ProgramData\PDM-Hub. */
export function isHub(): boolean {
  const dir = (process.env.PDM_DATA_DIR || "").replace(/\\/g, "/").toLowerCase();
  return dir.includes("pdm-hub") || process.env.PDM_ROLE === "hub";
}

/** Compara "x.y.z": >0 si a es mayor. */
function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export interface UpdateStatus {
  isHub: boolean;
  current: string;
  available: string | null;
  updateAvailable: boolean;
  updating: boolean;
}

let updating = false;

/** Consulta al central la versión disponible y si hay una más nueva que la actual. */
export async function checkUpdate(): Promise<UpdateStatus> {
  const current = currentVersion();
  const partial: UpdateStatus = { isHub: isHub(), current, available: null, updateAvailable: false, updating };
  try {
    const base = safeForwardUrl(updateBase());
    if (!base) return partial;
    const r = await fetchWithTimeout(`${base}/api/desktop/info`, {}, 6000);
    if (!r.ok) return partial;
    const info = (await r.json()) as { available?: boolean; version?: string | null };
    const available = info?.version ?? null;
    return { ...partial, available, updateAvailable: !!available && cmpVersion(available, current) > 0 };
  } catch {
    return partial;
  }
}

/**
 * Descarga el instalador del central y lanza el helper que reinstala + reinicia
 * la tarea del hub. Solo procede si es un hub y hay una versión nueva. No espera
 * a que termine (el hub se reiniciará solo).
 */
export async function applyHubUpdate(): Promise<{ started: boolean; error?: string; to?: string }> {
  if (!isHub()) return { started: false, error: "no-es-hub" };
  if (updating) return { started: true };
  const st = await checkUpdate();
  if (!st.updateAvailable || !st.available) return { started: false, error: "ya-actualizado" };

  updating = true;
  try {
    const base = safeForwardUrl(updateBase());
    if (!base) throw new Error("URL de actualización inválida.");

    // 1) Descargar el instalador del central.
    const r = await fetchWithTimeout(`${base}/api/desktop/installer`, {}, 180000);
    if (!r.ok) throw new Error(`No se pudo descargar el instalador (HTTP ${r.status}).`);
    const buf = Buffer.from(await r.arrayBuffer());
    const stamp = Date.now();
    const exe = path.join(os.tmpdir(), `pdm-hub-update-${stamp}.exe`);
    await fs.writeFile(exe, buf);

    // 2) Directorio del app = donde vive el exe que ejecuta este server.
    const appDir = path.dirname(process.execPath);

    // 3) Helper desacoplado: detiene la tarea, reinstala en la misma carpeta y la
    //    reinicia. try/finally con el /run al final (y la tarea tiene auto-reinicio
    //    propio) para que el hub SIEMPRE vuelva a arrancar aunque algo falle.
    const helper = path.join(os.tmpdir(), `pdm-hub-update-${stamp}.cmd`);
    const lines = [
      "@echo off",
      "timeout /t 2 /nobreak >nul",
      `schtasks /end /tn "${HUB_TASK}" >nul 2>&1`,
      "timeout /t 4 /nobreak >nul",
      // NSIS silencioso; /D (carpeta destino) debe ir SIN comillas y AL FINAL.
      `"${exe}" /S /D=${appDir}`,
      "timeout /t 3 /nobreak >nul",
      `schtasks /run /tn "${HUB_TASK}" >nul 2>&1`,
      `del "${exe}" >nul 2>&1`,
      `del "%~f0" >nul 2>&1`,
    ];
    await fs.writeFile(helper, lines.join("\r\n"), "ascii");

    const child = spawn("cmd.exe", ["/c", helper], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    log.info("hub.update.started", { from: st.current, to: st.available });
    return { started: true, to: st.available };
  } catch (e) {
    updating = false;
    log.error("hub.update.failed", { error: e instanceof Error ? e.message : String(e) });
    return { started: false, error: e instanceof Error ? e.message : String(e) };
  }
}
