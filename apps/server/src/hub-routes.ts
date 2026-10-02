/**
 * Estado/versión y auto-actualización del hub (públicos: la pantalla de login
 * los usa sin sesión). Ver hub-update.ts para la lógica.
 */
import { Router } from "express";
import { checkUpdate, applyHubUpdate, isHub } from "./hub-update.js";

export const hubRouter = Router();

// GET /api/hub/version → { isHub, current, available, updateAvailable, updating }
hubRouter.get("/version", async (_req, res) => {
  res.json(await checkUpdate());
});

// POST /api/hub/update → dispara la actualización (solo en un hub y si hay nueva).
hubRouter.post("/update", async (_req, res) => {
  if (!isHub()) return res.status(400).json({ error: "Este servidor no es un hub." });
  const r = await applyHubUpdate();
  if (!r.started) {
    if (r.error === "ya-actualizado") return res.json({ started: false, upToDate: true });
    return res.status(502).json({ error: r.error || "No se pudo iniciar la actualización." });
  }
  res.json({ started: true, to: r.to });
});
