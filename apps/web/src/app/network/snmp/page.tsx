"use client";

/**
 * SNMP Settings.
 *
 * 1) Configuración efectiva del servidor (solo lectura; se define por variables
 *    de entorno). La community llega ENMASCARADA desde el backend.
 * 2) Cadencia de polling: cada cuánto se sondea cada tipo de dato.
 * 3) Prueba de conectividad: consulta por SNMP una IP y muestra qué responde
 *    (diagnóstico, sin guardar nada).
 */
import { useState } from "react";
import { HelpTip } from "@/components/HelpTip";
import { Topbar } from "@/components/Topbar";
import { IpLink } from "@/components/IpLink";
import { Spinner } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiSnmpTest } from "@/lib/types";
import { fmtNumber, fmtUptime } from "@/lib/format";

/** ms → texto legible (s / min / h). */
function fmtInterval(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 120) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h} h`;
}

function Stat({ label, value, tone = "text-slate-100" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-sunken p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 font-mono text-sm ${tone}`}>{value}</div>
    </div>
  );
}

export default function SnmpSettingsPage() {
  const { t } = useI18n();
  const cfg = useAsync(() => api.snmpConfig(), []);

  // Formulario de prueba.
  const [ip, setIp] = useState("");
  const [community, setCommunity] = useState("public");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ApiSnmpTest | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTest(e: React.FormEvent) {
    e.preventDefault();
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.snmpTest({ ip: ip.trim(), community: community.trim(), version: "v2c" });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Error en la prueba"));
    } finally {
      setTesting(false);
    }
  }

  const iv = cfg.data?.polling.intervals;
  const INTERVALS: Array<{ key: keyof NonNullable<typeof iv>; label: string; desc: string }> = [
    { key: "status", label: "Estado", desc: "En línea / fuera de línea" },
    { key: "errors", label: "Errores", desc: "Condiciones de error del equipo" },
    { key: "supplies", label: "Consumibles", desc: "Niveles de tóner / tinta" },
    { key: "trays", label: "Bandejas", desc: "Papel y capacidad" },
    { key: "counters", label: "Contadores", desc: "Páginas impresas" },
    { key: "deviceInfo", label: "Info del equipo", desc: "Modelo, serie, firmware, uptime" },
  ];

  return (
    <>
      <Topbar title="Ajustes SNMP" help="Comunidad SNMP (por defecto «public»), versión y tiempos de espera que el servidor usa para consultar las impresoras." />
      <main className="flex-1 space-y-4 p-6">
        {/* 1) Configuración efectiva */}
        <section className="card p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-accent">
            {t("Configuración efectiva")}
            <HelpTip
              title="SNMP y la community"
              body="SNMP es el protocolo con el que el sistema le pregunta a las impresoras su estado (tóner, contadores, etc.). La community es como una contraseña compartida: «public» (por defecto) para leer y «private» para escribir. Se configura por variables de entorno del servidor y se muestra enmascarada; nunca se expone completa al navegador."
            />
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            {t("Valores actuales del servidor (solo lectura). Se definen por variables de entorno. La community se muestra enmascarada y nunca se expone completa al navegador.")}
          </p>
          {cfg.loading ? (
            <div className="mt-4"><Spinner /></div>
          ) : cfg.error ? (
            <p className="mt-4 text-xs text-danger">{cfg.error}</p>
          ) : cfg.data ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={t("Versión")} value={cfg.data.version} tone="text-accent" />
              <Stat label="Community" value={cfg.data.community || "—"} />
              <Stat label="Timeout" value={`${cfg.data.timeoutMs} ms`} />
              <Stat label={t("Reintentos")} value={cfg.data.retries} />
              <Stat
                label={t("Modo")}
                value={cfg.data.mock ? "MOCK" : "Real"}
                tone={cfg.data.mock ? "text-warn" : "text-ok"}
              />
              <Stat
                label="Polling"
                value={cfg.data.polling.enabled ? t("Activo") : t("Inactivo")}
                tone={cfg.data.polling.enabled ? "text-ok" : "text-slate-400"}
              />
            </div>
          ) : null}
        </section>

        {/* 2) Cadencia de polling */}
        <section className="card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-accent">{t("Cadencia de sondeo (polling)")}</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            {t("Cada cuánto se actualiza automáticamente cada tipo de dato de la flota.")}
          </p>
          {iv ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                    <th className="py-2 text-left">{t("Dato")}</th>
                    <th className="py-2 text-left">{t("Descripción")}</th>
                    <th className="py-2 text-right">{t("Frecuencia")}</th>
                  </tr>
                </thead>
                <tbody>
                  {INTERVALS.map((row) => (
                    <tr key={row.key} className="border-b border-border/60 last:border-0">
                      <td className="py-2 font-medium text-slate-200">{t(row.label)}</td>
                      <td className="py-2 text-xs text-muted">{t(row.desc)}</td>
                      <td className="py-2 text-right font-mono text-slate-300">{fmtInterval(iv[row.key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!cfg.data?.polling.enabled && (
                <p className="mt-2 text-[11px] text-warn">
                  {t("El polling automático está inactivo. Los datos se actualizan solo con \"Poll\" manual.")}
                </p>
              )}
            </div>
          ) : (
            !cfg.loading && <p className="mt-4 text-xs text-muted">—</p>
          )}
        </section>

        {/* 3) Prueba de conectividad */}
        <section className="card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-accent">{t("Probar conectividad SNMP")}</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            {t("Consulta una IP por SNMP (v2c) y muestra qué responde. Es un diagnóstico: no guarda ni agrega la impresora.")}
          </p>
          <form onSubmit={runTest} className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Dirección IP")}</label>
              <input className="input w-48" placeholder="192.0.2.51" value={ip} onChange={(e) => setIp(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">Community</label>
              <input className="input w-40" value={community} onChange={(e) => setCommunity(e.target.value)} />
            </div>
            <button className="btn" disabled={testing || !ip.trim()}>
              {testing ? t("Probando…") : t("Probar")}
            </button>
          </form>

          {error && <p className="mt-3 text-xs text-danger">{error}</p>}

          {result && (
            <div className="mt-4 rounded-xl border border-border bg-sunken p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    result.reachable ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${result.reachable ? "bg-ok" : "bg-danger"}`} />
                  {result.reachable ? t("Responde") : t("Sin respuesta")}
                </span>
                <IpLink ip={result.ip} className="text-sm text-slate-200" />
                {result.reachable && (
                  <span className="text-xs text-muted">
                    {result.isPrinter ? t("✅ Es una impresora") : t("No parece impresora")}
                  </span>
                )}
              </div>

              {result.reachable ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label={t("Fabricante")} value={result.manufacturer} />
                  <Stat label={t("Modelo")} value={result.model ?? "—"} />
                  <Stat label={t("Nº de serie")} value={result.serialNumber ?? "—"} />
                  <Stat label={t("Estado")} value={result.status} tone={result.status === "ONLINE" ? "text-ok" : "text-slate-300"} />
                  <Stat label="Uptime" value={result.uptimeSeconds != null ? fmtUptime(result.uptimeSeconds) : "—"} />
                  <Stat label={t("Consumibles")} value={fmtNumber(result.supplies)} />
                  <Stat label={t("Bandejas")} value={fmtNumber(result.trays)} />
                  <Stat
                    label={t("Contador total")}
                    value={fmtNumber(result.counters.find((c) => c.type === "TOTAL")?.value ?? null)}
                  />
                  {result.sysObjectId && (
                    <div className="sm:col-span-2 lg:col-span-4">
                      <Stat label="sysObjectID" value={<span className="text-xs">{result.sysObjectId}</span>} />
                    </div>
                  )}
                  {result.sysDescr && (
                    <div className="sm:col-span-2 lg:col-span-4">
                      <Stat label="sysDescr" value={<span className="text-xs">{result.sysDescr}</span>} />
                    </div>
                  )}
                  {result.failedOids > 0 && (
                    <div className="sm:col-span-2 lg:col-span-4 text-[11px] text-muted">
                      {result.failedOids} {t("OID(s) no respondieron (normal: no todos los equipos exponen todo).")}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted">
                  {t("La IP no respondió por SNMP. Verifica que el equipo esté encendido, que SNMP esté habilitado y que la community sea correcta.")}
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
