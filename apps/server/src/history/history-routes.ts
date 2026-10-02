/**
 * Router de historial y reportes (Fase 6, secciones 18/20/30).
 *
 * Se EXPORTA el router; el orquestador lo monta en `index.ts` (p.ej.
 * `app.use("/api/printers", historyRouter)`) y lo documenta en `docs/api.md`.
 * Este módulo NO se monta a sí mismo ni edita `index.ts`.
 *
 * Endpoints (relativos al punto de montaje `/api/printers`):
 *   GET /:id/history            → historial de estado (raw o resúmenes)
 *   GET /:id/history/counters   → historial de contadores (raw o resúmenes)
 *   GET /:id/history/supplies   → serie de niveles de tóner
 *   GET /:id/history/errors     → historial de errores (eventos ERROR)
 *   GET /:id/history.csv        → export CSV (type=status|counters)
 *
 * Query params comunes: `from`, `to` (ISO 8601). Para agregación: `bucket=hour|day`.
 */

import { Router } from "express";
import type { Request } from "express";
import { prisma } from "../db.js";
import {
  getStatusHistory,
  getRecentStatusHistory,
  getCounterHistory,
  getSupplyHistory,
  getErrorHistory,
  type DateRange,
} from "./queries.js";
import {
  summarizeStatusHistory,
  summarizeCounterHistory,
  type BucketUnit,
} from "./aggregation.js";
import { statusHistoryToCsv, counterHistoryToCsv } from "./csv.js";

export const historyRouter = Router();

/** Parsea `from`/`to` de la query. Lanza si una fecha es inválida. */
function parseRange(req: Request): DateRange {
  const range: DateRange = {};
  const { from, to } = req.query;
  if (typeof from === "string" && from) {
    const d = new Date(from);
    if (Number.isNaN(d.getTime())) throw new Error(`Fecha 'from' inválida: ${from}`);
    range.from = d;
  }
  if (typeof to === "string" && to) {
    const d = new Date(to);
    if (Number.isNaN(d.getTime())) throw new Error(`Fecha 'to' inválida: ${to}`);
    range.to = d;
  }
  return range;
}

/** Lee `bucket=hour|day` de la query, o undefined si no se pide agregación. */
function parseBucket(req: Request): BucketUnit | undefined {
  const b = req.query.bucket;
  if (b === "hour" || b === "day") return b;
  return undefined;
}

/** Verifica que la impresora existe; responde 404 si no. Devuelve true si sigue. */
async function ensurePrinter(id: string, res: import("express").Response): Promise<boolean> {
  const printer = await prisma.printer.findUnique({ where: { id }, select: { id: true } });
  if (!printer) {
    res.status(404).json({ error: "Printer not found" });
    return false;
  }
  return true;
}

// --- Historial de estado ---------------------------------------------------
historyRouter.get("/:id/history", async (req, res) => {
  try {
    if (!(await ensurePrinter(req.params.id, res))) return;
    // `limit` sin rango ni bucket: devuelve los N puntos MÁS RECIENTES (panel del detalle).
    const bucket = parseBucket(req);
    const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
    if (!bucket && !req.query.from && !req.query.to && Number.isFinite(limitRaw) && limitRaw > 0) {
      const recent = await getRecentStatusHistory(prisma, req.params.id, Math.min(limitRaw, 1000));
      return res.json({ history: recent });
    }
    const range = parseRange(req);
    const rows = await getStatusHistory(prisma, req.params.id, range);
    if (bucket) {
      return res.json({ bucket, summaries: summarizeStatusHistory(rows, bucket) });
    }
    res.json({ history: rows });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Historial de contadores -----------------------------------------------
historyRouter.get("/:id/history/counters", async (req, res) => {
  try {
    if (!(await ensurePrinter(req.params.id, res))) return;
    const range = parseRange(req);
    const counterType =
      typeof req.query.counterType === "string" ? req.query.counterType : undefined;
    const rows = await getCounterHistory(prisma, req.params.id, range, counterType);
    const bucket = parseBucket(req);
    if (bucket) {
      return res.json({ bucket, summaries: summarizeCounterHistory(rows, bucket) });
    }
    res.json({ history: rows });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Historial de consumibles (tóner) --------------------------------------
historyRouter.get("/:id/history/supplies", async (req, res) => {
  try {
    if (!(await ensurePrinter(req.params.id, res))) return;
    const range = parseRange(req);
    const points = await getSupplyHistory(prisma, req.params.id, range);
    res.json({ history: points });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Historial de errores --------------------------------------------------
historyRouter.get("/:id/history/errors", async (req, res) => {
  try {
    if (!(await ensurePrinter(req.params.id, res))) return;
    const range = parseRange(req);
    const rows = await getErrorHistory(prisma, req.params.id, range);
    res.json({ history: rows });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Export CSV ------------------------------------------------------------
historyRouter.get("/:id/history.csv", async (req, res) => {
  try {
    if (!(await ensurePrinter(req.params.id, res))) return;
    const range = parseRange(req);
    const type = typeof req.query.type === "string" ? req.query.type : "status";

    let csv: string;
    let filename: string;
    if (type === "counters") {
      const rows = await getCounterHistory(prisma, req.params.id, range);
      csv = counterHistoryToCsv(rows);
      filename = `counters-${req.params.id}.csv`;
    } else if (type === "status") {
      const rows = await getStatusHistory(prisma, req.params.id, range);
      csv = statusHistoryToCsv(rows);
      filename = `status-${req.params.id}.csv`;
    } else {
      return res.status(400).json({ error: `type no soportado: ${type} (usa status|counters)` });
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
