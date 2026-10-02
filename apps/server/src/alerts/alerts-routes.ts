/**
 * Router de alertas (Fase 5, secciones 17/20/29).
 *
 * Se EXPORTA el router; el orquestador lo monta en `index.ts`
 * (`app.use("/api/alerts", alertsRouter)`) y lo documenta en `docs/api.md`.
 *
 * Endpoints (relativos al punto de montaje `/api/alerts`):
 *   GET  /                 → lista de alertas (status=active|resolved|all, printerId?)
 *   POST /:id/ack          → reconoce una alerta (ack codificado en `source`)
 *   POST /:id/resolve      → marca una alerta como resuelta
 */
import { Router } from "express";
import { prisma } from "../db.js";
import { decodeSource, encodeSource } from "./engine.js";

export const alertsRouter = Router();

/** Proyecta un PrinterEvent a la forma pública (decodifica key/ack de source). */
function toPublic(e: {
  id: string;
  printerId: string;
  severity: string;
  type: string;
  message: string;
  source: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  printer?: {
    name: string;
    ipAddress: string;
    manufacturer: string;
    model: string | null;
    location: { name: string } | null;
  } | null;
}) {
  const { key, ackAt } = decodeSource(e.source);
  return {
    id: e.id,
    printerId: e.printerId,
    severity: e.severity,
    type: e.type,
    message: e.message,
    conditionKey: key,
    acknowledgedAt: ackAt,
    createdAt: e.createdAt,
    resolvedAt: e.resolvedAt,
    active: e.resolvedAt === null,
    // Datos de la impresora afectada (para identificarla en la UI).
    printer: e.printer
      ? {
          name: e.printer.name,
          ip: e.printer.ipAddress,
          manufacturer: e.printer.manufacturer,
          model: e.printer.model,
          location: e.printer.location?.name ?? null,
        }
      : null,
  };
}

/** Incluye datos de la impresora en las consultas de eventos. */
const PRINTER_INCLUDE = {
  printer: {
    select: {
      name: true,
      ipAddress: true,
      manufacturer: true,
      model: true,
      location: { select: { name: true } },
    },
  },
} as const;

// --- Listado ---------------------------------------------------------------
alertsRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "active";
  const printerId = typeof req.query.printerId === "string" ? req.query.printerId : undefined;

  const where: Record<string, unknown> = {};
  if (printerId) where.printerId = printerId;
  if (status === "active") where.resolvedAt = null;
  else if (status === "resolved") where.resolvedAt = { not: null };
  // status === "all" => sin filtro de resolvedAt

  const rows = await prisma.printerEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: PRINTER_INCLUDE,
  });
  res.json(rows.map(toPublic));
});

// --- Ack -------------------------------------------------------------------
alertsRouter.post("/:id/ack", async (req, res) => {
  const event = await prisma.printerEvent.findUnique({ where: { id: req.params.id } });
  if (!event) return res.status(404).json({ error: "Alert not found" });

  const { key } = decodeSource(event.source);
  const updated = await prisma.printerEvent.update({
    where: { id: event.id },
    data: { source: encodeSource(key, new Date()) },
    include: PRINTER_INCLUDE,
  });
  res.json(toPublic(updated));
});

// --- Resolución ------------------------------------------------------------
alertsRouter.post("/:id/resolve", async (req, res) => {
  const event = await prisma.printerEvent.findUnique({ where: { id: req.params.id } });
  if (!event) return res.status(404).json({ error: "Alert not found" });

  const updated = await prisma.printerEvent.update({
    where: { id: event.id },
    data: { resolvedAt: event.resolvedAt ?? new Date() },
    include: PRINTER_INCLUDE,
  });
  res.json(toPublic(updated));
});
