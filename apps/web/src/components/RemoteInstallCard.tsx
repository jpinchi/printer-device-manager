"use client";

/**
 * Instalación remota de drivers (sin WinRM): SMB admin$ + WMI/DCOM.
 *
 * 1) Sonda: prueba SMB (admin$) y WMI (DCOM) con credenciales de admin. No instala.
 * 2) Cuando la sonda está lista, elige un driver del catálogo e instálalo en la PC.
 * Las credenciales se usan solo para la operación y no se guardan.
 */
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Select } from "@/components/Select";
import { HelpTip } from "@/components/HelpTip";
import type { ApiRemoteProbe, ApiRemoteInstall, ApiDriver, ApiPrinter } from "@/lib/types";

interface HubCfg {
  enabled: boolean;
  hubUrl: string;
  hubUser: string;
  hasPassword: boolean;
}

export function RemoteInstallCard({ drivers, printers }: { drivers: ApiDriver[]; printers: ApiPrinter[] }) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [probe, setProbe] = useState<ApiRemoteProbe | null>(null);

  const [printerId, setPrinterId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [confirmChk, setConfirmChk] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<ApiRemoteInstall | null>(null);

  // Delegación a un hub.
  const [hub, setHub] = useState<HubCfg | null>(null);
  const [hubDrivers, setHubDrivers] = useState<ApiDriver[]>([]);
  const [hubPrinters, setHubPrinters] = useState<ApiPrinter[]>([]);
  const [showHubCfg, setShowHubCfg] = useState(false);
  const [cfgUrl, setCfgUrl] = useState("");
  const [cfgUser, setCfgUser] = useState("");
  const [cfgPass, setCfgPass] = useState("");
  const [savingHub, setSavingHub] = useState(false);

  async function loadHub() {
    try {
      const h = await api.remoteHubGet();
      setHub(h);
      setCfgUrl(h.hubUrl);
      setCfgUser(h.hubUser);
      if (h.enabled) {
        api.remoteHubDrivers().then(setHubDrivers).catch(() => setHubDrivers([]));
        api.remoteHubPrinters().then(setHubPrinters).catch(() => setHubPrinters([]));
      }
    } catch {
      setHub(null);
    }
  }
  useEffect(() => {
    loadHub();
  }, []);

  async function saveHub() {
    setSavingHub(true);
    setErr(null);
    try {
      await api.remoteHubSet({ hubUrl: cfgUrl.trim(), hubUser: cfgUser.trim(), hubPassword: cfgPass || undefined });
      setCfgPass("");
      setShowHubCfg(false);
      setProbe(null);
      setResult(null);
      await loadHub();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t("No se pudo guardar el hub"));
    } finally {
      setSavingHub(false);
    }
  }
  async function clearHub() {
    setSavingHub(true);
    try {
      await api.remoteHubSet({ hubUrl: "" });
      setHubDrivers([]);
      setHubPrinters([]);
      setProbe(null);
      await loadHub();
    } finally {
      setSavingHub(false);
    }
  }

  // Catálogo efectivo: en modo delegación se usa el del HUB.
  const effDrivers = hub?.enabled ? hubDrivers.filter((d) => d.installable) : drivers;
  const effPrinters = hub?.enabled ? hubPrinters : printers;

  const ready = !!probe && probe.smbOk && probe.wmiOk;

  async function runProbe(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setProbe(null);
    setResult(null);
    try {
      const r = await api.remoteInstallProbe({ host: host.trim(), username: username.trim(), password });
      setProbe(r);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t("Error en la sonda"));
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    if (!driverId) return;
    setInstalling(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.remoteInstall({ host: host.trim(), driverId, printerId: printerId || undefined, username: username.trim(), password });
      setResult(r);
      setConfirmChk(false);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t("Error al instalar"));
    } finally {
      setInstalling(false);
    }
  }

  const Row = ({ ok, label }: { ok: boolean; label: string }) => (
    <span className={`inline-flex items-center gap-1.5 text-xs ${ok ? "text-ok" : "text-danger"}`}>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-ok" : "bg-danger"}`} />
      {label}
    </span>
  );

  return (
    <section className="card p-5">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
        {t("Instalación remota")}
        <HelpTip
          title="Instalación remota"
          body="Instala un driver en otra PC del dominio sin visitarla. Se ejecuta desde esta máquina (el servidor), que debe poder autenticar contra el equipo destino. Escribe la IP o el nombre del equipo y las credenciales de un administrador de dominio (no se guardan). Si esta máquina no puede autenticar por política de dominio, usa la delegación de abajo para que lo haga un hub que sí pueda."
        />
      </h3>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
        {t("Instala un driver en OTRA PC Windows del dominio, sin WinRM: usa el recurso admin$ (SMB) y WMI. Escribe las credenciales de una cuenta con permisos de administrador en esa PC; se usan solo para la operación y no se guardan.")}
      </p>

      {/* Delegación a un hub */}
      <div className="mt-3 rounded-lg border border-border/60 bg-panel/40 p-3">
        {hub?.enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-ok">
              {t("Delegando al hub:")} <span className="font-mono text-slate-200">{hub.hubUrl}</span>
              <span className="ml-2 text-muted">{t("(la instalación se ejecuta en el hub, que sí autentica al dominio)")}</span>
            </div>
            <div className="flex gap-2">
              <button className="text-[11px] text-accent hover:underline" onClick={() => setShowHubCfg((v) => !v)}>{t("Cambiar")}</button>
              <button className="text-[11px] text-danger hover:underline disabled:opacity-60" disabled={savingHub} onClick={clearHub}>{t("Quitar")}</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              {t("¿Esta máquina no puede autenticar al dominio? Delega la instalación a un hub (un servidor que sí pueda, como el central).")}
              <HelpTip
                title="Delegación"
                body="Si esta máquina no puede autenticar contra el dominio por política de red, envía la instalación a un hub: un servidor que sí puede, como tu central. El hub la ejecuta y devuelve el resultado. Necesitas la URL del hub (por ejemplo, http://192.0.2.24:2626) y un usuario y contraseña de la aplicación en ese hub (no los del dominio). Las credenciales de dominio del equipo destino se siguen escribiendo arriba."
              />
            </span>
            <button className="text-[11px] text-accent hover:underline" onClick={() => setShowHubCfg((v) => !v)}>{t("Configurar delegación")}</button>
          </div>
        )}

        {showHubCfg && (
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border/50 pt-3">
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted">{t("URL del hub")}</label>
              <input className="input w-64" placeholder="http://192.0.2.24:2626" value={cfgUrl} onChange={(e) => setCfgUrl(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted">{t("Usuario del hub")}</label>
              <input className="input w-40" placeholder={t("usuario del app")} value={cfgUser} onChange={(e) => setCfgUser(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted">{t("Contraseña del hub")}</label>
              <input type="password" className="input w-40" placeholder={hub?.hasPassword ? "••••••••" : ""} value={cfgPass} onChange={(e) => setCfgPass(e.target.value)} autoComplete="new-password" />
            </div>
            <button className="btn" disabled={savingHub || !cfgUrl.trim()} onClick={saveHub}>
              {savingHub ? t("Guardando…") : t("Guardar hub")}
            </button>
            <button className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-slate-100" onClick={() => setShowHubCfg(false)}>{t("Cancelar")}</button>
          </div>
        )}
      </div>

      <form onSubmit={runProbe} className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] uppercase text-muted">{t("Equipo (nombre o IP)")}</label>
          <input className="input w-52" placeholder={t("Número de Propiedad")} value={host} onChange={(e) => { setHost(e.target.value); setProbe(null); setResult(null); }} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase text-muted">{t("Usuario administrador")}</label>
          <input className="input w-48" placeholder="DOMINIO\admin" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase text-muted">{t("Contraseña")}</label>
          <input type="password" className="input w-44" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <button className="btn" disabled={busy || !host.trim() || !username.trim() || !password}>
          {busy ? t("Probando…") : t("Probar conexión")}
        </button>
        {err && <span className="text-xs text-danger">{err}</span>}
      </form>

      {probe && (
        <div className={`mt-3 rounded-lg border p-3 ${ready ? "border-ok/40 bg-ok/10" : "border-danger/40 bg-danger/10"}`}>
          <div className="flex flex-wrap items-center gap-4">
            <Row ok={probe.reachable} label={t("Alcanzable")} />
            <Row ok={probe.smbOk} label="SMB (admin$)" />
            <Row ok={probe.wmiOk} label="WMI (DCOM)" />
          </div>
          {ready ? (
            <p className="mt-2 text-xs text-ok">
              {t("Listo para instalar.")}{" "}
              <span className="text-muted">
                {probe.remoteName ? <>{t("Equipo:")} <span className="font-mono text-slate-200">{probe.remoteName}</span></> : null}
                {probe.osVersion ? <> · {t("SO:")} <span className="font-mono text-slate-200">Windows {probe.osVersion}</span></> : null}
                {probe.userForm ? <> · {t("Usuario:")} <span className="font-mono text-slate-200">{probe.userForm}</span></> : null}
              </span>
            </p>
          ) : (
            <div className="mt-2 text-xs leading-relaxed text-muted">
              {!probe.smbOk && <p>{t("No se pudo acceder a admin$ (SMB). Verifica que el equipo sea alcanzable, que compartir archivos/SMB (445) esté abierto y que la cuenta sea administrador en esa PC.")}</p>}
              {probe.smbOk && !probe.wmiOk && <p>{t("SMB funcionó pero WMI (DCOM) no. Verifica que RPC/DCOM (135) esté permitido hacia esa PC en el firewall.")}</p>}
              {probe.error ? <p className="mt-1 break-words font-mono text-[11px] text-danger">{probe.error}</p> : null}
            </div>
          )}
        </div>
      )}

      {ready && (
        <div className="mt-3 rounded-lg border border-border bg-panel/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-100">{t("Instalar driver en")} {probe!.remoteName ?? host}</div>
          {effDrivers.length === 0 ? (
            <p className="mt-2 text-xs text-muted">{t("No hay drivers con instalador alojado en el catálogo. Sube el archivo (.inf/.exe/.zip) de un driver primero.")}</p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-[11px] uppercase text-muted">{t("Impresora (del inventario)")}</label>
                  <Select
                    className="min-w-[300px]"
                    value={printerId}
                    onChange={setPrinterId}
                    placeholder={t("Selecciona la impresora…")}
                    options={effPrinters.map((p) => ({
                      value: p.id,
                      label: [p.model, p.location?.name, p.ipAddress].filter(Boolean).join(" · "),
                    }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase text-muted">{t("Driver a instalar")}</label>
                  <Select
                    className="min-w-[280px]"
                    value={driverId}
                    onChange={setDriverId}
                    placeholder={t("Selecciona el driver…")}
                    options={effDrivers.map((d) => ({ value: d.id, label: `${d.manufacturer} · ${d.name} (${d.fileKind ?? "?"})` }))}
                  />
                </div>
              </div>
              <label className="mt-3 flex items-start gap-2 text-xs text-muted">
                <input type="checkbox" className="mt-0.5" checked={confirmChk} onChange={(e) => setConfirmChk(e.target.checked)} />
                <span>
                  {printerId
                    ? t("Entiendo que esto instala el driver y agrega la impresora (cola) como administrador en la PC destino.")
                    : t("Entiendo que esto instala el driver como administrador en la PC destino.")}
                </span>
              </label>
              <p className="mt-1 text-[11px] text-muted">{t("Elige la impresora del inventario para que además de instalar el driver se cree la cola apuntando a su IP (así aparece lista). Los instaladores con asistente gráfico no funcionan en remoto; se prefieren .inf/.zip con .inf.")}</p>
              <div className="mt-3 flex items-center gap-3">
                <button className="btn" onClick={install} disabled={installing || !confirmChk || !driverId}>
                  {installing ? t("Instalando…") : printerId ? t("Instalar y agregar impresora") : t("Instalar driver")}
                </button>
              </div>
            </>
          )}

          {result && (
            <div className={`mt-3 rounded-lg border p-3 ${result.ok ? "border-ok/40 bg-ok/10" : "border-danger/40 bg-danger/10"}`}>
              <div className={`text-sm font-semibold ${result.ok ? "text-ok" : "text-danger"}`}>
                {result.ok ? t("✓ Instalado") : t("✗ Falló")} · {result.driver}
              </div>
              <p className="mt-1 text-xs text-muted">{result.message}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
