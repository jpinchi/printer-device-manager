"use client";

/**
 * Catálogo de drivers de impresora (A+B+C).
 *  - Cruza los modelos de la flota (SNMP) con el catálogo.
 *  - Descarga: enlace oficial y/o instalador alojado en el servidor.
 *  - Instalar: ejecuta el instalador en el HOST Windows del servidor
 *    (solo Administrator; solo afecta a ese equipo).
 */
import { useMemo, useRef, useState } from "react";
import { HelpTip } from "@/components/HelpTip";
import { Topbar } from "@/components/Topbar";
import { Select } from "@/components/Select";
import { Spinner, ErrorState, EmptyState } from "@/components/States";
import { RemoteInstallCard } from "@/components/RemoteInstallCard";
import { useConfirm } from "@/components/ConfirmProvider";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getUser } from "@/lib/auth";
import type { ApiPrinter, ApiDriver, ApiInstallResult } from "@/lib/types";

function fmtBytes(n?: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** ¿El driver `d` aplica al modelo `model`? (coincidencia laxa por tokens) */
function driverMatchesModel(d: ApiDriver, model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  return d.models
    .toLowerCase()
    .split(/[,;/]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .some((tok) => m.includes(tok) || tok.includes(m));
}

export default function DriversPage() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const drivers = useAsync<ApiDriver[]>(() => api.listDrivers(), []);
  const printers = useAsync<ApiPrinter[]>(() => api.listPrinters(), []);
  const me = getUser();
  const isAdmin = !me || me.role === "Administrator"; // sin sesión = auth desactivada

  const list: ApiDriver[] = drivers.data ?? [];

  // Modelos distintos de la flota.
  const fleet = useMemo(() => {
    const map = new Map<string, { manufacturer: string; model: string; count: number }>();
    for (const p of printers.data ?? []) {
      const model = String(p.model ?? "").trim();
      if (!model) continue;
      const key = `${p.manufacturer}|${model}`;
      const e = map.get(key) ?? { manufacturer: String(p.manufacturer), model, count: 0 };
      e.count++;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => a.model.localeCompare(b.model));
  }, [printers.data]);

  // --- Formulario de alta ---
  const [manufacturer, setManufacturer] = useState("");
  const [models, setModels] = useState("");
  const [name, setName] = useState("");
  const [os, setOs] = useState("Windows");
  const [version, setVersion] = useState("");
  const [url, setUrl] = useState("");
  const [installArgs, setInstallArgs] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function resetForm() {
    setManufacturer("");
    setModels("");
    setName("");
    setOs("Windows");
    setVersion("");
    setUrl("");
    setInstallArgs("");
    setNotes("");
    setFile(null);
  }

  async function addDriver(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const created = await api.createDriver({
        manufacturer: manufacturer.trim(),
        models: models.trim(),
        name: name.trim(),
        os,
        version: version.trim() || undefined,
        url: url.trim() || undefined,
        installArgs: installArgs.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (file) await api.uploadDriverFile(created.id, file);
      setMsg(t("Driver añadido al catálogo."));
      resetForm();
      drivers.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("Error al añadir el driver"));
    } finally {
      setBusy(false);
    }
  }

  function prefillFor(mfr: string, model: string) {
    setManufacturer(mfr);
    setModels(model);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // --- Acciones por fila ---
  const [installResult, setInstallResult] = useState<{ name: string; r: ApiInstallResult } | null>(null);
  const [showInstallDetail, setShowInstallDetail] = useState(false);
  const [localPrinterId, setLocalPrinterId] = useState(""); // impresora del inventario a agregar al instalar local
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function download(d: ApiDriver) {
    if (d.hasFile) {
      try {
        await api.downloadDriverFile(d.id, d.fileName ?? "driver");
      } catch (err) {
        setMsg(err instanceof Error ? err.message : t("No se pudo descargar"));
      }
    } else if (d.url) {
      window.open(d.url, "_blank", "noopener,noreferrer");
    }
  }

  async function install(d: ApiDriver) {
    const ok = await confirm({
      title: t("Instalar driver"),
      message: `${t("Instalar")} "${d.name}" ${t("en ESTE equipo (el host del servidor)? Solo afecta a la máquina del servidor, no a las demás PCs.")}`,
      confirmLabel: t("Instalar"),
    });
    if (!ok) return;
    setRowBusy(d.id);
    setInstallResult(null);
    setShowInstallDetail(false);
    try {
      const r = await api.installDriver(d.id, localPrinterId || undefined);
      setInstallResult({ name: d.name, r });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("Error en la instalación"));
    } finally {
      setRowBusy(null);
    }
  }

  async function uploadTo(d: ApiDriver, f: File) {
    setRowBusy(d.id);
    setMsg(null);
    try {
      await api.uploadDriverFile(d.id, f);
      setMsg(`${t("Archivo subido para")} "${d.name}".`);
      drivers.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("No se pudo subir"));
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(d: ApiDriver) {
    const ok = await confirm({
      title: t("Eliminar driver"),
      message: `${t("¿Eliminar el driver")} "${d.name}" ${t("del catálogo?")}`,
      confirmLabel: t("Eliminar"),
      danger: true,
    });
    if (!ok) return;
    setRowBusy(d.id);
    try {
      await api.deleteDriver(d.id);
      drivers.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("No se pudo eliminar"));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <>
      <Topbar title="Drivers" help="Sube instaladores (.inf/.exe/.zip) e instálalos en otra PC del dominio de forma remota; si eliges una impresora del inventario, además crea la cola." />
      <main className="flex-1 space-y-4 p-6">
        {/* Explicación */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-100">{t("Catálogo de drivers")}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            {t("Reúne el driver de cada modelo de tu flota. Puedes guardar el enlace oficial y/o subir el instalador para servirlo desde la LAN. En un instalador alojado (.inf/.exe) puedes pulsar Instalar en este equipo, que lo instala en la máquina del servidor (Windows) — no en las PCs remotas, que deben descargarlo e instalarlo por su cuenta. Al instalar aparecerá un aviso de administrador (UAC) en la pantalla del servidor: hay que aceptarlo.")}
          </p>
          <p className="mt-2 max-w-3xl rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-[11px] leading-relaxed text-warn">
            {t("Para drivers de varios archivos (RICOH, HP…), sube el ZIP completo del paquete, no solo el .exe: el instalador necesita sus DLLs vecinas. Si el ZIP trae el asistente (RV_SETUP / setup.exe), se abre con sus pasos en la pantalla del servidor; si es solo-driver (solo .inf), se registra en silencio con pnputil.")}
          </p>
        </div>

        {/* Instalación remota (SMB/WMI) — solo Administrator */}
        {isAdmin && <RemoteInstallCard drivers={list.filter((d) => d.installable)} printers={printers.data ?? []} />}

        {/* Modelos en tu flota */}
        <section className="card p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-accent">{t("Modelos en tu flota")}</h3>
          {printers.loading ? (
            <div className="mt-3"><Spinner /></div>
          ) : fleet.length === 0 ? (
            <p className="mt-2 text-xs text-muted">{t("Sin modelos detectados todavía.")}</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {fleet.map((f) => {
                const matches = list.filter((d) => driverMatchesModel(d, f.model));
                return (
                  <div
                    key={`${f.manufacturer}-${f.model}`}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                      matches.length ? "border-ok/40 bg-ok/5" : "border-border bg-sunken"
                    }`}
                  >
                    <span className="font-medium text-slate-200">{f.model}</span>
                    <span className="text-slate-500">×{f.count}</span>
                    {matches.length ? (
                      <span className="text-ok">✓ {matches.length} driver{matches.length > 1 ? "s" : ""}</span>
                    ) : isAdmin ? (
                      <button className="text-accent hover:underline" onClick={() => prefillFor(f.manufacturer, f.model)}>
                        {t("+ añadir")}
                      </button>
                    ) : (
                      <span className="text-muted">{t("sin driver")}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Alta de driver (solo Administrator) */}
        {isAdmin && (
          <form ref={formRef} onSubmit={addDriver} className="card space-y-3 p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-accent">{t("Añadir driver")}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t("Fabricante *")}>
                <input className="input w-full" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="RICOH" />
              </Field>
              <Field label={t("Modelos que cubre *")}>
                <input className="input w-full" value={models} onChange={(e) => setModels(e.target.value)} placeholder="IM 550, IM 600" />
              </Field>
              <Field label={t("Nombre del driver *")}>
                <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="RICOH PCL6 Universal" />
              </Field>
              <Field label={t("Sistema operativo")}>
                <Select value={os} onChange={setOs} options={[{ value: "Windows", label: "Windows" }, { value: "macOS", label: "macOS" }, { value: "Linux", label: "Linux" }]} />
              </Field>
              <Field label={t("Versión")}>
                <input className="input w-full" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="4.34" />
              </Field>
              <Field label={t("URL oficial (opcional)")}>
                <input className="input w-full" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://support.ricoh.com/…" />
              </Field>
              <Field label={t("Instalador (opcional: .inf / .exe / .zip)")}>
                <input type="file" className="input w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-accent/15 file:px-2 file:py-1 file:text-accent" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Field>
              <Field label={t("Flags de instalación silenciosa (.exe)")}>
                <input className="input w-full" value={installArgs} onChange={(e) => setInstallArgs(e.target.value)} placeholder="/S  ·  /quiet" />
              </Field>
              <Field label={t("Notas (opcional)")}>
                <input className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <button className="btn" disabled={busy}>{busy ? t("Guardando…") : t("Añadir al catálogo")}</button>
              {msg && <span className="text-xs text-muted">{msg}</span>}
            </div>
          </form>
        )}

        {/* Resultado de instalación */}
        {installResult && (
          <div className={`card border p-4 ${installResult.r.ok ? "border-ok/50" : "border-danger/50"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className={`text-sm font-semibold ${installResult.r.ok ? "text-ok" : "text-danger"}`}>
                {installResult.r.ok ? t("✓ Instalado") : t("✗ La instalación falló")} · {installResult.name}
              </div>
              <button className="shrink-0 text-xs text-muted hover:text-slate-100" onClick={() => { setInstallResult(null); setShowInstallDetail(false); }}>{t("✕ cerrar")}</button>
            </div>
            <div className="mt-1 text-xs text-muted">{installResult.r.message}</div>
            {(installResult.r.stdout || installResult.r.stderr) && (
              <>
                <button
                  className="mt-2 text-[11px] text-accent hover:underline"
                  onClick={() => setShowInstallDetail((v) => !v)}
                >
                  {showInstallDetail ? t("Ocultar detalle") : t("Ver detalle")}
                </button>
                {showInstallDetail && (
                  <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-code p-3 text-[11px] leading-relaxed text-slate-300">
                    {installResult.r.stdout}
                    {installResult.r.stderr ? `\n${installResult.r.stderr}` : ""}
                  </pre>
                )}
              </>
            )}
          </div>
        )}

        {/* Catálogo */}
        {drivers.loading && <Spinner />}
        {drivers.error && <ErrorState message={drivers.error} />}
        {drivers.data && list.length === 0 && (
          <EmptyState title={t("Catálogo vacío.")} hint={isAdmin ? t("Añade el primer driver con el formulario de arriba.") : t("Un administrador aún no ha cargado drivers.")} />
        )}
        {isAdmin && list.some((d) => d.installable) && (printers.data?.length ?? 0) > 0 && (
          <div className="card flex flex-wrap items-end gap-3 p-4">
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[11px] uppercase text-muted">
                {t("Al instalar en este equipo, agregar también la impresora (opcional)")}
                <HelpTip
                  title="Instalar en este equipo"
                  body="Instala el driver en esta misma máquina (la que corre el servidor), no en otras PC. Pedirá permiso de administrador (UAC). Si eliges una impresora del inventario, además crea su cola (puerto e impresora) apuntando a su IP, para que quede lista para imprimir. Para instalar en otras PC, usa la instalación remota de arriba."
                />
              </label>
              <Select
                className="min-w-[320px]"
                value={localPrinterId}
                onChange={setLocalPrinterId}
                placeholder={t("Ninguna — solo instalar el driver")}
                options={[
                  { value: "", label: t("Ninguna — solo instalar el driver") },
                  ...(printers.data ?? []).map((p) => ({
                    value: p.id,
                    label: [p.model, p.location?.name, p.ipAddress].filter(Boolean).join(" · "),
                  })),
                ]}
              />
            </div>
            <p className="max-w-md text-[11px] text-muted">{t("Si eliges una impresora, además de instalar el driver se crea la cola apuntando a su IP en esta máquina (así queda lista para imprimir).")}</p>
          </div>
        )}

        {list.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 text-left">{t("Fabricante")}</th>
                  <th className="px-4 py-3 text-left">{t("Modelos")}</th>
                  <th className="px-4 py-3 text-left">Driver</th>
                  <th className="px-4 py-3 text-left">{t("Archivo")}</th>
                  <th className="px-4 py-3 text-right">{t("Acciones")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="border-b border-border/60 last:border-0 hover-elev">
                    <td className="px-4 py-3 font-medium text-slate-200">{d.manufacturer}</td>
                    <td className="px-4 py-3 text-slate-300">{d.models}</td>
                    <td className="px-4 py-3">
                      <div className="text-slate-100">{d.name}</div>
                      <div className="text-[11px] text-muted">
                        {d.os}
                        {d.version ? ` · v${d.version}` : ""}
                        {d.notes ? ` · ${d.notes}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {d.hasFile ? (
                        <span className="text-slate-300">
                          {d.fileName} <span className="text-slate-500">({fmtBytes(d.fileSize)})</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {(d.hasFile || d.url) && (
                          <button
                            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
                            onClick={() => download(d)}
                          >
                            {d.hasFile ? t("Descargar") : t("Descargar (oficial ↗)")}
                          </button>
                        )}
                        {isAdmin && d.installable && (
                          <button
                            className="rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-xs text-accent transition hover:border-accent disabled:opacity-50"
                            onClick={() => install(d)}
                            disabled={rowBusy === d.id}
                          >
                            {rowBusy === d.id ? t("Instalando…") : t("Instalar en este equipo")}
                          </button>
                        )}
                        {isAdmin && !d.hasFile && (
                          <label className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent">
                            {t("Subir archivo")}
                            <input
                              type="file"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) uploadTo(d, f);
                              }}
                            />
                          </label>
                        )}
                        {isAdmin && (
                          <button
                            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
                            onClick={() => remove(d)}
                            disabled={rowBusy === d.id}
                          >
                            {t("Eliminar")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{label}</label>
      {children}
    </div>
  );
}
