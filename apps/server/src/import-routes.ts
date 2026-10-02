/**
 * Importar datos de la CENTRAL al servidor local (Desktop): inventario de
 * impresoras, ubicaciones y fotos por modelo. Evita re-capturar todo a mano.
 *
 * Idempotente: reimportar ACTUALIZA en vez de duplicar (empareja por IP de la
 * impresora, nombre de la ubicación y clave de modelo). NO copia usuarios,
 * contadores, historial ni la community cifrada (esos se re-obtienen al
 * sondear). Protegido por rol Administrator (ver authz).
 */
import { Router } from "express";
import { promises as fs } from "node:fs";
import { prisma } from "./db.js";
import { centralUrl } from "./auth/central-auth.js";
import { safeForwardUrl } from "./safe-url.js";

export const importRouter = Router();

const keyOf = (m: string, mo: string) => `${m}|${mo}`.trim().toLowerCase();
const extFromMime = (mt: string) =>
  mt.includes("png") ? ".png" : mt.includes("webp") ? ".webp" : mt.includes("gif") ? ".gif" : ".jpg";

/** Inicia sesión en la central y devuelve un token del app. */
async function centralToken(base: string, username: string, password: string): Promise<string> {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 401) throw new Error("Credenciales de la central incorrectas.");
  if (!r.ok) throw new Error(`No se pudo iniciar sesión en la central (HTTP ${r.status}).`);
  const data = (await r.json()) as { token?: string };
  if (!data.token) throw new Error("La central no devolvió un token.");
  return data.token;
}

async function getJson<T>(base: string, apiPath: string, token: string): Promise<T> {
  const r = await fetch(`${base}${apiPath}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Error leyendo ${apiPath} de la central (HTTP ${r.status}).`);
  return (await r.json()) as T;
}

// POST /from-central  { centralUrl?, username, password }
importRouter.post("/from-central", async (req, res) => {
  const rawBase = String(req.body?.centralUrl || centralUrl() || "");
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!rawBase) return res.status(400).json({ error: "No hay una central configurada. Indica su URL." });
  // Valida el destino: solo http(s) a un host de la red (no link-local/metadata).
  const base = safeForwardUrl(rawBase);
  if (!base) return res.status(400).json({ error: "La URL de la central no es válida o no está permitida." });
  if (!username || !password) return res.status(400).json({ error: "Faltan las credenciales de la central." });

  try {
    const token = await centralToken(base, username, password);

    // 1) Ubicaciones (empareja por nombre único).
    type Loc = { name: string; description: string | null };
    const locs = await getJson<Loc[]>(base, "/api/locations", token);
    const nameToId = new Map<string, string>();
    let locations = 0;
    for (const l of locs) {
      const name = (l.name ?? "").trim();
      if (!name) continue;
      const row = await prisma.location.upsert({
        where: { name },
        update: { description: l.description ?? null },
        create: { name, description: l.description ?? null },
      });
      nameToId.set(name, row.id);
      locations++;
    }

    // 1b) Unidades de trabajo (empareja por nombre único).
    type Wu = { name: string; description: string | null };
    const wus = await getJson<Wu[]>(base, "/api/workunits", token).catch(() => [] as Wu[]);
    const wuNameToId = new Map<string, string>();
    let workUnits = 0;
    for (const w of wus) {
      const name = (w.name ?? "").trim();
      if (!name) continue;
      const row = await prisma.workUnit.upsert({
        where: { name },
        update: { description: w.description ?? null },
        create: { name, description: w.description ?? null },
      });
      wuNameToId.set(name, row.id);
      workUnits++;
    }

    // 2) Impresoras (inventario; empareja por IP única). La ubicación y la
    //    unidad de trabajo vienen como objeto con .name → se enlazan por nombre.
    type Prn = {
      name: string;
      ipAddress: string;
      macAddress: string | null;
      hostname: string | null;
      manufacturer: string;
      model: string | null;
      serialNumber: string | null;
      firmware: string | null;
      snmpVersion: string;
      sysObjectId: string | null;
      status: string;
      location?: { name: string } | null;
      workUnit?: { name: string } | null;
    };
    const prns = await getJson<Prn[]>(base, "/api/printers", token);
    let printers = 0;
    for (const p of prns) {
      if (!p.ipAddress) continue;
      const locId = p.location?.name ? nameToId.get(p.location.name) ?? null : null;
      const wuId = p.workUnit?.name ? wuNameToId.get(p.workUnit.name) ?? null : null;
      const data = {
        name: p.name,
        macAddress: p.macAddress ?? null,
        hostname: p.hostname ?? null,
        manufacturer: p.manufacturer ?? "UNKNOWN",
        model: p.model ?? null,
        serialNumber: p.serialNumber ?? null,
        firmware: p.firmware ?? null,
        snmpVersion: p.snmpVersion ?? "v2c",
        sysObjectId: p.sysObjectId ?? null,
        status: p.status ?? "UNKNOWN",
        locationId: locId,
        workUnitId: wuId,
      };
      await prisma.printer.upsert({
        where: { ipAddress: p.ipAddress },
        update: data,
        create: { ipAddress: p.ipAddress, ...data },
      });
      printers++;
    }

    // 3) Fotos por modelo (bytes vía /lookup, que es público). Empareja por clave.
    //    Los bytes se guardan EN LA BD (columna `data`), no en disco.
    type Img = { key: string; manufacturer: string; model: string; fileName: string };
    const imgs = await getJson<Img[]>(base, "/api/model-images", token);
    let images = 0;
    for (const im of imgs) {
      const url = `${base}/api/model-images/lookup?manufacturer=${encodeURIComponent(im.manufacturer)}&model=${encodeURIComponent(im.model)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const mimeType = r.headers.get("content-type") || "image/jpeg";
      const buf = Buffer.from(await r.arrayBuffer());
      const data = new Uint8Array(buf.byteLength);
      data.set(buf);
      const key = keyOf(im.manufacturer, im.model);
      const fileName = im.fileName || `${im.model}`.replace(/[^\w.-]+/g, "_") + extFromMime(mimeType);
      const prev = await prisma.modelImage.findUnique({ where: { key } });
      if (prev?.filePath) await fs.unlink(prev.filePath).catch(() => {});
      await prisma.modelImage.upsert({
        where: { key },
        update: { manufacturer: im.manufacturer, model: im.model, fileName, data, filePath: null, mimeType, fileSize: buf.length },
        create: { key, manufacturer: im.manufacturer, model: im.model, fileName, data, filePath: null, mimeType, fileSize: buf.length },
      });
      images++;
    }

    res.json({ ok: true, locations, workUnits, printers, images });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Error importando de la central." });
  }
});
