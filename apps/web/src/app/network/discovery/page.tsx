"use client";

/** Descubrimiento de red (Fase 2): escaneo de rango IP por SNMP. */
import { useState } from "react";
import { Topbar } from "@/components/Topbar";
import { IpLink } from "@/components/IpLink";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiDiscoveryResult } from "@/lib/types";

export default function DiscoveryPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"range" | "cidr">("range");
  const [startIp, setStartIp] = useState("10.0.0.1");
  const [endIp, setEndIp] = useState("10.0.0.64");
  const [cidr, setCidr] = useState("10.0.0.0/24");
  const [community, setCommunity] = useState("public");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ApiDiscoveryResult | null>(null);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(t("Escaneando… (esto puede tardar según el rango)"));
    setResult(null);
    try {
      const body = mode === "cidr" ? { cidr, community } : { startIp, endIp, community };
      const r = await api.scanDiscovery(body);
      setResult(r);
      setMsg(`${t("Escaneo completo:")} ${r.printersFound} ${t("impresoras de")} ${r.totalDevices} ${t("dispositivos")} (${r.scannedIps} IPs).`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function addAll() {
    if (!result) return;
    const printers = result.devices.filter((d) => d.isPrinter);
    setMsg(`${t("Agregando")} ${printers.length} ${t("impresoras…")}`);
    let ok = 0;
    for (const d of printers) {
      try { await api.addPrinter({ ip: d.ip, community }); ok++; } catch { /* continuar */ }
    }
    setMsg(`${ok}/${printers.length} ${t("impresoras agregadas al inventario.")}`);
  }

  return (
    <>
      <Topbar title="Descubrimiento" help="Escanea un rango de red para encontrar impresoras nuevas por SNMP y agregarlas al inventario." />
      <main className="flex-1 space-y-4 p-6">
        <form onSubmit={scan} className="card space-y-4 p-5">
          <div className="flex gap-2 text-sm">
            <button type="button" onClick={() => setMode("range")} className={`rounded-lg px-3 py-1.5 ${mode === "range" ? "bg-accent/15 text-accent" : "text-muted"}`}>{t("Rango IP")}</button>
            <button type="button" onClick={() => setMode("cidr")} className={`rounded-lg px-3 py-1.5 ${mode === "cidr" ? "bg-accent/15 text-accent" : "text-muted"}`}>CIDR</button>
          </div>
          {mode === "range" ? (
            <div className="flex flex-wrap gap-3">
              <div><label className="mb-1 block text-[11px] uppercase text-muted">{t("IP inicial")}</label><input className="input" value={startIp} onChange={(e) => setStartIp(e.target.value)} /></div>
              <div><label className="mb-1 block text-[11px] uppercase text-muted">{t("IP final")}</label><input className="input" value={endIp} onChange={(e) => setEndIp(e.target.value)} /></div>
            </div>
          ) : (
            <div><label className="mb-1 block text-[11px] uppercase text-muted">CIDR</label><input className="input w-64" value={cidr} onChange={(e) => setCidr(e.target.value)} /></div>
          )}

          {/* Ayuda contextual: ambas definen QUÉ IPs escanear, distinta forma. */}
          <p className="max-w-2xl text-[11px] leading-relaxed text-slate-500">
            {mode === "range"
              ? t("Rango IP: escanea direcciones consecutivas, de la inicial a la final. Útil cuando conoces el tramo exacto de tus impresoras.")
              : t("CIDR: escanea una subred completa con la notación red/máscara (p. ej. 192.0.2.0/24 = todo el 192.0.2.x). Útil para barrer una red entera.")}{" "}
            {t("Ambas prueban SNMP en cada IP; cuanto más grande el conjunto, más tarda el escaneo.")}
          </p>

          <div className="flex items-end gap-3">
            <div><label className="mb-1 block text-[11px] uppercase text-muted">Community</label><input className="input" value={community} onChange={(e) => setCommunity(e.target.value)} /></div>
            <button className="btn" disabled={busy}>{busy ? t("Escaneando…") : t("Escanear red")}</button>
          </div>
          {msg && <p className="text-xs text-muted">{msg}</p>}
        </form>

        {result && (
          <div className="card p-5">
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <div className="text-sm">
                <span className="text-2xl font-semibold text-accent">{result.printersFound}</span>
                <span className="ml-1 text-muted">{t("impresoras")}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(result.byManufacturer).map(([m, n]) => (
                  <span key={m} className="rounded-full bg-elev px-2.5 py-1">{m}: {n}</span>
                ))}
              </div>
              {result.printersFound > 0 && (
                <button className="btn ml-auto" onClick={addAll}>{t("Agregar todas al inventario")}</button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-3 py-2 text-left">IP</th>
                    <th className="px-3 py-2 text-left">{t("Fabricante")}</th>
                    <th className="px-3 py-2 text-left">{t("Modelo")}</th>
                    <th className="px-3 py-2 text-left">{t("Impresora")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.devices.map((d) => (
                    <tr key={d.ip} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        <IpLink ip={d.ip} className="text-xs" />
                      </td>
                      <td className="px-3 py-2">{d.manufacturer ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-300">{d.model ?? "—"}</td>
                      <td className="px-3 py-2">{d.isPrinter ? "✅" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
