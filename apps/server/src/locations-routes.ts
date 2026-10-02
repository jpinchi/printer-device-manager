/**
 * Router de ubicaciones (sección 20/24). CRUD mínimo para que el frontend pueda
 * listar y crear ubicaciones y agrupar la flota.
 */
import { Router } from "express";
import { prisma } from "./db.js";

export const locationsRouter = Router();

locationsRouter.get("/", async (_req, res) => {
  const locations = await prisma.location.findMany({ orderBy: { name: "asc" } });
  res.json(locations);
});

locationsRouter.post("/", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Falta el campo 'name'" });
  try {
    const location = await prisma.location.create({
      data: { name, description: req.body?.description ?? null },
    });
    res.status(201).json(location);
  } catch {
    res.status(409).json({ error: `La ubicación '${name}' ya existe` });
  }
});

// Editar (renombrar / cambiar descripción) una ubicación.
locationsRouter.patch("/:id", async (req, res) => {
  const data: { name?: string; description?: string | null } = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "Falta el campo 'name'" });
    data.name = name;
  }
  if (req.body?.description !== undefined) {
    const d = String(req.body.description ?? "").trim();
    data.description = d || null;
  }
  try {
    const location = await prisma.location.update({ where: { id: req.params.id }, data });
    res.json(location);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "P2002") return res.status(409).json({ error: `La ubicación '${data.name}' ya existe` });
    res.status(404).json({ error: "Ubicación no encontrada" });
  }
});

// Eliminar una ubicación. Las impresoras que la referencian quedan con
// locationId = null (relación opcional → SetNull), no se borran.
locationsRouter.delete("/:id", async (req, res) => {
  try {
    // Desvincula primero las impresoras (robusto ante la acción FK del motor).
    await prisma.printer.updateMany({
      where: { locationId: req.params.id },
      data: { locationId: null },
    });
    await prisma.location.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "Ubicación no encontrada" });
  }
});
