/**
 * Ajustes de la aplicación. GET para cualquier usuario autenticado (la
 * contraseña SMTP se enmascara); PATCH solo Administrator (ver authz).
 */
import { Router } from "express";
import { prisma } from "./db.js";
import { getSettings, toPublicSettings } from "./settings-repo.js";
import { encryptSecret } from "./secrets.js";

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res) => {
  res.json(toPublicSettings(await getSettings()));
});

settingsRouter.patch("/", async (req, res) => {
  await getSettings(); // asegura que exista la fila
  const b = req.body ?? {};
  const num = (v: unknown) => (v === "" || v == null ? undefined : Number(v));
  const str = (v: unknown) => (v === undefined ? undefined : v ? String(v) : null);

  const data: Record<string, unknown> = {
    tonerLowPercent: num(b.tonerLowPercent),
    tonerEmptyPercent: num(b.tonerEmptyPercent),
    costPerPageBw: num(b.costPerPageBw),
    costPerPageColor: num(b.costPerPageColor),
    currency: b.currency != null ? String(b.currency) : undefined,
    replenishDays: num(b.replenishDays),
    alertEmailEnabled: typeof b.alertEmailEnabled === "boolean" ? b.alertEmailEnabled : undefined,
    smtpHost: str(b.smtpHost),
    smtpPort: num(b.smtpPort),
    smtpSecure: typeof b.smtpSecure === "boolean" ? b.smtpSecure : undefined,
    smtpUser: str(b.smtpUser),
    alertFrom: str(b.alertFrom),
    alertTo: str(b.alertTo),
  };
  // La contraseña SMTP solo se actualiza si viene con valor (no se borra al
  // omitir). Se cifra EN REPOSO (AES-256-GCM, ver secrets.ts); el consumidor
  // (mailer) la descifra con getSmtpPassword().
  if (typeof b.smtpPassword === "string" && b.smtpPassword.length > 0) {
    data.smtpPassword = encryptSecret(b.smtpPassword);
  }
  // Quita undefined para no sobrescribir con null accidentalmente.
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];

  const updated = await prisma.appSettings.update({ where: { id: "app" }, data });
  res.json(toPublicSettings(updated));
});
