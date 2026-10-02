"use client";

/**
 * Dashboard principal (sección 7): tarjetas de resumen + tabla de dispositivos
 * con filtros/búsqueda/orden/agrupación, alta rápida por SNMP y poll manual.
 */
import { useState } from "react";
import { Topbar } from "@/components/Topbar";
import { SummaryCards } from "@/components/SummaryCards";
import { DeviceTable } from "@/components/DeviceTable";
import { Spinner, ErrorState, EmptyState } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { useRealtime } from "@/hooks/useRealtime";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiPrinter, ApiAlert } from "@/lib/types";

export default function DashboardPage() {
  const { t } = useI18n();
  const printers = useAsync<ApiPrinter[]>(() => api.listPrinters(), []);
  const alerts = useAsync(() => api.listAlerts(), []);

  // Tiempo real (sección 19): recarga automática cuando el backend avisa.
  const { connected } = useRealtime(() => {
    printers.reload();
    alerts.reload();
  });

  const [ip, setIp] = useState("");
  const [community, setCommunity] = useState("public");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addPrinter() {
    const target = ip.trim();
    if (!target) return;
    setBusy(true);
    setMsg(t("Consultando por SNMP…") + " " + target);
    try {
      const r = await api.addPrinter({ ip: target, community: community.trim() });
      setMsg(t("Agregada:") + " " + (r.printer?.model ?? target));
      setIp("");
      printers.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const [pollingAll, setPollingAll] = useState(false);
  async function pollAll() {
    setPollingAll(true);
    setMsg(t("Consultando todas las impresoras por SNMP… (puede tardar)"));
    try {
      const r = await api.pollAll();
      setMsg(`${t("Actualización completa")}: ${r.online} ${t("en línea")}, ${r.offline} ${t("fuera de línea")} (${t("de")} ${r.total}).`);
      printers.reload();
      alerts.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPollingAll(false);
    }
  }

  const alertList: ApiAlert[] = alerts.data?.data ?? [];
  const alertsPending = alerts.data?.pending ?? false;

  return (
    <>
      <Topbar title="Dashboard" help="Resumen del estado de toda la flota: cuántas impresoras hay en línea, fuera de línea y con alertas." />
      <main className="flex-1 space-y-6 p-6">
        {/* Alta rápida por SNMP */}
        <div className="card flex flex-wrap items-center gap-2 p-4">
          <input
            className="input min-w-[240px] flex-1"
            placeholder={t("IP de la impresora (ej. 192.0.2.51)")}
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPrinter()}
          />
          <input
            className="input w-36"
            placeholder="community"
            value={community}
            onChange={(e) => setCommunity(e.target.value)}
          />
          <button className="btn" onClick={addPrinter} disabled={busy}>
            {busy ? "…" : t("Agregar por SNMP")}
          </button>
          <button className="btn-ghost" onClick={() => printers.reload()}>
            {t("Refrescar")}
          </button>
          <button
            className="btn-ghost"
            onClick={pollAll}
            disabled={pollingAll}
            title={t("Consulta por SNMP todas las impresoras y actualiza la tabla")}
          >
            {pollingAll ? t("Actualizando…") : t("🔄 Actualizar todo")}
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={t("Actualización en tiempo real (WebSocket)")}>
            <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-ok animate-pulse-ring" : "bg-slate-600"}`} />
            {connected ? t("En vivo") : t("Sin conexión en vivo")}
          </span>
          {msg && <span className="w-full text-xs text-muted">{msg}</span>}
        </div>

        {printers.loading && <Spinner label={t("Cargando inventario…")} />}
        {printers.error && <ErrorState message={printers.error} />}

        {printers.data && (
          <>
            <SummaryCards
              printers={printers.data}
              alerts={alertList}
              alertsPending={alertsPending}
            />
            {printers.data.length === 0 ? (
              <EmptyState
                title={t("Sin impresoras en el inventario.")}
                hint={t("Agrega una por IP arriba, o usa Red → Descubrimiento para escanear un rango.")}
              />
            ) : (
              <DeviceTable
                printers={printers.data}
                onDelete={async (p) => {
                  await api.deletePrinter(p.id);
                  printers.reload();
                }}
              />
            )}
          </>
        )}
      </main>
    </>
  );
}
