/**
 * Descarga de la app de escritorio (instalador Windows) + feed de auto-update.
 *
 *  GET /api/desktop/info        → { available, fileName, size, version } (público)
 *  GET /api/desktop/installer   → descarga el .exe (público)
 *  GET /api/desktop/feed/:file  → feed de electron-updater: latest.yml, .exe, .blockmap (público)
 *
 * Público a propósito: la pantalla de login (sin autenticar) ofrece el botón de
 * descarga, y la app de escritorio consulta el feed sin sesión. El feed solo sirve
 * archivos de la carpeta del instalador y valida el nombre (sin rutas ni traversal).
 */
import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { log } from "./log.js";

export const desktopRouter = Router();

/** Carpetas donde buscar el instalador (env override + ubicaciones por defecto). */
function installerDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.PDM_DESKTOP_DIR) dirs.push(path.resolve(process.env.PDM_DESKTOP_DIR));
  dirs.push(path.resolve(process.cwd(), "apps/desktop/dist-installer"));
  dirs.push(path.resolve(process.cwd(), "downloads"));
  return dirs;
}

/** Extrae [major,minor,patch] de un nombre de archivo, o [0,0,0] si no hay. */
function versionOf(name: string): [number, number, number] {
  const m = name.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/**
 * Encuentra el instalador (.exe "Setup", excluyendo el desinstalador).
 * Si hay varios, elige el de MAYOR versión (y a igual versión, el más reciente),
 * para que builds viejos que hayan quedado en la carpeta no se sirvan por error.
 */
async function findInstaller(): Promise<{ dir: string; file: string } | null> {
  for (const dir of installerDirs()) {
    try {
      const entries = await fs.readdir(dir);
      const exes = entries.filter(
        (f) => f.toLowerCase().endsWith(".exe") && !/uninstall/i.test(f) && /setup/i.test(f),
      );
      if (!exes.length) continue;
      const withMeta = await Promise.all(
        exes.map(async (f) => ({
          file: f,
          ver: versionOf(f),
          mtime: (await fs.stat(path.join(dir, f)).catch(() => null))?.mtimeMs ?? 0,
        })),
      );
      withMeta.sort((a, b) => {
        for (let i = 0; i < 3; i++) if (a.ver[i] !== b.ver[i]) return b.ver[i] - a.ver[i];
        return b.mtime - a.mtime;
      });
      return { dir, file: withMeta[0].file };
    } catch {
      /* la carpeta no existe: siguiente candidata */
    }
  }
  return null;
}

desktopRouter.get("/info", async (_req, res) => {
  const found = await findInstaller();
  if (!found) return res.json({ available: false });
  try {
    const stat = await fs.stat(path.join(found.dir, found.file));
    const m = found.file.match(/(\d+\.\d+\.\d+)/);
    res.json({ available: true, fileName: found.file, size: stat.size, version: m ? m[1] : null });
  } catch {
    res.json({ available: false });
  }
});

desktopRouter.get("/installer", async (_req, res) => {
  const found = await findInstaller();
  if (!found) return res.status(404).json({ error: "No hay instalador de escritorio disponible en el servidor." });
  res.download(path.join(found.dir, found.file), found.file);
});

/**
 * Feed de auto-actualización para electron-updater (proveedor "generic").
 * La app pide `<feed>/latest.yml` y luego el `.exe`/`.blockmap` que este indica.
 * Solo se sirven archivos con nombre simple (sin separadores) y extensión válida,
 * desde la carpeta del instalador. Sin path traversal.
 */
const FEED_ALLOWED = new Set([".yml", ".exe", ".blockmap"]);

desktopRouter.get("/feed/:file", async (req, res) => {
  const file = req.params.file;
  // Rechaza cualquier nombre con separadores de ruta o '..'.
  if (!file || file.includes("/") || file.includes("\\") || file.includes("..")) {
    return res.status(400).json({ error: "Nombre de archivo inválido." });
  }
  const ext = path.extname(file).toLowerCase();
  if (!FEED_ALLOWED.has(ext)) {
    return res.status(404).json({ error: "No encontrado." });
  }
  for (const dir of installerDirs()) {
    const full = path.join(dir, file);
    // Confirma que sigue dentro de la carpeta (defensa extra) y que existe.
    if (path.dirname(full) !== path.resolve(dir)) continue;
    try {
      await fs.access(full);
      // Registro del auto-update: latest.yml = un Desktop CHEQUEA; el .exe =
      // DESCARGA la actualización. Permite ver qué equipos (IP) toman cada versión.
      const ext2 = path.extname(file).toLowerCase();
      const event = ext2 === ".yml" ? "desktop.update.check" : "desktop.update.download";
      const version = file.match(/(\d+\.\d+\.\d+)/)?.[1];
      log.info(event, { ip: req.ip, file, version, ua: req.get("user-agent") ?? undefined });
      return res.sendFile(full);
    } catch {
      /* no está en esta carpeta: siguiente */
    }
  }
  res.status(404).json({ error: "No encontrado." });
});
