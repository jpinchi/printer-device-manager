/**
 * Servidor HTTP del Printer Device Manager (Oleada 0 / MVP).
 *
 * Expone el subconjunto de la API de la sección 20 necesario para el slice
 * vertical, y sirve un dashboard mínimo. NestJS y el frontend Next.js completo
 * llegan en oleadas posteriores; esta app prueba el flujo end-to-end.
 */
import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import type { SnmpCredentials } from "@pdm/types";
import { probe } from "@pdm/snmp-core";
import { config } from "./config.js";
import { prisma, initDb, ensureSchema, pingDb } from "./db.js";
import { HttpError, isDbUnavailable } from "./http-errors.js";
import { log } from "./log.js";
import type { ErrorRequestHandler } from "express";
import {
  saveProbe,
  getPrinter,
  getPrinterCommunity,
  listPrinters,
  deletePrinter,
} from "./printers-repo.js";
import { OMIT_COMMUNITY } from "./printer-community.js";
import { startPolling, pollingConfig, runPollingCycle } from "./polling/index.js";
import { discoveryRouter } from "./discovery-routes.js";
import {
  alertsRouter,
  runAlertEvaluationCycle,
  evaluateAndPersist,
  type PrinterStateSnapshot,
} from "./alerts/index.js";
import { historyRouter } from "./history/index.js";
import { driversRouter } from "./drivers-routes.js";
import { settingsRouter } from "./settings-routes.js";
import { getThresholds, ensureSettings } from "./settings-repo.js";
import { runRetention, DEFAULT_RETENTION_POLICY } from "./history/retention.js";
import { modelImagesRouter, backfillModelImages } from "./model-images-routes.js";
import { networkRouter } from "./network-routes.js";
import { desktopRouter } from "./desktop-routes.js";
import { remoteInstallRouter } from "./remote-install-routes.js";
import { locationsRouter } from "./locations-routes.js";
import { workUnitsRouter } from "./workunits-routes.js";
import { importRouter } from "./import-routes.js";
import { syncRouter } from "./sync-routes.js";
import { hubRouter } from "./hub-routes.js";
import { isHub, applyHubUpdate } from "./hub-update.js";
import { usersRouter } from "./users-routes.js";
import { authRouter, usingDevSecret } from "./auth/index.js";
import { authorize } from "./authz.js";
import { createRealtime, type Realtime } from "./realtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_ENFORCE = process.env.AUTH_ENFORCE === "true";

// Guardarraíl de seguridad: con auth activa, NUNCA usar el secreto de firma por
// defecto (está en el código fuente → cualquiera podría forjar un token de
// Administrator). Si falta SESSION_SECRET, se rechaza el arranque.
if (usingDevSecret) {
  if (AUTH_ENFORCE) {
    console.error(
      "\n⛔ SEGURIDAD: AUTH_ENFORCE=true pero SESSION_SECRET no está definido (se usaría el secreto por defecto del código).\n" +
        "   Los tokens serían falsificables. Define un SESSION_SECRET aleatorio y fuerte en .env, p. ej.:\n" +
        "     node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"\n" +
        "   y reinicia. Arranque abortado.\n",
    );
    process.exit(1);
  } else {
    console.warn("⚠ SESSION_SECRET sin definir: usando secreto de desarrollo (solo válido sin AUTH_ENFORCE).");
  }
}

const app = express();
// La sincronización envía fotos (base64) → cuerpo grande solo en /api/sync.
// Debe ir ANTES del json global (256kb) para que no lo rechace primero.
app.use("/api/sync", express.json({ limit: "30mb" }));
app.use(express.json({ limit: "256kb" }));

// Cabeceras de seguridad base (sin dependencias): evitan sniffing de tipo,
// clickjacking y fuga de referrer. El SPA se sirve del mismo origen.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// Tiempo real (sección 19): se inicializa tras app.listen; las rutas emiten
// "printers:changed" a través de esta referencia.
let realtime: Realtime | null = null;
const notifyChange = (reason: string) =>
  realtime?.broadcast({ type: "printers:changed", reason, at: new Date().toISOString() });

// --- Autorización por roles (secciones 23-24), activable por AUTH_ENFORCE ---
// Cuando está activa, protege TODA la API (salvo /api/health y /api/auth/*)
// según la tabla de roles de authz.ts. Va ANTES de los routers de dominio.
if (AUTH_ENFORCE) app.use(authorize);
else if (config.host !== "127.0.0.1" && config.host !== "localhost") {
  console.warn(
    `⚠ SEGURIDAD: AUTH_ENFORCE≠true y el servidor escucha en ${config.host} — la API está SIN autenticar y accesible por la red. ` +
      "Usa AUTH_ENFORCE=true (con SESSION_SECRET) en producción.",
  );
}

// --- Routers por dominio (Oleadas 1-3) ---
app.use("/api/auth", authRouter); // Auth (secciones 23-24) — público
app.use("/api/discovery", discoveryRouter); // Fase 2
app.use("/api/alerts", alertsRouter); // Fase 5
app.use("/api/locations", locationsRouter); // Fase 3
app.use("/api/workunits", workUnitsRouter); // Unidades de trabajo
app.use("/api/users", usersRouter); // Administración de usuarios (admin-only)
app.use("/api/printers", historyRouter); // Fase 6 — rutas /:id/history*
app.use("/api/drivers", driversRouter); // Catálogo de drivers (A+B+C)
app.use("/api/settings", settingsRouter); // Ajustes de la app (#5)
app.use("/api/model-images", modelImagesRouter); // Fotos por modelo
app.use("/api/network", networkRouter); // Utilidades de red (escáner de IPs)
app.use("/api/desktop", desktopRouter); // Descarga de la app de escritorio
app.use("/api/remote-install", remoteInstallRouter); // Instalación remota de drivers (WinRM)
app.use("/api/import", importRouter); // Importar inventario/ubicaciones/fotos desde la central
app.use("/api/sync", syncRouter); // Sincronización Desktop ↔ hub (push/receive)
app.use("/api/hub", hubRouter); // Versión / auto-update del hub (público)

function credsFrom(body: Record<string, unknown>): SnmpCredentials {
  return {
    version: (body.version as SnmpCredentials["version"]) ?? config.snmp.defaultVersion,
    community: (body.community as string) ?? config.snmp.defaultCommunity,
    timeoutMs: config.snmp.timeoutMs,
    retries: config.snmp.retries,
  };
}

/** Instantánea para el motor de alertas a partir de un ProbeResult. */
function stateFromProbe(result: Awaited<ReturnType<typeof probe>>): PrinterStateSnapshot {
  return {
    online: result.status.online,
    conditions: result.status.conditions,
    supplies: result.supplies.map((s) => ({
      name: s.name,
      type: s.type,
      color: s.color,
      percent: s.percent,
      level: s.level,
    })),
  };
}

/** Evalúa/persiste alertas de una impresora sin bloquear la respuesta HTTP. */
function evaluateAlertsFor(printerId: string, result: Awaited<ReturnType<typeof probe>>): void {
  getThresholds()
    .then((thresholds) => evaluateAndPersist(prisma, printerId, { state: stateFromProbe(result), thresholds }))
    .catch((err) =>
      console.error("[alerts] evaluación tras probe:", err instanceof Error ? err.message : err),
  );
}

// --- Salud ---
// Health con estado REAL de la BD (SELECT 1 con timeout corto). Devuelve 200
// mientras el servidor HTTP responda (para chequeos de arranque), pero informa
// `db:false` si la base de datos no responde (detecta cuelgues como el del
// incidente de "Socket timeout").
app.get("/api/health", async (_req, res) => {
  const db = await pingDb();
  res.json({ ok: true, db, mock: config.snmp.mock, time: new Date().toISOString() });
});

// --- SNMP: configuración efectiva (solo lectura) ---
// La community va ENMASCARADA (nunca se expone completa al navegador).
app.get("/api/snmp/config", (_req, res) => {
  const c = config.snmp;
  const mask = (s: string): string =>
    !s ? "" : s.length <= 2 ? "••" : s.slice(0, 2) + "•".repeat(Math.min(6, Math.max(2, s.length - 2)));
  res.json({
    version: c.defaultVersion,
    community: mask(c.defaultCommunity),
    timeoutMs: c.timeoutMs,
    retries: c.retries,
    mock: c.mock,
    polling: { enabled: pollingConfig.enabled, intervals: pollingConfig.intervals },
  });
});

// --- SNMP: prueba de conectividad de una IP (diagnóstico, sin guardar) ---
app.post("/api/snmp/test", async (req, res) => {
  const ip = typeof req.body?.ip === "string" ? req.body.ip.trim() : "";
  if (!ip) return res.status(400).json({ error: "Falta la dirección IP" });
  const creds = credsFrom(req.body ?? {});
  try {
    const r = await probe(ip, creds, { mock: config.snmp.mock });
    res.json({
      ip,
      reachable: r.reachable,
      isPrinter: r.isPrinter,
      manufacturer: r.info.manufacturer,
      model: r.info.model ?? null,
      serialNumber: r.info.serialNumber ?? null,
      sysDescr: r.info.sysDescr ?? null,
      sysObjectId: r.info.sysObjectId ?? null,
      uptimeSeconds: r.info.uptimeSeconds ?? null,
      status: r.status.online,
      supplies: r.supplies.length,
      trays: r.trays.length,
      counters: r.counters.map((c) => ({ type: c.type, value: c.value })),
      failedOids: r.errors.length,
      queriedAt: r.queriedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Inventario ---
app.get("/api/printers", async (_req, res) => {
  res.json(await listPrinters());
});

app.get("/api/printers/:id", async (req, res) => {
  const printer = await getPrinter(req.params.id);
  if (!printer) return res.status(404).json({ error: "Printer not found" });
  res.json(printer);
});

// Descubrir + guardar una impresora por IP (POST /api/printers).
app.post("/api/printers", async (req, res) => {
  const ip = String(req.body?.ip ?? "").trim();
  if (!ip) return res.status(400).json({ error: "Falta el campo 'ip'" });

  const creds = credsFrom(req.body ?? {});
  const explicitCommunity = typeof req.body?.community === "string" && req.body.community ? req.body.community : undefined;
  try {
    const result = await probe(ip, creds, { mock: config.snmp.mock });
    if (!result.reachable) {
      return res.status(422).json({ error: `No hubo respuesta SNMP de ${ip}`, probe: result });
    }
    const saved = await saveProbe(result, explicitCommunity, creds.version);
    if (saved) evaluateAlertsFor(saved.id, result);
    notifyChange("printer-added");
    res.status(201).json({ printer: saved, probe: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Re-consultar TODAS las impresoras por SNMP (POST /api/printers/poll-all).
// Ejecuta un ciclo de polling completo bajo demanda y reevalúa alertas.
// Guarda de exclusión: evita que varias peticiones lancen barridos COMPLETOS
// solapados (N×concurrencia de escritores compitiendo por SQLite).
let pollAllRunning = false;
app.post("/api/printers/poll-all", async (_req, res) => {
  if (pollAllRunning) {
    return res.status(429).json({ error: "Ya hay un sondeo de la flota en curso." });
  }
  pollAllRunning = true;
  try {
    const report = await runPollingCycle(prisma, { mock: config.snmp.mock });
    await runAlertEvaluationCycle(prisma, { thresholds: await getThresholds() }).catch(() => undefined);
    notifyChange("poll-all");
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    pollAllRunning = false;
  }
});

// Re-consultar una impresora existente (POST /api/printers/:id/poll).
app.post("/api/printers/:id/poll", async (req, res) => {
  const printer = await getPrinter(req.params.id);
  if (!printer) return res.status(404).json({ error: "Printer not found" });

  const creds = credsFrom({ version: printer.snmpVersion, community: await getPrinterCommunity(printer.id) });
  try {
    const result = await probe(printer.ipAddress, creds, { mock: config.snmp.mock });
    const saved = await saveProbe(result, undefined, creds.version);
    evaluateAlertsFor(printer.id, result);
    notifyChange("printer-polled");
    res.json({ printer: saved, probe: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Asignar / cambiar la ubicación y/o la unidad de trabajo de una impresora
// (PATCH /api/printers/:id). Acepta 'locationId' y/o 'workUnitId'.
app.patch("/api/printers/:id", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const hasLocation = "locationId" in body;
  const hasWorkUnit = "workUnitId" in body;
  if (!hasLocation && !hasWorkUnit) {
    return res.status(400).json({ error: "Nada que actualizar (envía 'locationId' o 'workUnitId')" });
  }
  const norm = (v: unknown) => (v === null || v === "" ? null : String(v));
  const data: { locationId?: string | null; workUnitId?: string | null } = {};
  try {
    if (hasLocation) {
      const locationId = norm(body.locationId);
      if (locationId) {
        const loc = await prisma.location.findUnique({ where: { id: locationId } });
        if (!loc) return res.status(400).json({ error: "Ubicación no encontrada" });
      }
      data.locationId = locationId;
    }
    if (hasWorkUnit) {
      const workUnitId = norm(body.workUnitId);
      if (workUnitId) {
        const wu = await prisma.workUnit.findUnique({ where: { id: workUnitId } });
        if (!wu) return res.status(400).json({ error: "Unidad de trabajo no encontrada" });
      }
      data.workUnitId = workUnitId;
    }
    const updated = await prisma.printer.update({
      where: { id: req.params.id },
      data,
      omit: OMIT_COMMUNITY,
      include: { location: true, workUnit: true, supplies: true },
    });
    notifyChange("printer-updated");
    res.json(updated);
  } catch {
    res.status(404).json({ error: "Printer not found" });
  }
});

app.delete("/api/printers/:id", async (req, res) => {
  try {
    await deletePrinter(req.params.id);
    notifyChange("printer-deleted");
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "Printer not found" });
  }
});

// --- Frontend ---
// En producción, el frontend Next.js se exporta a `apps/web/out` y se sirve
// desde ESTE mismo puerto (una sola dirección para toda la LAN). Si no está
// compilado, se sirve el dashboard mínimo de respaldo (public/).
// Ruta del frontend estático. Override por env (PDM_WEB_OUT) para el empaquetado
// de escritorio, donde `apps/web/out` no está junto al código del servidor.
const webOut = process.env.PDM_WEB_OUT
  ? path.resolve(process.env.PDM_WEB_OUT)
  : path.resolve(__dirname, "../../web/out");
if (fs.existsSync(path.join(webOut, "index.html"))) {
  app.use(express.static(webOut, { extensions: ["html"] }));
  // Fallback de enrutado en cliente: cualquier GET no-API sin archivo → index.html.
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      res.sendFile(path.join(webOut, "index.html"));
    } else {
      next();
    }
  });
  console.log(`[web] frontend estático servido desde ${webOut}`);
} else {
  app.use("/", express.static(path.join(__dirname, "public")));
  console.log("[web] Next no compilado; sirviendo dashboard mínimo (public/). Ejecuta 'npm run build:web'.");
}

// --- Manejador de error CENTRAL (después de TODAS las rutas) ---
// Distingue BD no disponible (503) de errores de negocio (HttpError) y de bugs
// (500), y NUNCA filtra el stack al cliente (se loguea en el servidor).
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (isDbUnavailable(err)) {
    log.error("db-unavailable", { path: req.path, method: req.method, cause: err instanceof Error ? err.message : String(err) });
    res.status(503).json({ error: "Servicio no disponible (base de datos)" });
    return;
  }
  log.error("unhandled", { path: req.path, method: req.method, cause: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  res.status(500).json({ error: "Error interno" });
};
app.use(errorHandler);

const server = app.listen(config.port, config.host, () => {
  const mode = config.snmp.mock ? " [MOCK SNMP]" : "";
  const authMode = AUTH_ENFORCE ? " [AUTH ENFORCED]" : "";
  console.log(
    `Printer Device Manager escuchando en http://${config.host}:${config.port}${mode}${authMode} · db=${process.env.DATABASE_URL ?? "(prisma default)"}`,
  );
});
// Timeouts del servidor HTTP: acotan clientes lentos/colgados (defensa básica).
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 20_000;

// --- Tiempo real (sección 19) ---
realtime = createRealtime(server);

// --- Motor de polling (Fase 4) — protegido por POLLING_ENABLED ---
// Cada ciclo que actualiza impresoras difunde el cambio por WebSocket.
// Crea la fila de ajustes una sola vez (evita que getSettings escriba en el
// camino caliente; ver settings-repo.getSettings).
// Aplica los PRAGMAs de robustez de SQLite (WAL, busy_timeout…) ANTES de tocar
// la BD, y luego asegura la fila de ajustes.
initDb()
  // Migra el esquema de BD de usuarios ya instaladas (añade columnas que falten)
  // ANTES de tocar tablas: sin esto, una BD vieja daba 500 en el login tras
  // actualizar (faltaban recoveryCodeHash/mustChangePassword).
  .then(() => ensureSchema())
  .then(() => ensureSettings())
  // Migra a la BD las fotos por modelo que aún vivan solo en disco (idempotente).
  .then(() => backfillModelImages())
  .catch((e) => console.error("[startup] initDb/ensureSchema/ensureSettings:", e instanceof Error ? e.message : e));

// Auto-update del HUB: si este proceso es un hub, chequea al arrancar (a los 2
// min, para no competir con el arranque) y cada 6 h; si hay versión nueva, se
// reinstala y reinicia solo (ver hub-update.ts). En Desktop/central no hace nada.
if (isHub()) {
  const tick = () => applyHubUpdate().catch(() => undefined);
  setTimeout(tick, 2 * 60 * 1000).unref?.();
  setInterval(tick, 6 * 60 * 60 * 1000).unref?.();
}

// --- Poda de historial (retención) — evita que las tablas crezcan sin límite ---
// Diario (con jitter inicial pequeño). Estado 30 días, eventos 180; contadores
// con tope de 1 año (el default es "largo plazo", pero acotamos para no crecer
// indefinidamente). El timer no mantiene vivo el proceso (.unref()).
const RETENTION_POLICY = { ...DEFAULT_RETENTION_POLICY, counterDays: 365 };
async function retentionSweep() {
  try {
    const r = await runRetention(prisma, RETENTION_POLICY);
    console.log(
      `[retención] podadas: estado=${r.statusHistoryDeleted} eventos=${r.eventsDeleted} contadores=${r.countersDeleted}`,
    );
  } catch (err) {
    console.error("[retención] error:", err instanceof Error ? err.message : err);
  }
}
const retentionTimer = setInterval(retentionSweep, 24 * 60 * 60 * 1000);
retentionTimer.unref?.();
// Primera poda a los 60s del arranque (no bloquear el arranque).
const retentionKick = setTimeout(retentionSweep, 60_000);
retentionKick.unref?.();

const polling = pollingConfig.enabled
  ? startPolling(prisma, {
      onCycle: () => {
        // Tras cada ciclo, reevaluar alertas de toda la flota (offline, tóner…)
        // con los umbrales configurados en Ajustes.
        getThresholds()
          .then((thresholds) => runAlertEvaluationCycle(prisma, { thresholds }))
          .catch((err) => console.error("[alerts] ciclo:", err instanceof Error ? err.message : err));
        notifyChange("polling-cycle");
      },
    })
  : null;

async function shutdown() {
  console.log("Cerrando...");
  polling?.stop();
  clearInterval(retentionTimer);
  clearTimeout(retentionKick);
  realtime?.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Red de seguridad a nivel proceso: que un error async suelto NO deje el
// servidor en un estado zombi. Los rechazos no manejados se registran (sin
// tumbar el proceso); una excepción no capturada se registra y se sale limpio
// para que la tarea programada («PDM Install Hub»/«PDM Central Server») lo
// reinicie con estado fresco (RestartCount alto).
// Se registran (con el logger estructurado) pero NO se tumba el proceso: en un
// servidor de monitoreo siempre-activo conviene mantenerlo vivo y visible antes
// que reiniciar en bucle. Las rutas (Express 5) y el trabajo de fondo ya tienen
// sus propios catch; esto es solo una red de seguridad.
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", { cause: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason) });
});
process.on("uncaughtException", (err) => {
  log.error("uncaughtException", { cause: err instanceof Error ? (err.stack ?? err.message) : String(err) });
});
