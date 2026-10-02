"use client";

/**
 * Ajustes (#5): estado de ejecución + configuración editable por Administrator
 * (umbrales de tóner, costos por página, horizonte "por reponer" y alertas por
 * correo). La contraseña SMTP nunca se muestra (solo se envía si se escribe).
 */
import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { Spinner, ErrorState } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getUser } from "@/lib/auth";
import { applyTonerThreshold } from "@/lib/format";
import type { ApiSettings } from "@/lib/types";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  const health = useAsync(() => api.health(), []);
  const settings = useAsync<ApiSettings>(() => api.getSettings(), []);
  const user = getUser();
  const isAdmin = !user || user.role === "Administrator";

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Importar datos de la central (solo aplica cuando esta máquina apunta a una
  // central/hub; en la propia central `source` es "none" y se oculta la tarjeta).
  const [srv, setSrv] = useState<{ centralUrl: string; source: string } | null>(null);
  const [impUser, setImpUser] = useState(user?.username ?? "");
  const [impPass, setImpPass] = useState("");
  const [impBusy, setImpBusy] = useState(false);
  const [impMsg, setImpMsg] = useState<string | null>(null);
  const [impErr, setImpErr] = useState(false);
  // Sincronizar y guardar: empuja la data local al hub.
  const [syncUser, setSyncUser] = useState(user?.username ?? "");
  const [syncPass, setSyncPass] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState(false);

  useEffect(() => {
    if (settings.data) setForm({ ...settings.data, smtpPassword: "" });
  }, [settings.data]);

  useEffect(() => {
    api.getServer().then(setSrv).catch(() => {});
  }, []);

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    setImpBusy(true);
    setImpMsg(null);
    setImpErr(false);
    try {
      const r = await api.importFromCentral({ username: impUser.trim(), password: impPass });
      setImpMsg(
        t("Importado: {p} impresoras, {l} ubicaciones, {w} unidades, {i} fotos.")
          .replace("{p}", String(r.printers))
          .replace("{l}", String(r.locations))
          .replace("{w}", String(r.workUnits ?? 0))
          .replace("{i}", String(r.images)),
      );
      setImpPass("");
    } catch (err) {
      setImpErr(true);
      setImpMsg(err instanceof Error ? err.message : t("Error al importar."));
    } finally {
      setImpBusy(false);
    }
  }

  async function runSync(e: React.FormEvent) {
    e.preventDefault();
    setSyncBusy(true);
    setSyncMsg(null);
    setSyncErr(false);
    try {
      const r = await api.syncPush({ username: syncUser.trim(), password: syncPass });
      const a = r.applied ?? {};
      setSyncMsg(
        t("Sincronizado al servidor: {p} impresoras, {l} ubicaciones, {w} unidades, {i} fotos.")
          .replace("{p}", String(a.printers ?? 0))
          .replace("{l}", String(a.locations ?? 0))
          .replace("{w}", String(a.workUnits ?? 0))
          .replace("{i}", String(a.images ?? 0)),
      );
      setSyncPass("");
    } catch (err) {
      setSyncErr(true);
      setSyncMsg(err instanceof Error ? err.message : t("No se pudo sincronizar."));
    } finally {
      setSyncBusy(false);
    }
  }

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const updated = await api.updateSettings(form);
      applyTonerThreshold(updated.tonerLowPercent);
      setMsg(t("Ajustes guardados."));
      settings.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("Error al guardar"));
    } finally {
      setBusy(false);
    }
  }

  const statusRows: Array<[string, string]> = [
    ["Backend", health.data?.ok ? t("Operativo") : health.loading ? "…" : t("Sin conexión")],
    [t("Modo SNMP"), health.data ? (health.data.mock ? "MOCK (fixtures)" : t("Real")) : "…"],
    [t("Sesión"), user ? `${user.username} (${user.role})` : t("No autenticado")],
  ];

  const num = (k: string) => (form[k] as number | undefined) ?? "";

  return (
    <>
      <Topbar title="Ajustes" help="Preferencias del sistema: umbral de tóner bajo, intervalos de sondeo y otras opciones generales." />
      <main className="flex-1 space-y-4 p-6">
        {/* Estado */}
        <section className="card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-accent">{t("Estado de ejecución")}</h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            {statusRows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-muted">{k}</dt>
                <dd className="mt-0.5 text-sm">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Importar datos de la central (inventario, ubicaciones, fotos) */}
        {isAdmin && srv && srv.source !== "none" && (
          <section className="card p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-accent">{t("Importar datos de la central")}</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted">
              {t("Trae a esta máquina el inventario de impresoras, las ubicaciones y las fotos por modelo desde la central, para no capturarlos de nuevo. Puedes repetirlo cuando quieras: actualiza lo existente sin duplicar.")}
            </p>
            <p className="mt-2 text-xs text-muted">
              {t("Central")}: <span className="font-mono text-slate-300">{srv.centralUrl}</span>
            </p>
            <form onSubmit={runImport} className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Usuario de la central")}</label>
                <input className="input w-48" value={impUser} onChange={(e) => setImpUser(e.target.value)} autoComplete="username" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Contraseña")}</label>
                <input type="password" className="input w-48" value={impPass} onChange={(e) => setImpPass(e.target.value)} autoComplete="current-password" placeholder="••••••••" />
              </div>
              <button className="btn" disabled={impBusy || !impUser.trim() || !impPass}>
                {impBusy ? t("Importando…") : t("Importar ahora")}
              </button>
            </form>
            {impMsg && (
              <p className={`mt-3 text-xs ${impErr ? "text-danger" : "text-ok"}`}>{impMsg}</p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              {t("Se importan inventario, ubicaciones, unidades de trabajo y fotos. No se copian usuarios ni el historial; los niveles de tóner y contadores se actualizan solos al sondear.")}
            </p>
          </section>
        )}

        {/* Sincronizar y guardar: empuja la data local al hub de la sede */}
        {isAdmin && srv && srv.source !== "none" && (
          <section className="card p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-accent">{t("Sincronizar y guardar en el servidor")}</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted">
              {t("Envía la data de esta máquina (inventario, ubicaciones, unidades de trabajo y fotos) al servidor de la sede, para que los demás usuarios la vean al importar. Fusiona: agrega y actualiza, no borra.")}
            </p>
            <p className="mt-2 text-xs text-muted">
              {t("Servidor")}: <span className="font-mono text-slate-300">{srv.centralUrl}</span>
            </p>
            <form onSubmit={runSync} className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Usuario del servidor")}</label>
                <input className="input w-48" value={syncUser} onChange={(e) => setSyncUser(e.target.value)} autoComplete="username" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Contraseña")}</label>
                <input type="password" className="input w-48" value={syncPass} onChange={(e) => setSyncPass(e.target.value)} autoComplete="current-password" placeholder="••••••••" />
              </div>
              <button className="btn" disabled={syncBusy || !syncUser.trim() || !syncPass}>
                {syncBusy ? t("Sincronizando…") : t("Sincronizar y guardar")}
              </button>
            </form>
            {syncMsg && (
              <p className={`mt-3 text-xs ${syncErr ? "text-danger" : "text-ok"}`}>{syncMsg}</p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              {t("Requiere que tu cuenta en el servidor sea Administrador. Las demás máquinas verán estos cambios al usar \"Importar datos de la central\".")}
            </p>
          </section>
        )}

        {settings.loading && <Spinner />}
        {settings.error && <ErrorState message={settings.error} />}

        {settings.data && (
          <form onSubmit={save} className="space-y-4">
            {/* Umbrales de tóner */}
            <section className="card p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-accent">{t("Umbrales de tóner")}</h2>
              <p className="mt-1 text-xs text-muted">
                {t("Controlan cuándo un tóner se marca en rojo y cuándo se genera la alerta correspondiente.")}
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t("Tóner bajo (%)")}>
                  <input type="number" min={0} max={100} className="input w-full" value={num("tonerLowPercent")} onChange={(e) => set("tonerLowPercent", e.target.value)} disabled={!isAdmin} />
                </Field>
                <Field label={t("Tóner agotado (%)")}>
                  <input type="number" min={0} max={100} className="input w-full" value={num("tonerEmptyPercent")} onChange={(e) => set("tonerEmptyPercent", e.target.value)} disabled={!isAdmin} />
                </Field>
              </div>
            </section>

            {isAdmin ? (
              <div className="flex items-center gap-3">
                <button className="btn" disabled={busy}>{busy ? t("Guardando…") : t("Guardar ajustes")}</button>
                {msg && <span className="text-xs text-muted">{msg}</span>}
              </div>
            ) : (
              <p className="text-xs text-muted">{t("Necesitas rol Administrator para editar los ajustes.")}</p>
            )}
          </form>
        )}
      </main>
    </>
  );
}
