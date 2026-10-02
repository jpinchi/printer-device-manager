/**
 * Fotos reales por modelo de impresora. Los BYTES viven EN LA BD (columna
 * `data`), así son portables y sobreviven a reinstalaciones; `filePath` solo
 * queda para las filas antiguas hasta que el backfill las migre.
 *
 *  GET  /lookup?manufacturer&model   → sirve la imagen (PÚBLICO, para <img>).
 *  GET  /                            → lista de modelos con foto (gestión).
 *  POST /                            → sube/reemplaza (Administrator).
 *  DELETE /:key                      → elimina (Administrator).
 *
 *  Biblioteca de la central (para que otras sedes reutilicen las fotos):
 *  GET  /central                     → lista los modelos con foto de la central.
 *  GET  /central/lookup?manufacturer&model → proxy de la imagen de la central.
 *  POST /import-from-central         → copia una foto de la central a este equipo.
 *
 * El lookup es público porque son fotos genéricas de producto (no sensibles) y
 * así el navegador puede cargarlas en <img> sin cabecera de autenticación.
 */
import { Router } from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import { prisma } from "./db.js";
import { log } from "./log.js";
import { centralUrl } from "./auth/central-auth.js";
import { safeForwardUrl, fetchWithTimeout } from "./safe-url.js";

export const modelImagesRouter = Router();

// Imagen en memoria (los bytes van a la BD, no al disco).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  // Solo formatos rasterizados seguros. Se RECHAZA SVG (puede llevar <script> y
  // ejecutarse como XSS al servirse inline desde el mismo origen del SPA).
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.mimetype)),
});

const keyOf = (manufacturer: string, model: string) =>
  `${manufacturer}|${model}`.trim().toLowerCase();

/**
 * Copia a un `Uint8Array` respaldado por un `ArrayBuffer` nuevo (lo que espera
 * Prisma para `Bytes`; un `Buffer` es `Uint8Array<ArrayBufferLike>` y no encaja).
 */
const toBytes = (b: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(b.byteLength);
  out.set(b);
  return out;
};

/** Cabeceras de seguridad al servir una imagen inline desde el origen del SPA. */
function setImageHeaders(res: import("express").Response, mimeType: string) {
  res.setHeader("Cache-Control", "no-cache"); // revalida para reflejar re-subidas
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.type(mimeType);
}

/**
 * Migra a la BD las fotos antiguas guardadas solo en disco (`filePath` con
 * `data` nulo). Idempotente y barato tras la primera vez. Se llama al arrancar.
 */
export async function backfillModelImages(): Promise<void> {
  const pending = await prisma.modelImage.findMany({
    where: { data: null, NOT: { filePath: null } },
    select: { id: true, filePath: true },
  });
  let migrated = 0;
  for (const row of pending) {
    if (!row.filePath) continue;
    try {
      const buf = await fs.readFile(row.filePath);
      await prisma.modelImage.update({ where: { id: row.id }, data: { data: toBytes(buf), fileSize: buf.length } });
      migrated++;
    } catch {
      /* archivo perdido: se deja como está (el lookup caerá a la ilustración) */
    }
  }
  if (migrated > 0) log.info("model_images.backfill", { migrated });
}

/** Envía los bytes de una fila (de la BD o, si es antigua, de disco). */
async function sendRowImage(res: import("express").Response, row: { data: Uint8Array | null; filePath: string | null; mimeType: string }): Promise<boolean> {
  setImageHeaders(res, row.mimeType);
  if (row.data) {
    res.send(Buffer.from(row.data));
    return true;
  }
  if (row.filePath) {
    try {
      await fs.access(row.filePath);
      res.sendFile(row.filePath);
      return true;
    } catch {
      /* archivo perdido */
    }
  }
  return false;
}

// --- Servir la foto ASIGNADA de un modelo (público) ------------------------
// Solo si está asignada; si se "eliminó" (assigned=false) o no existe → 404 y la
// UI usa la ilustración por defecto.
modelImagesRouter.get("/lookup", async (req, res) => {
  const manufacturer = String(req.query.manufacturer ?? "");
  const model = String(req.query.model ?? "");
  if (!model.trim()) return res.status(404).end();
  const row = await prisma.modelImage.findUnique({ where: { key: keyOf(manufacturer, model) } });
  if (!row || !row.assigned) return res.status(404).end();
  if (!(await sendRowImage(res, row))) return res.status(404).end();
});

// --- Servir una foto de la BIBLIOTECA (público) ----------------------------
// Igual que /lookup pero SIN exigir assigned (el catálogo incluye fotos no
// asignadas a ningún modelo). Se usa para las miniaturas del selector.
modelImagesRouter.get("/library-lookup", async (req, res) => {
  const manufacturer = String(req.query.manufacturer ?? "");
  const model = String(req.query.model ?? "");
  if (!model.trim()) return res.status(404).end();
  const row = await prisma.modelImage.findUnique({ where: { key: keyOf(manufacturer, model) } });
  if (!row) return res.status(404).end();
  if (!(await sendRowImage(res, row))) return res.status(404).end();
});

const LIBRARY_SELECT = { key: true, manufacturer: true, model: true, fileName: true, fileSize: true, updatedAt: true } as const;

// --- Listar modelos con foto ASIGNADA (para la rejilla) --------------------
modelImagesRouter.get("/", async (_req, res) => {
  const rows = await prisma.modelImage.findMany({
    where: { assigned: true },
    orderBy: [{ manufacturer: "asc" }, { model: "asc" }],
    select: LIBRARY_SELECT,
  });
  res.json(rows);
});

// --- Catálogo/biblioteca completo (asignadas + no asignadas) (público) -----
modelImagesRouter.get("/library", async (_req, res) => {
  const rows = await prisma.modelImage.findMany({
    orderBy: [{ manufacturer: "asc" }, { model: "asc" }],
    select: LIBRARY_SELECT,
  });
  res.json(rows);
});

// --- BIBLIOTECA para el selector "Cambiar" ---------------------------------
// Devuelve el CATÁLOGO (asignadas + no asignadas): de la central si este equipo
// apunta a una, o el propio si ESTE equipo es la central. Público (GET).
modelImagesRouter.get("/central", async (_req, res) => {
  const base = safeForwardUrl(centralUrl() ?? "");
  if (!base) {
    // Este equipo es la central (o no hay una válida): su propio catálogo.
    const rows = await prisma.modelImage.findMany({
      orderBy: [{ manufacturer: "asc" }, { model: "asc" }],
      select: LIBRARY_SELECT,
    });
    return res.json({ self: true, images: rows });
  }
  try {
    // /library (catálogo completo). Fallback a /model-images para centrales viejas.
    let r = await fetchWithTimeout(`${base}/api/model-images/library`, {}, 8000);
    if (r.status === 404) r = await fetchWithTimeout(`${base}/api/model-images`, {}, 8000);
    if (!r.ok) return res.status(502).json({ error: `La central respondió ${r.status}.` });
    const images = await r.json();
    res.json({ self: false, images });
  } catch {
    res.status(502).json({ error: "No se pudo contactar la central." });
  }
});

// Proxy de la miniatura del catálogo (same-origin para el <img> del SPA). Usa
// library-lookup (sirve también fotos NO asignadas, que están en la biblioteca).
modelImagesRouter.get("/central/lookup", async (req, res) => {
  const manufacturer = String(req.query.manufacturer ?? "");
  const model = String(req.query.model ?? "");
  if (!model.trim()) return res.status(404).end();
  const base = safeForwardUrl(centralUrl() ?? "");
  const qs = `manufacturer=${encodeURIComponent(manufacturer)}&model=${encodeURIComponent(model)}`;
  if (!base) {
    // Es la central: redirige a su propio library-lookup local.
    return res.redirect(302, `/api/model-images/library-lookup?${qs}`);
  }
  try {
    let r = await fetchWithTimeout(`${base}/api/model-images/library-lookup?${qs}`, {}, 8000);
    if (r.status === 404) r = await fetchWithTimeout(`${base}/api/model-images/lookup?${qs}`, {}, 8000);
    if (!r.ok) return res.status(404).end();
    setImageHeaders(res, r.headers.get("content-type") || "image/jpeg");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

// Asigna a un modelo una foto de la BIBLIOTECA, asociándola al modelo indicado
// (permite emparejar: la foto de un modelo → el modelo que corresponda, aunque
// el nombre difiera). Si hay central configurada, la trae de la central; si ESTE
// equipo ES la central, copia localmente de una foto ya existente. Administrator.
modelImagesRouter.post("/import-from-central", async (req, res) => {
  const base = safeForwardUrl(centralUrl() ?? "");
  const sourceManufacturer = String(req.body?.sourceManufacturer ?? "").trim();
  const sourceModel = String(req.body?.sourceModel ?? "").trim();
  // Destino: por defecto, el mismo modelo (coincidencia exacta).
  const manufacturer = String(req.body?.manufacturer ?? sourceManufacturer).trim();
  const model = String(req.body?.model ?? sourceModel).trim();
  if (!sourceModel || !model) return res.status(400).json({ error: "Falta el modelo de origen o destino." });
  const key = keyOf(manufacturer, model);

  try {
    let bytes: Uint8Array<ArrayBuffer>;
    let mimeType: string;
    if (!base) {
      // Este equipo es la central: copia local de una foto ya existente.
      const src = await prisma.modelImage.findUnique({ where: { key: keyOf(sourceManufacturer, sourceModel) } });
      if (!src) return res.status(404).json({ error: "No existe esa foto en la biblioteca." });
      mimeType = src.mimeType;
      if (src.data) bytes = toBytes(src.data);
      else if (src.filePath) bytes = toBytes(await fs.readFile(src.filePath));
      else return res.status(404).json({ error: "No existe esa foto en la biblioteca." });
    } else {
      // Hay central: trae los bytes por su library-lookup (incluye no asignadas).
      const qs = `manufacturer=${encodeURIComponent(sourceManufacturer)}&model=${encodeURIComponent(sourceModel)}`;
      let r = await fetchWithTimeout(`${base}/api/model-images/library-lookup?${qs}`, {}, 8000);
      if (r.status === 404) r = await fetchWithTimeout(`${base}/api/model-images/lookup?${qs}`, {}, 8000);
      if (!r.ok) return res.status(404).json({ error: "La central no tiene esa foto." });
      mimeType = r.headers.get("content-type") || "image/jpeg";
      bytes = toBytes(Buffer.from(await r.arrayBuffer()));
    }
    const fileName = `${sourceModel}`.replace(/[^\w.-]+/g, "_") + extFromMime(mimeType);
    // Al asignar, la foto queda ASIGNADA a este modelo (assigned=true).
    const row = await prisma.modelImage.upsert({
      where: { key },
      create: { key, manufacturer, model, fileName, data: bytes, filePath: null, mimeType, fileSize: bytes.length, assigned: true },
      update: { manufacturer, model, fileName, data: bytes, filePath: null, mimeType, fileSize: bytes.length, assigned: true },
    });
    res.status(201).json({ key: row.key, manufacturer: row.manufacturer, model: row.model, fileSize: row.fileSize });
  } catch {
    res.status(502).json({ error: "No se pudo asignar la foto." });
  }
});

const extFromMime = (mt: string) =>
  mt.includes("png") ? ".png" : mt.includes("webp") ? ".webp" : mt.includes("gif") ? ".gif" : mt.includes("bmp") ? ".bmp" : ".jpg";

// --- Subir / reemplazar (Administrator) ------------------------------------
modelImagesRouter.post("/", upload.single("file"), async (req, res) => {
  const manufacturer = String(req.body?.manufacturer ?? "").trim();
  const model = String(req.body?.model ?? "").trim();
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Falta la imagen (campo 'file') o no es una imagen." });
  if (!model) return res.status(400).json({ error: "Falta el modelo." });
  const key = keyOf(manufacturer, model);
  const prev = await prisma.modelImage.findUnique({ where: { key } });
  // Si la fila previa tenía archivo en disco, lo limpiamos (ahora vive en BD).
  if (prev?.filePath) await fs.unlink(prev.filePath).catch(() => {});
  // Subir añade la foto al catálogo Y la asigna a este modelo (assigned=true).
  const row = await prisma.modelImage.upsert({
    where: { key },
    create: { key, manufacturer, model, fileName: file.originalname, data: toBytes(file.buffer), filePath: null, mimeType: file.mimetype, fileSize: file.size, assigned: true },
    update: { manufacturer, model, fileName: file.originalname, data: toBytes(file.buffer), filePath: null, mimeType: file.mimetype, fileSize: file.size, assigned: true },
  });
  res.status(201).json({ key: row.key, manufacturer: row.manufacturer, model: row.model, fileName: row.fileName, fileSize: row.fileSize });
});

// --- Eliminar la foto de un MODELO (Administrator) -------------------------
// DESASIGNA (assigned=false): el modelo vuelve a la ilustración por defecto,
// pero la foto SE QUEDA en el catálogo/biblioteca para reutilizarla. No borra la
// fila ni los bytes.
modelImagesRouter.delete("/:key", async (req, res) => {
  const row = await prisma.modelImage.findUnique({ where: { key: req.params.key } });
  if (!row) return res.status(404).json({ error: "No encontrado" });
  await prisma.modelImage.update({ where: { key: req.params.key }, data: { assigned: false } });
  res.status(204).end();
});
