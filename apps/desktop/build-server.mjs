/**
 * Empaqueta el servidor backend para la app de escritorio.
 *
 *  1) Bundlea apps/server/src/index.ts → resources/server/index.cjs (esbuild),
 *     dejando Prisma como EXTERNO (su motor nativo no se puede "bundlear").
 *  2) Copia el runtime de Prisma (@prisma/client + .prisma/client, con el motor
 *     query_engine-*.node) a resources/server/node_modules para que `require`
 *     lo resuelva junto al bundle.
 *  3) Copia el frontend estático (apps/web/out) a resources/web.
 *  4) Crea una BD plantilla con el esquema aplicado en resources/db-template/pdm.db
 *     (se copia a la carpeta del usuario en el primer arranque).
 *
 * Ejecutar: node apps/desktop/build-server.mjs   (desde la raíz del repo)
 */
import { build } from "esbuild";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const resources = path.join(__dirname, "resources");
const serverOut = path.join(resources, "server");
// Runtime de Prisma en `vendor/` (NO node_modules: electron-builder ignora las
// carpetas node_modules en extraResources). Se resuelve vía NODE_PATH en main.js.
const nmOut = path.join(serverOut, "vendor");

async function rimraf(p) {
  await fs.rm(p, { recursive: true, force: true });
}
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (entry.isSymbolicLink()) {
      const real = await fs.realpath(s);
      const st = await fs.stat(real);
      if (st.isDirectory()) await copyDir(real, d);
      else await fs.copyFile(real, d);
    } else await fs.copyFile(s, d);
  }
}

console.log("▶ Limpiando resources/…");
await rimraf(resources);
await fs.mkdir(serverOut, { recursive: true });

// Versión del app (para que el servidor empaquetado sepa qué versión es y el
// hub pueda comparar con la del central para auto-actualizarse).
const appVersion = JSON.parse(await fs.readFile(path.join(__dirname, "package.json"), "utf8")).version;
console.log(`▶ Bundle del servidor (esbuild)… (v${appVersion})`);
await build({
  entryPoints: [path.join(repoRoot, "apps/server/src/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: path.join(serverOut, "index.cjs"),
  // Prisma NO se bundlea: su motor nativo se envía como runtime aparte.
  external: ["@prisma/client", ".prisma/client"],
  // import.meta.url dentro del bundle CJS → ruta del propio bundle.
  define: {
    "import.meta.url": "__importMetaUrl",
    "process.env.PDM_APP_VERSION": JSON.stringify(appVersion),
  },
  banner: { js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;" },
  logLevel: "info",
});

console.log("▶ Copiando runtime de Prisma…");
await fs.mkdir(nmOut, { recursive: true });
// @prisma/client (runtime) y .prisma/client (cliente generado + motor nativo).
await copyDir(path.join(repoRoot, "node_modules/@prisma/client"), path.join(nmOut, "@prisma/client"));
await copyDir(path.join(repoRoot, "node_modules/.prisma/client"), path.join(nmOut, ".prisma/client"));
// @prisma/client depende en runtime de estos paquetes hermanos:
for (const dep of ["@prisma/engines-version", "@prisma/debug"]) {
  const src = path.join(repoRoot, "node_modules", dep);
  if (existsSync(src)) await copyDir(src, path.join(nmOut, dep));
}
// Limpia archivos .tmp del motor si quedaron.
for (const f of await fs.readdir(path.join(nmOut, ".prisma/client"))) {
  if (f.includes(".tmp")) await fs.rm(path.join(nmOut, ".prisma/client", f), { force: true });
}

console.log("▶ Copiando frontend (apps/web/out)…");
const webOut = path.join(repoRoot, "apps/web/out");
if (!existsSync(path.join(webOut, "index.html"))) {
  throw new Error("Falta apps/web/out. Ejecuta `npm run build:web` antes.");
}
await copyDir(webOut, path.join(resources, "web"));

console.log("▶ Creando BD plantilla (esquema aplicado)…");
const tmplDir = path.join(resources, "db-template");
await fs.mkdir(tmplDir, { recursive: true });
const tmplDb = path.join(tmplDir, "pdm.db");
await rimraf(tmplDb);
execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
  cwd: repoRoot,
  env: { ...process.env, DATABASE_URL: "file:" + tmplDb.replace(/\\/g, "/") },
  stdio: "inherit",
  shell: true,
});

// Siembra las FOTOS POR MODELO en la plantilla, para que cada instalación nueva
// del Desktop venga con toda la biblioteca de fotos ya cargada (sin depender de
// traerlas de la central). Se copian los bytes (columna `data`) y se pone
// filePath=null (el Desktop no tiene esos archivos en disco).
console.log("▶ Sembrando fotos por modelo en la plantilla…");
try {
  const centralDb = path.join(repoRoot, "prisma", "prisma", "dev.db");
  if (!existsSync(centralDb)) {
    console.log("  (sin BD de origen en prisma/prisma/dev.db — plantilla sin fotos)");
  } else {
    const { DatabaseSync } = await import("node:sqlite");
    const src = new DatabaseSync(centralDb, { readOnly: true });
    const rows = src.prepare("SELECT id, key, manufacturer, model, fileName, data, mimeType, fileSize, assigned, updatedAt FROM ModelImage").all();
    src.close();
    const dst = new DatabaseSync(tmplDb);
    const ins = dst.prepare(
      "INSERT OR REPLACE INTO ModelImage (id, key, manufacturer, model, fileName, data, filePath, mimeType, fileSize, assigned, updatedAt) VALUES (?,?,?,?,?,?,NULL,?,?,?,?)",
    );
    let seeded = 0;
    for (const r of rows) {
      if (!r.data) continue; // solo filas con bytes en la BD
      ins.run(r.id, r.key, r.manufacturer, r.model, r.fileName, r.data, r.mimeType, r.fileSize, r.assigned, r.updatedAt);
      seeded++;
    }
    dst.exec("PRAGMA wal_checkpoint(TRUNCATE)"); // asegura que todo quede en pdm.db
    dst.close();
    console.log(`  ${seeded} fotos sembradas en la plantilla.`);
  }
} catch (e) {
  console.warn("  aviso: no se pudieron sembrar las fotos:", e?.message ?? e);
}

console.log("\n✓ Recursos listos en apps/desktop/resources/");
