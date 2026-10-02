"use client";

/**
 * Cambio de IP remoto — Etapa 1: sonda de capacidad SNMP-write (SIN RIESGO).
 *
 * Escribir la IP de una impresora en remoto es delicado: si algo falla, la
 * impresora queda inaccesible y hay que ir físicamente al panel. Por eso el
 * flujo es en dos etapas. Esta página cubre la Etapa 1: comprobar, sobre una
 * impresora (idealmente la de PRUEBA), si SNMP-write está habilitado y con qué
 * community, LEYENDO su config de red y haciendo un SET no destructivo. No se
 * modifica nada de la impresora.
 */
import { useState } from "react";
import { HelpTip } from "@/components/HelpTip";
import { Topbar } from "@/components/Topbar";
import { Select } from "@/components/Select";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiSnmpWriteProbe, ApiAssignIp } from "@/lib/types";

export default function IpAssignPage() {
  const { t } = useI18n();
  const [ip, setIp] = useState("");
  const [community, setCommunity] = useState("public");
  const [writeCommunity, setWriteCommunity] = useState("private");
  const [version, setVersion] = useState<"v2c" | "v1">("v2c");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ApiSnmpWriteProbe | null>(null);

  // Etapa 2 — asignación de IP nueva.
  const [newIp, setNewIp] = useState("");
  const [newMask, setNewMask] = useState("");
  const [newGw, setNewGw] = useState("");
  const [updateInv, setUpdateInv] = useState(true);
  const [confirmChk, setConfirmChk] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [assignResult, setAssignResult] = useState<ApiAssignIp | null>(null);

  async function probe(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setResult(null);
    setAssignResult(null);
    setAssignMsg(null);
    try {
      const r = await api.snmpWriteProbe({ ip: ip.trim(), community: community.trim(), writeCommunity: writeCommunity.trim(), version });
      setResult(r);
      // Prefijar máscara/gateway leídos, para un cambio dentro de la misma subred.
      if (r.addresses[0]?.mask) setNewMask(r.addresses[0].mask);
      if (r.gateway) setNewGw(r.gateway);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("Error en la sonda"));
    } finally {
      setBusy(false);
    }
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!result) return;
    setAssignBusy(true);
    setAssignMsg(null);
    setAssignResult(null);
    try {
      const r = await api.assignIp({
        ip: ip.trim(),
        newIp: newIp.trim(),
        mask: newMask.trim() || undefined,
        gateway: newGw.trim() || undefined,
        writeCommunity: writeCommunity.trim(),
        community: community.trim(),
        version,
        updateInventory: updateInv,
      });
      setAssignResult(r);
      setConfirmChk(false);
    } catch (err) {
      setAssignMsg(err instanceof Error ? err.message : t("Error al asignar la IP"));
    } finally {
      setAssignBusy(false);
    }
  }

  return (
    <>
      <Topbar title="Asignar IP (remoto)" help="Cambia la IP de una impresora RICOH por SNMP de forma remota. El inventario se actualiza al aplicar (la impresora se reinicia)." />
      <main className="flex-1 space-y-4 p-6">
        {/* Aviso de riesgo */}
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
          <div className="font-semibold">{t("Cambiar la IP en remoto es delicado")}</div>
          <p className="mt-1 leading-relaxed text-warn/90">
            {t("Al escribir la IP, la impresora salta a la dirección nueva y la sesión se pierde. Si la máscara/gateway/VLAN no cuadran, queda inaccesible y hay que ir físicamente al panel a recuperarla — no hay vuelta atrás remota. Por eso empezamos por una sonda sin riesgo y la escritura real solo se hará sobre tu impresora de prueba.")}
          </p>
        </div>

        {/* Etapa 1 */}
        <form onSubmit={probe} className="card space-y-4 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              {t("Etapa 1 · ¿Se puede escribir por SNMP en esta impresora?")}
              <HelpTip
                title="Asignar IP en dos etapas"
                body="Cambiar la IP se hace en dos pasos por seguridad. Etapa 1: se prueba si la impresora acepta escritura por SNMP (necesita la community de escritura, RW, normalmente «private»). Etapa 2: se escribe la IP nueva y la impresora la aplica al reiniciarse. El inventario se actualiza solo (identifica por número de serie, no duplica)."
              />
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              {t("Lee la config de red actual y prueba la community de escritura (RW) con un SET inofensivo (reescribe sysLocation con su mismo valor). No cambia nada. Si la RW funciona, tiene sentido pasar a la Etapa 2 (escribir la IP).")}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted">{t("IP de la impresora")}</label>
              <input className="input w-48" placeholder="192.0.2.xx" value={ip} onChange={(e) => setIp(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted">{t("Community lectura")}</label>
              <input className="input w-40" value={community} onChange={(e) => setCommunity(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted">{t("Community escritura (RW)")}</label>
              <input className="input w-40" value={writeCommunity} onChange={(e) => setWriteCommunity(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted">{t("Versión")}</label>
              <Select
                className="w-24"
                value={version}
                onChange={(v) => setVersion(v as "v2c" | "v1")}
                options={[
                  { value: "v2c", label: "v2c" },
                  { value: "v1", label: "v1" },
                ]}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="btn" disabled={busy || !ip.trim() || !writeCommunity.trim()}>
              {busy ? t("Probando…") : t("Probar capacidad")}
            </button>
            {msg && <span className="text-xs text-danger">{msg}</span>}
          </div>
        </form>

        {/* Resultado de la sonda */}
        {result && (
          <section className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">{t("Resultado")} · {result.ip}</h3>
              <span className={`inline-flex items-center gap-1.5 text-xs ${result.reachable ? "text-ok" : "text-danger"}`}>
                <span className={`h-2 w-2 rounded-full ${result.reachable ? "bg-ok" : "bg-danger"}`} />
                {result.reachable ? t("Responde SNMP") : t("Sin respuesta SNMP")}
              </span>
            </div>

            {/* Veredicto de escritura: lo que decide todo */}
            <div
              className={`rounded-lg border p-4 ${
                result.writeCommunityWorks ? "border-ok/40 bg-ok/10" : "border-danger/40 bg-danger/10"
              }`}
            >
              <div className={`text-sm font-semibold ${result.writeCommunityWorks ? "text-ok" : "text-danger"}`}>
                {result.writeCommunityWorks ? t("✓ SNMP-write HABILITADO") : t("✗ SNMP-write NO disponible")}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {result.writeCommunityWorks
                  ? t("La community RW aceptó el SET no destructivo. Se puede intentar escribir la IP (Etapa 2) en esta impresora.")
                  : `${t("El SET fue rechazado")}${result.writeError ? ` (${result.writeError})` : ""}. ${t("Suele significar que esa community no es de escritura, que SNMP-write está deshabilitado, o que la impresora restringe el acceso. Sin esto, el cambio de IP por SNMP no es posible.")}`}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted">{t("Nombre (sysName)")}</div>
                <div className="mt-1 text-sm text-slate-100">{result.sysName ?? "—"}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted">Gateway</div>
                <div className="mt-1 font-mono text-sm text-slate-100">{result.gateway ?? "—"}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-muted">{t("Direcciones IP configuradas")}</div>
              {result.addresses.length === 0 ? (
                <p className="text-sm text-muted">{t("No se pudieron leer.")}</p>
              ) : (
                <table className="w-full max-w-md text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                      <th className="px-3 py-2 text-left">IP</th>
                      <th className="px-3 py-2 text-left">{t("Máscara")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.addresses.map((a) => (
                      <tr key={a.ip} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-slate-100">{a.ip}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted">{a.mask ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Etapa 2 · Asignar IP nueva */}
            {result.writeCommunityWorks ? (
              <form onSubmit={assign} className="rounded-lg border border-border bg-panel/60 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-100">{t("Etapa 2 · Asignar IP nueva (RICOH)")}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {t("Escribe la IP por SNMP en el registro de RICOH. Flujo en dos tiempos: el cambio queda pendiente y la impresora sigue accesible en su IP actual hasta que la reinicies (apagar/encender o desde su web). Confirma que la IP nueva está libre con el escáner de IPs.")}
                </p>

                <div className="mt-3 flex flex-wrap gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] uppercase text-muted">{t("IP nueva")}</label>
                    <input className="input w-44" placeholder="192.0.2.xx" value={newIp} onChange={(e) => setNewIp(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] uppercase text-muted">{t("Máscara")}</label>
                    <input className="input w-44" value={newMask} onChange={(e) => setNewMask(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] uppercase text-muted">Gateway</label>
                    <input className="input w-44" value={newGw} onChange={(e) => setNewGw(e.target.value)} />
                  </div>
                </div>

                <label className="mt-3 flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" className="mt-0.5" checked={updateInv} onChange={(e) => setUpdateInv(e.target.checked)} />
                  <span>
                    {t("Actualizar el inventario a la IP nueva (si esta impresora está registrada). Se conectará tras el reinicio.")}
                  </span>
                </label>

                <label className="mt-2 flex items-start gap-2 text-xs text-muted">
                  <input type="checkbox" className="mt-0.5" checked={confirmChk} onChange={(e) => setConfirmChk(e.target.checked)} />
                  <span>
                    {t("Entiendo que esto escribe la configuración de red de")} <span className="font-mono text-slate-300">{ip}</span> {t("y que el cambio a")} <span className="font-mono text-slate-300">{newIp || "—"}</span> {t("se aplica al reiniciar la impresora.")}
                  </span>
                </label>

                <div className="mt-3 flex items-center gap-3">
                  <button className="btn" disabled={assignBusy || !confirmChk || !newIp.trim()}>
                    {assignBusy ? t("Escribiendo…") : t("Escribir IP (pendiente de reinicio)")}
                  </button>
                  {assignMsg && <span className="text-xs text-danger">{assignMsg}</span>}
                </div>

                {assignResult && (
                  <div className={`mt-3 rounded-lg border p-3 ${assignResult.pending ? "border-warn/40 bg-warn/10" : "border-ok/40 bg-ok/10"}`}>
                    <div className={`text-sm font-semibold ${assignResult.pending ? "text-warn" : "text-ok"}`}>
                      {assignResult.pending ? t("IP escrita — pendiente de reinicio") : t("IP escrita")}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{assignResult.note}</p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted">{t("Config antes → después:")}</span>
                      <span className="font-mono text-slate-200">{assignResult.before.configIp} → {assignResult.after.configIp}</span>
                      <span className="text-muted">{t("IP activa (en uso):")}</span>
                      <span className="font-mono text-slate-200">{assignResult.after.activeIp}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {t("Inventario:")}{" "}
                      {assignResult.inventoryUpdated
                        ? <span className="text-ok">{t("actualizado a")} {assignResult.newIp} {t("(se conectará tras el reinicio)")}</span>
                        : assignResult.inventoryError
                          ? <span className="text-danger">{t("no se pudo actualizar")} ({assignResult.inventoryError})</span>
                          : <span>{t("sin registro con IP")} {assignResult.ip} {t("(nada que actualizar)")}</span>}
                    </p>
                    {assignResult.errors && <p className="mt-2 text-xs text-danger">{t("Avisos:")} {assignResult.errors.join(" · ")}</p>}
                  </div>
                )}
              </form>
            ) : (
              <div className="rounded-lg border border-border bg-panel/60 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t("Etapa 2 · Asignar IP")}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {t("Bloqueada: sin community de escritura válida no se puede escribir la IP por SNMP. Alternativa: hacerlo desde el Web Image Monitor de la impresora (su web de administración).")}
                </p>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
