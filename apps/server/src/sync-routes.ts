/**
 * Sincronización Desktop ↔ Hub (servidor de la sede).
 *
 *  POST /api/sync/push     → corre en el DESKTOP: lee su data local (inventario,
 *                            ubicaciones, unidades de trabajo, fotos por modelo),
 *                            inicia sesión en el hub y le ENVÍA todo (server a
 *                            server, sin CORS). Body: { serverUrl?, username, password }.
 *  POST /api/sync/receive  → corre en el HUB: recibe el paquete y hace UPSERT
 *                            (fusión, sin borrar). Solo Administrator (ver authz).
 *
 * Simétrico a import-routes (que JALA del servidor). Empareja por IP (impresora),
 * nombre (ubicación/unidad) y clave (foto). NO toca usuarios ni lecturas SNMP.
 */
import { Router } from "express";
import { prisma } from "./db.js";
import { centralUrl } from "./auth/central-auth.js";
import { safeForwardUrl, fetchWithTimeout } from "./safe-url.js";

export const syncRouter = Router();

const keyOf = (m: string, mo: string) => `${m}|${mo}`.trim().toLowerCase();
const toBytes = (b: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(b.byteLength);
  out.set(b);
  return out;
};

interface SyncPayload {
  locations: { name: string; description: string | null }[];
  workUnits: { name: string; description: string | null }[];
  printers: {
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
    locationName: string | null;
    workUnitName: string | null;
  }[];
  modelImages: { manufacturer: string; model: string; fileName: string; mimeType: string; dataBase64: string }[];
}

/** Arma el paquete con la data LOCAL de este equipo. */
async function buildLocalPayload(): Promise<SyncPayload> {
  const [locations, workUnits, printers, images] = await Promise.all([
    prisma.location.findMany({ select: { name: true, description: true } }),
    prisma.workUnit.findMany({ select: { name: true, description: true } }),
    prisma.printer.findMany({
      select: {
        name: true, ipAddress: true, macAddress: true, hostname: true, manufacturer: true,
        model: true, serialNumber: true, firmware: true, snmpVersion: true, sysObjectId: true,
        status: true, location: { select: { name: true } }, workUnit: { select: { name: true } },
      },
    }),
    prisma.modelImage.findMany({ select: { manufacturer: true, model: true, fileName: true, mimeType: true, data: true } }),
  ]);
  return {
    locations,
    workUnits,
    printers: printers.map((p) => ({
      name: p.name, ipAddress: p.ipAddress, macAddress: p.macAddress, hostname: p.hostname,
      manufacturer: p.manufacturer, model: p.model, serialNumber: p.serialNumber, firmware: p.firmware,
      snmpVersion: p.snmpVersion, sysObjectId: p.sysObjectId, status: p.status,
      locationName: p.location?.name ?? null, workUnitName: p.workUnit?.name ?? null,
    })),
    modelImages: images
      .filter((i) => i.data)
      .map((i) => ({
        manufacturer: i.manufacturer, model: i.model, fileName: i.fileName, mimeType: i.mimeType,
        dataBase64: Buffer.from(i.data as Uint8Array).toString("base64"),
      })),
  };
}

/** Aplica un paquete a la BD local (UPSERT, sin borrar). Devuelve conteos. */
async function applyPayload(pl: SyncPayload) {
  let locations = 0;
  const locName = new Map<string, string>();
  for (const l of pl.locations ?? []) {
    const name = (l.name ?? "").trim();
    if (!name) continue;
    const row = await prisma.location.upsert({ where: { name }, update: { description: l.description ?? null }, create: { name, description: l.description ?? null } });
    locName.set(name, row.id);
    locations++;
  }
  let workUnits = 0;
  const wuName = new Map<string, string>();
  for (const w of pl.workUnits ?? []) {
    const name = (w.name ?? "").trim();
    if (!name) continue;
    const row = await prisma.workUnit.upsert({ where: { name }, update: { description: w.description ?? null }, create: { name, description: w.description ?? null } });
    wuName.set(name, row.id);
    workUnits++;
  }
  let printers = 0;
  for (const p of pl.printers ?? []) {
    if (!p.ipAddress) continue;
    const data = {
      name: p.name, macAddress: p.macAddress ?? null, hostname: p.hostname ?? null,
      manufacturer: p.manufacturer ?? "UNKNOWN", model: p.model ?? null, serialNumber: p.serialNumber ?? null,
      firmware: p.firmware ?? null, snmpVersion: p.snmpVersion ?? "v2c", sysObjectId: p.sysObjectId ?? null,
      status: p.status ?? "UNKNOWN",
      locationId: p.locationName ? locName.get(p.locationName) ?? null : null,
      workUnitId: p.workUnitName ? wuName.get(p.workUnitName) ?? null : null,
    };
    await prisma.printer.upsert({ where: { ipAddress: p.ipAddress }, update: data, create: { ipAddress: p.ipAddress, ...data } });
    printers++;
  }
  let images = 0;
  for (const im of pl.modelImages ?? []) {
    if (!im.model || !im.dataBase64) continue;
    const key = keyOf(im.manufacturer, im.model);
    const bytes = toBytes(Buffer.from(im.dataBase64, "base64"));
    await prisma.modelImage.upsert({
      where: { key },
      update: { manufacturer: im.manufacturer, model: im.model, fileName: im.fileName, data: bytes, filePath: null, mimeType: im.mimeType, fileSize: bytes.length, assigned: true },
      create: { key, manufacturer: im.manufacturer, model: im.model, fileName: im.fileName, data: bytes, filePath: null, mimeType: im.mimeType, fileSize: bytes.length, assigned: true },
    });
    images++;
  }
  return { locations, workUnits, printers, images };
}

// --- HUB: recibe y aplica (Administrator, ver authz) -----------------------
syncRouter.post("/receive", async (req, res) => {
  try {
    const counts = await applyPayload((req.body ?? {}) as SyncPayload);
    res.json({ ok: true, ...counts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "No se pudo aplicar la sincronización." });
  }
});

// --- DESKTOP: empuja su data al hub ----------------------------------------
syncRouter.post("/push", async (req, res) => {
  const rawBase = String(req.body?.serverUrl || centralUrl() || "");
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!rawBase) return res.status(400).json({ error: "No hay un servidor configurado. Indica su URL." });
  const base = safeForwardUrl(rawBase);
  if (!base) return res.status(400).json({ error: "La URL del servidor no es válida o no está permitida." });
  if (!username || !password) return res.status(400).json({ error: "Faltan las credenciales del servidor." });

  try {
    // 1) Autenticar contra el hub.
    const login = await fetchWithTimeout(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
    });
    if (login.status === 401 || login.status === 403) return res.status(login.status).json({ error: "Credenciales del servidor incorrectas o cuenta sin permiso." });
    if (!login.ok) return res.status(502).json({ error: `No se pudo iniciar sesión en el servidor (HTTP ${login.status}).` });
    const token = ((await login.json()) as { token?: string }).token;
    if (!token) return res.status(502).json({ error: "El servidor no devolvió un token." });

    // 2) Enviar la data local.
    const payload = await buildLocalPayload();
    const r = await fetchWithTimeout(`${base}/api/sync/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }, 30000);
    const body = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } & Record<string, number>;
    if (r.status === 403) return res.status(403).json({ error: "Tu cuenta en el servidor no es Administrador (requerido para guardar cambios)." });
    if (!r.ok || !body?.ok) return res.status(502).json({ error: body?.error || `El servidor rechazó la sincronización (HTTP ${r.status}).` });
    res.json({ ok: true, sent: { locations: payload.locations.length, workUnits: payload.workUnits.length, printers: payload.printers.length, images: payload.modelImages.length }, applied: body });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "No se pudo sincronizar con el servidor." });
  }
});
