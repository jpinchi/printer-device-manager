// @ts-nocheck
/**
 * capture-screenshots.mjs — Genera las capturas del README con datos de ejemplo.
 *
 * Qué hace (todo en uno, reproducible):
 *   1. Siembra una BD de demostración temporal (scripts/demo-seed.mjs) con datos
 *      INVENTADOS (ninguno real).
 *   2. Arranca el servidor unificado contra esa BD (auth desactivada, sin sondeo).
 *   3. Con Chrome en modo headless captura varias vistas (claro/oscuro).
 *   4. Optimiza los PNG con ImageMagick (`magick`) y los guarda en docs/screenshots/.
 *
 * Requisitos: Node ≥ 20, Google Chrome (o Edge) instalado, el frontend ya
 * compilado (`npm run build:web`) y ImageMagick (`magick`, o `convert` fuera de Windows) para optimizar
 * (opcional: si no está, se copian los PNG sin optimizar).
 *
 * Uso:   node scripts/capture-screenshots.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const webOut = resolve(repo, "apps/web/out");
const outDir = resolve(repo, "docs/screenshots");
const tmp = join(os.tmpdir(), `pdm-shots-${Date.now()}`);
const dbPath = join(tmp, "demo.db");
const profile = join(tmp, "chrome-profile");
const PORT = 4823;
const BASE = `http://localhost:${PORT}`;

function findBrowser() {
  const cands = [
    process.env.CHROME_PATH,
    // Windows
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  throw new Error("No se encontró Chrome ni Edge. Instala uno o edita findBrowser().");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {}
    await sleep(500);
  }
  throw new Error("El servidor de demo no respondió a tiempo.");
}

// Vistas a capturar: nombre, ruta, tema, tamaño.
const SHOTS = [
  { name: "dashboard-dark",  to: "/",                    theme: "dark",  w: 1600, h: 1000 },
  { name: "dashboard-light", to: "/",                    theme: "light", w: 1600, h: 1000 },
  { name: "reportes",        to: "/monitoring/reports/", theme: "dark",  w: 1600, h: 1000 },
  { name: "consumibles",     to: "/monitoring/supplies/",theme: "dark",  w: 1600, h: 1000 },
  // La ficha de impresora se añade dinámicamente (necesita un id real).
];

function capture(browser, shot) {
  const raw = join(tmp, `${shot.name}.png`);
  const url = `${BASE}/_shot.html?theme=${shot.theme}&to=${encodeURIComponent(shot.to)}`;
  const r = spawnSync(browser, [
    "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--hide-scrollbars", "--force-device-scale-factor=1",
    "--virtual-time-budget=10000", `--window-size=${shot.w},${shot.h}`,
    `--screenshot=${raw}`, url,
  ], { timeout: 90000 });
  if (r.status !== 0 || !existsSync(raw)) throw new Error(`Falló la captura ${shot.name} (code ${r.status}).`);
  optimize(raw, join(outDir, `${shot.name}.png`));
  console.log(`  ✓ ${shot.name}.png`);
}

// Comando de ImageMagick: `magick` (v7) o `convert` (v6). En Windows NUNCA se usa
// `convert`: ahí es System32\convert.exe, la herramienta que convierte discos FAT a NTFS.
let magickCmd;
function findMagick() {
  if (magickCmd !== undefined) return magickCmd;
  const cands = process.platform === "win32" ? ["magick"] : ["magick", "convert"];
  magickCmd = cands.find((c) => spawnSync(c, ["-version"], { timeout: 10000 }).status === 0) || null;
  return magickCmd;
}

// Optimiza con ImageMagick si está; si no, copia tal cual. Reduce si supera 400 KB.
function optimize(src, dst) {
  const magick = findMagick();
  if (!magick) { copyFileSync(src, dst); return; }
  spawnSync(magick, [src, "-strip", "-define", "png:compression-level=9", dst], { timeout: 30000 });
  if (statSync(dst).size > 400 * 1024) {
    // Segundo intento: baja la resolución un 15 %.
    spawnSync(magick, [src, "-strip", "-resize", "85%", "-define", "png:compression-level=9", dst], { timeout: 30000 });
  }
}

let server;
async function main() {
  if (!existsSync(join(webOut, "index.html"))) {
    throw new Error("Falta apps/web/out. Corre primero:  npm run build:web");
  }
  mkdirSync(tmp, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const browser = findBrowser();

  // 1) Sembrar la BD de demo.
  console.log("Sembrando BD de demostración…");
  const seed = spawnSync(process.execPath, [resolve(here, "demo-seed.mjs")], {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` }, stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("Falló el sembrado de la BD de demo.");

  // 2) Arrancar el servidor contra la BD de demo.
  console.log("Arrancando servidor de demo…");
  // Si ya hay algo en el puerto, las capturas saldrían de ESE servidor (otra BD).
  if (await fetch(`${BASE}/api/health`).then(() => true, () => false)) {
    throw new Error(`Ya hay un servidor en el puerto ${PORT}. Ciérralo y vuelve a intentar.`);
  }
  // Node directo con el loader de tsx (sin npx ni shell): así server.kill() cierra
  // el servidor de verdad. Con shell en Windows solo moría cmd.exe y el servidor
  // quedaba vivo ocupando el puerto.
  server = spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], {
    cwd: repo,
    env: {
      ...process.env, PORT: String(PORT), AUTH_ENFORCE: "false",
      POLLING_ENABLED: "false", PDM_WEB_OUT: webOut, DATABASE_URL: `file:${dbPath}`,
    },
    stdio: "ignore",
  });
  await waitHealth();

  // 3) Página "bootstrap": fija el tema y marca el tutorial como visto, luego redirige.
  writeFileSync(join(webOut, "_shot.html"),
    `<!doctype html><meta charset="utf-8"><title>bootstrap</title><script>` +
    `(function(){var q=new URLSearchParams(location.search);try{` +
    `localStorage.setItem('pdm.theme',q.get('theme')||'dark');` +
    `localStorage.setItem('pdm.tutorial.v1','1');}catch(e){}` +
    `location.replace(q.get('to')||'/');})();<\/script>`);

  // 4) Ficha de impresora: tomar un id real de la BD de demo.
  try {
    const list = await (await fetch(`${BASE}/api/printers`)).json();
    const pick = list.find((p) => (p.model || "").includes("C")) || list[0];
    if (pick) SHOTS.push({ name: "ficha-impresora", to: `/printer/?id=${pick.id}`, theme: "dark", w: 1440, h: 1000 });
  } catch {}

  // 5) Capturar.
  console.log("Capturando vistas…");
  rmSync(profile, { recursive: true, force: true });
  for (const shot of SHOTS) capture(browser, shot);

  console.log(`\nListo. Capturas en: ${outDir}`);
}

function cleanup() {
  try { if (server && !server.killed) server.kill(); } catch {}
  try { rmSync(join(webOut, "_shot.html"), { force: true }); } catch {}
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

main()
  .then(() => { cleanup(); process.exit(0); })
  .catch((e) => { console.error("ERROR:", e.message); cleanup(); process.exit(1); });
