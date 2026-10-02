/**
 * Router de unidades de trabajo. Espejo de locations-routes: CRUD mínimo para
 * que el frontend liste, cree y elimine unidades de trabajo y clasifique la flota.
 */
import { Router } from "express";
import { prisma } from "./db.js";

export const workUnitsRouter = Router();

workUnitsRouter.get("/", async (_req, res) => {
  const workUnits = await prisma.workUnit.findMany({ orderBy: { name: "asc" } });
  res.json(workUnits);
});

workUnitsRouter.post("/", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Falta el campo 'name'" });
  try {
    const workUnit = await prisma.workUnit.create({
      data: { name, description: req.body?.description ?? null },
    });
    res.status(201).json(workUnit);
  } catch {
    res.status(409).json({ error: `La unidad de trabajo '${name}' ya existe` });
  }
});

// Editar (renombrar / cambiar descripción) una unidad de trabajo.
workUnitsRouter.patch("/:id", async (req, res) => {
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
    const workUnit = await prisma.workUnit.update({ where: { id: req.params.id }, data });
    res.json(workUnit);
  } catch (e) {
    // Nombre duplicado → 409; cualquier otro fallo (no existe) → 404.
    const code = (e as { code?: string })?.code;
    if (code === "P2002") return res.status(409).json({ error: `La unidad de trabajo '${data.name}' ya existe` });
    res.status(404).json({ error: "Unidad de trabajo no encontrada" });
  }
});

// Eliminar una unidad de trabajo. Las impresoras que la referencian quedan con
// workUnitId = null (relación opcional), no se borran.
workUnitsRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.printer.updateMany({
      where: { workUnitId: req.params.id },
      data: { workUnitId: null },
    });
    await prisma.workUnit.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "Unidad de trabajo no encontrada" });
  }
});
