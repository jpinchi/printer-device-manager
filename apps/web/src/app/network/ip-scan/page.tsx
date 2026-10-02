"use client";

/**
 * Escáner de IPs disponibles: dado un rango (o CIDR), barre por ICMP + ARP y
 * marca qué IPs están EN USO y cuáles LIBRES para asignar una IP fija a una
 * impresora. Es un apoyo heurístico (un equipo con firewall puede no responder
 * al ping); la fuente de verdad definitiva es el plan de IPs / DHCP de la red.
 */
import { useState } from "react";
import { Topbar } from "@/components/Topbar";
import { IpLink } from "@/components/IpLink";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiIpScan, ApiIpScanEntry } from "@/lib/types";

export default function IpScanPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"range" | "cidr">("range");
  const [startIp, setStartIp] = useState("192.0.2.1");
  const [endIp, setEndIp] = useState("192.0.2.254");
  const [cidr, setCidr] = useState("192.0.2.0/24");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ApiIpScan | null>(null);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(t("Escaneando… (puede tardar unos segundos)"));
    setResult(null);
    try {
      const body = mode === "cidr" ? { cidr: cidr.trim() } : { start: startIp.trim(), end: endIp.trim() };
      const r = await api.ipScan(body);
      setResult(r);
      setMsg(null);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("Error en el escaneo"));
    } finally {
      setBusy(false);
    }
  }

  function copyFree() {
    if (!result) return;
    navigator.clipboard?.writeText(result.freeIps.join("\n")).then(
      () => setMsg(t("IPs libres copiadas al portapapeles.")),
      () => setMsg(t("No se pudo copiar.")),
    );
  }

  // Dispositivo: modelo (inventario o SNMP en vivo) + nombre; o el nombre/host si no es impresora.
  const deviceModel = (e: ApiIpScanEntry) => e.printerModel ?? e.snmpModel ?? null;
  const deviceName = (e: ApiIpScanEntry) => e.printerName ?? e.snmpName ?? e.hostname ?? null;
  // Reservada: está en el inventario pero NO respondió en vivo (impresora apagada/reubicada).
  const isReserved = (e: ApiIpScanEntry) => e.via === "printer" && !e.respondedLive;

  // Detalle: lo demás (hostname si no es el nombre mostrado, y MAC).
  const usedDetail = (e: ApiIpScanEntry) => {
    if (isReserved(e)) return t("reservada en inventario · sin respuesta en vivo");
    const name = deviceName(e);
    const parts: string[] = [];
    if (e.hostname && e.hostname !== name) parts.push(e.hostname);
    if (e.mac) parts.push(e.mac);
    if (parts.length) return parts.join(" · ");
    return e.used && !name ? t("responde ping") : "—";
  };

  return (
    <>
      <Topbar title="IPs disponibles" help="Escanea un rango y muestra qué IPs están libres u ocupadas, con el modelo del equipo que responde." />
      <main className="flex-1 space-y-4 p-6">
        <form onSubmit={scan} className="card space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{t("Buscar IPs libres para asignar")}</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              {t("Barre el rango por ping (ICMP) y la tabla ARP y marca qué IPs están en uso. Las que no responden se listan como libres. Es un apoyo: un equipo con firewall puede no responder al ping, así que confirma contra tu plan de IPs antes de asignar. Máx. 512 IPs por escaneo.")}
            </p>
          </div>

          <div className="flex gap-2 text-sm">
            <button type="button" onClick={() => setMode("range")} className={`rounded-lg px-3 py-1.5 ${mode === "range" ? "bg-accent/15 text-accent" : "text-muted"}`}>{t("Rango IP")}</button>
            <button type="button" onClick={() => setMode("cidr")} className={`rounded-lg px-3 py-1.5 ${mode === "cidr" ? "bg-accent/15 text-accent" : "text-muted"}`}>CIDR</button>
          </div>

          {mode === "range" ? (
            <div className="flex flex-wrap gap-3">
              <div><label className="mb-1 block text-[11px] uppercase text-muted">{t("Desde IP")}</label><input className="input" value={startIp} onChange={(e) => setStartIp(e.target.value)} /></div>
              <div><label className="mb-1 block text-[11px] uppercase text-muted">{t("Hasta IP")}</label><input className="input" value={endIp} onChange={(e) => setEndIp(e.target.value)} /></div>
            </div>
          ) : (
            <div><label className="mb-1 block text-[11px] uppercase text-muted">CIDR</label><input className="input w-64" value={cidr} onChange={(e) => setCidr(e.target.value)} /></div>
          )}

          <div className="flex items-center gap-3">
            <button className="btn" disabled={busy}>{busy ? t("Escaneando…") : t("Buscar disponibles")}</button>
            {msg && <span className="text-xs text-muted">{msg}</span>}
          </div>
        </form>

        {result && (
          <>
            {/* Resumen */}
            <div className="grid grid-cols-3 gap-4">
              <div className="card p-4"><div className="text-[11px] uppercase tracking-wider text-muted">{t("Libres")}</div><div className="mt-1 text-3xl font-bold tabular-nums text-ok">{result.free}</div></div>
              <div className="card p-4"><div className="text-[11px] uppercase tracking-wider text-muted">{t("En uso")}</div><div className="mt-1 text-3xl font-bold tabular-nums text-danger">{result.used}</div></div>
              <div className="card p-4"><div className="text-[11px] uppercase tracking-wider text-muted">{t("Escaneadas")}</div><div className="mt-1 text-3xl font-bold tabular-nums text-slate-100">{result.scanned}</div></div>
            </div>

            {/* IPs libres (lo importante) */}
            <section className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ok">{t("IPs libres para asignar")}</h3>
                {result.free > 0 && (
                  <button onClick={copyFree} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent">{t("Copiar todas")}</button>
                )}
              </div>
              {result.free === 0 ? (
                <p className="text-sm text-muted">{t("No se encontraron IPs libres en el rango.")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {result.freeIps.map((ip) => (
                    <span key={ip} className="rounded-lg border border-ok/40 bg-ok/10 px-2.5 py-1 font-mono text-xs text-ok">{ip}</span>
                  ))}
                </div>
              )}
            </section>

            {/* Detalle completo */}
            <div className="card overflow-x-auto">
              <div className="border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted">{t("Detalle del rango")}</div>
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-4 py-3 text-left">IP</th>
                    <th className="px-4 py-3 text-left">{t("Estado")}</th>
                    <th className="px-4 py-3 text-left">{t("Dispositivo")}</th>
                    <th className="px-4 py-3 text-left">{t("Detalle")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.entries.map((e) => {
                    const model = deviceModel(e);
                    const name = deviceName(e);
                    const reserved = isReserved(e);
                    return (
                      <tr key={e.ip} className="border-b border-border/60 last:border-0 hover-elev">
                        <td className="px-4 py-2 font-mono text-xs">
                          {e.used ? <IpLink ip={e.ip} className="text-xs" /> : <span className="text-slate-300">{e.ip}</span>}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center gap-1.5 text-xs ${reserved ? "text-warn" : e.used ? "text-danger" : "text-ok"}`}>
                            <span className={`h-2 w-2 rounded-full ${reserved ? "bg-warn/40 ring-1 ring-warn" : e.used ? "bg-danger" : "bg-ok"}`} />
                            {reserved ? t("Reservada") : e.used ? t("En uso") : t("Libre")}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {/* Solo el modelo (del inventario o SNMP). Si no hay modelo,
                              el nombre/host, y si tampoco, "Equipo en red". */}
                          {!e.used ? (
                            <span className="text-muted">—</span>
                          ) : model ? (
                            <span className={`text-slate-100 ${reserved ? "opacity-70" : ""}`}>{model}</span>
                          ) : name ? (
                            <span className="text-slate-200">{name}</span>
                          ) : (
                            <span className="text-muted">{t("Equipo en red")}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted">{e.used ? usedDetail(e) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </>
  );
}
