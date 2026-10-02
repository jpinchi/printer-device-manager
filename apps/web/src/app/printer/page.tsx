"use client";

/**
 * Página individual de impresora (sección 8): General, Network, Supplies,
 * Counters, Paper/Trays, Status, más historial (Fase 6) y alertas (Fase 5).
 *
 * Usa ?id= (query param) en vez de ruta dinámica para ser compatible con la
 * exportación estática (un solo puerto en producción).
 */
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { useConfirm } from "@/components/ConfirmProvider";
import { StatusBadge } from "@/components/StatusBadge";
import { SupplyBar } from "@/components/SupplyBar";
import { Select } from "@/components/Select";
import { IpLink } from "@/components/IpLink";
import { PrinterPhoto } from "@/components/PrinterPhoto";
import { getUser } from "@/lib/auth";
import { CsvDownloadButton } from "@/components/CsvDownloadButton";
import { PdfDownloadButton } from "@/components/PdfDownloadButton";
import { Spinner, ErrorState } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiPrinter, ApiLocation, ApiWorkUnit } from "@/lib/types";
import {
  latestCounters,
  fmtNumber,
  fmtUptime,
  fmtDate,
  fmtRelative,
  orderedToners,
  COUNTER_LABEL,
  COLOR_LABEL,
  tonerTone,
} from "@/lib/format";

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-100">{value ?? "—"}</dd>
    </div>
  );
}

/**
 * Nivel de una bandeja: barra de llenado (nivel/capacidad) + texto con la
 * unidad real (p. ej. "150 / 500 hojas"). Muestra "Desconocido" cuando la
 * impresora reporta valores centinela (el adaptador ya los normaliza a null).
 */
function TrayLevel({
  level,
  capacity,
  unit,
}: {
  level?: number | null;
  capacity?: number | null;
  unit?: string | null;
}) {
  const { t } = useI18n();
  const hasLevel = level != null;
  const hasCap = capacity != null && capacity > 0;
  const pct = hasLevel && hasCap ? Math.max(0, Math.min(100, Math.round((level! / capacity!) * 100))) : null;
  const u = unit ? ` ${unit}` : "";

  if (!hasLevel && !hasCap) return <span className="text-slate-500">{t("Desconocido")}</span>;

  return (
    <div className="flex items-center gap-2">
      {pct != null && (
        <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-border">
          <div
            className={`h-full rounded-full ${pct <= 15 ? "bg-danger" : "bg-accent"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <span className="font-mono text-xs tabular-nums text-slate-300">
        {hasLevel ? fmtNumber(level) : "?"}
        {hasCap ? ` / ${fmtNumber(capacity)}` : ""}
        {u}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-accent">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PrinterDetailInner() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const router = useRouter();
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";
  const printer = useAsync<ApiPrinter>(() => api.getPrinter(id), [id]);
  const locations = useAsync(() => api.listLocations(), []);
  const workUnits = useAsync(() => api.listWorkUnits(), []);

  async function poll() {
    await api.pollPrinter(id);
    printer.reload();
  }

  async function removePrinter(p: ApiPrinter) {
    const ok = await confirm({
      title: t("Eliminar impresora"),
      message: `${t("¿Eliminar la impresora")} "${p.model ?? p.serialNumber ?? p.ipAddress ?? p.name}" ${t("del inventario? Esta acción no se puede deshacer.")}`,
      confirmLabel: t("Eliminar"),
      danger: true,
    });
    if (!ok) return;
    await api.deletePrinter(id);
    router.push("/");
  }

  async function setLocation(locationId: string | null) {
    await api.setPrinterLocation(id, locationId);
    printer.reload();
  }

  async function setWorkUnit(workUnitId: string | null) {
    await api.setPrinterWorkUnit(id, workUnitId);
    printer.reload();
  }

  return (
    <>
      <Topbar title="Impresora" help="Detalle de una impresora: estado, consumibles, contadores y ubicación." />
      <main className="flex-1 space-y-6 p-6">
        <Link href="/" className="text-xs text-muted hover:text-accent">
          {t("← Volver al dashboard")}
        </Link>

        {!id && <ErrorState message={t("Falta el parámetro ?id=")} />}
        {id && printer.loading && <Spinner />}
        {printer.error && <ErrorState message={printer.error} />}

        {printer.data && (
          <PrinterDetail
            p={printer.data}
            onPoll={poll}
            onDelete={removePrinter}
            locations={locations.data?.data ?? []}
            onSetLocation={setLocation}
            workUnits={workUnits.data?.data ?? []}
            onSetWorkUnit={setWorkUnit}
          />
        )}
      </main>
    </>
  );
}

export default function PrinterPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <PrinterDetailInner />
    </Suspense>
  );
}

function PrinterDetail({
  p,
  onPoll,
  onDelete,
  locations,
  onSetLocation,
  workUnits,
  onSetWorkUnit,
}: {
  p: ApiPrinter;
  onPoll: () => void;
  onDelete: (p: ApiPrinter) => void;
  locations: ApiLocation[];
  onSetLocation: (locationId: string | null) => void;
  workUnits: ApiWorkUnit[];
  onSetWorkUnit: (workUnitId: string | null) => void;
}) {
  const counters = latestCounters(p.counters);
  const history = useAsync(() => api.getHistory(p.id), [p.id]);

  // Uptime "en vivo": sysUpTime leído + tiempo transcurrido desde la lectura.
  const liveUptime =
    p.uptimeSeconds != null && p.uptimeReadAt
      ? p.uptimeSeconds + Math.max(0, Math.floor((Date.now() - Date.parse(p.uptimeReadAt)) / 1000))
      : null;

  // Separar tóneres/tinta (barras de color) de los demás consumibles
  // (bote residual, drum, fuser, kit de mantenimiento…).
  const supplies = p.supplies ?? [];
  const toners = orderedToners(p); // K→C→M→Y
  const otherSupplies = supplies.filter((s) => s.type !== "TONER" && s.type !== "INK");

  // ¿Es una multifunción? (tiene contadores de copia/escaneo/fax o el modelo lo
  // sugiere) → la ilustración muestra la unidad de escáner superior.
  const isMfp =
    counters.some((c) => ["SCANS", "COPIES", "FAX"].includes(String(c.counterType))) ||
    /\b(IM|MP|MFP|MFC|IMAGERUNNER)\b/i.test(p.model ?? "");

  const me = getUser();
  const isAdmin = !me || me.role === "Administrator";
  const { t } = useI18n();

  return (
    <>
      {/* Cabecera */}
      <div className="card flex flex-wrap items-center gap-5 p-5">
        <PrinterPhoto manufacturer={String(p.manufacturer)} model={p.model} mfp={isMfp} canEdit={isAdmin} />
        <div className="min-w-0 flex-1">
          <div className="text-xl font-semibold">{p.model ?? p.name}</div>
          <div className="text-sm">
            <IpLink ip={p.ipAddress} className="text-sm text-muted" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusBadge status={p.status} />
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-300">
              <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 10.5a2 2 0 100-4 2 2 0 000 4z" />
                <path d="M10 18s6-4.686 6-9a6 6 0 10-12 0c0 4.314 6 9 6 9z" />
              </svg>
              {p.location?.name ?? t("Sin ubicación")}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn-ghost" onClick={onPoll}>
            {t("Actualizar (Poll)")}
          </button>
          {isAdmin && (
            <button
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:border-danger hover:text-danger"
              onClick={() => onDelete(p)}
              title={t("Eliminar impresora")}
            >
              {t("Eliminar")}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t("General")}>
          <dl className="grid grid-cols-2 gap-4">
            <Field label={t("Fabricante")} value={p.manufacturer} />
            <Field label={t("Modelo")} value={p.model} />
            <Field label={t("Número de serie")} value={p.serialNumber} />
            <Field label={t("Nombre del dispositivo")} value={p.name} />
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted">{t("Ubicación")}</dt>
              <dd className="mt-1">
                <Select
                  size="sm"
                  value={p.locationId ?? ""}
                  onChange={(v) => onSetLocation(v || null)}
                  placeholder={t("— Sin ubicación —")}
                  options={[
                    { value: "", label: t("— Sin ubicación —") },
                    ...locations.map((l) => ({ value: l.id, label: l.name })),
                  ]}
                />
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted">{t("Unidad de trabajo")}</dt>
              <dd className="mt-1">
                <Select
                  size="sm"
                  value={p.workUnitId ?? ""}
                  onChange={(v) => onSetWorkUnit(v || null)}
                  placeholder={t("— Sin unidad de trabajo —")}
                  options={[
                    { value: "", label: t("— Sin unidad de trabajo —") },
                    ...workUnits.map((w) => ({ value: w.id, label: w.name })),
                  ]}
                />
              </dd>
            </div>
            <Field label={t("Visto por última vez")} value={fmtRelative(p.lastSeen)} />
          </dl>
        </Section>

        <Section title={t("Red")}>
          <dl className="grid grid-cols-2 gap-4">
            <Field label={t("Dirección IP")} value={<IpLink ip={p.ipAddress} />} />
            <Field label={t("Dirección MAC")} value={p.macAddress && <span className="font-mono">{p.macAddress}</span>} />
            <Field label={t("Hostname")} value={p.hostname} />
            <Field label={t("Versión SNMP")} value={p.snmpVersion} />
            <Field label="sysObjectID" value={p.sysObjectId && <span className="font-mono text-xs">{p.sysObjectId}</span>} />
          </dl>
        </Section>

        <Section title={t("Consumibles")}>
          {supplies.length === 0 ? (
            <p className="text-sm text-muted">{t("Sin datos de consumibles.")}</p>
          ) : (
            <div className="space-y-4">
              {/* Tóneres / tinta: 1 en mono, 4 (K/C/M/Y) en color */}
              {toners.length > 0 && (
                <ul className="space-y-3">
                  {toners.map((s) => {
                    const tone = tonerTone(s.percent);
                    return (
                      <li key={s.id} className="grid grid-cols-[140px_1fr] items-center gap-3">
                        <span className={`text-sm ${tone.flag ? `font-medium ${tone.text}` : "text-slate-300"}`}>
                          {COLOR_LABEL[String(s.color)] ?? s.name}
                          {tone.flag && (
                            <span className="ml-1 text-[11px] font-normal">
                              · {tone.level === "critical" ? t("crítico") : tone.level === "low" ? t("bajo") : t("medio")}
                            </span>
                          )}
                        </span>
                        <SupplyBar color={String(s.color)} percent={s.percent} />
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* Otros consumibles: bote residual, drum, fuser, kit… con su nombre */}
              {otherSupplies.length > 0 && (
                <div className="border-t border-border/60 pt-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wider text-muted">
                    {t("Otros consumibles")}
                  </div>
                  <ul className="space-y-3">
                    {otherSupplies.map((s) => (
                      <li key={s.id} className="grid grid-cols-[140px_1fr] items-center gap-3">
                        <span className="text-sm text-slate-300">{s.name}</span>
                        <SupplyBar color={String(s.color)} percent={s.percent} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title={t("Contadores")}>
          {counters.length === 0 ? (
            <p className="text-sm text-muted">{t("Sin contadores.")}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-4">
              {counters
                .sort((a, b) => (a.counterType === "TOTAL" ? -1 : 0))
                .map((c) => (
                  <Field
                    key={c.id}
                    label={COUNTER_LABEL[String(c.counterType)] ?? String(c.counterType)}
                    value={<span className="font-mono tabular-nums">{fmtNumber(c.value)}</span>}
                  />
                ))}
            </dl>
          )}
        </Section>

        <Section title={t("Papel / Bandejas")}>
          {(p.trays ?? []).length === 0 ? (
            <p className="text-sm text-muted">{t("Sin datos de bandejas.")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted">
                  <th className="pb-2 text-left">{t("Bandeja")}</th>
                  <th className="pb-2 text-left">{t("Tamaño")}</th>
                  <th className="pb-2 text-left">{t("Papel")}</th>
                  <th className="pb-2 text-left">{t("Nivel")}</th>
                </tr>
              </thead>
              <tbody>
                {(p.trays ?? []).map((tray) => (
                  <tr key={tray.id} className="border-t border-border/60">
                    <td className="py-2">{tray.trayName}</td>
                    <td className="py-2 text-slate-300">{tray.paperSize ?? "—"}</td>
                    <td className="py-2 text-slate-300">{tray.paperType ?? "—"}</td>
                    <td className="py-2">
                      <TrayLevel level={tray.currentLevel} capacity={tray.capacity} unit={tray.capacityUnit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title={t("Estado y actividad")}>
          <dl className="grid grid-cols-2 gap-4">
            <Field label={t("Estado")} value={<StatusBadge status={p.status} />} />
            <Field label="Uptime" value={fmtUptime(liveUptime)} />
            <Field label={t("Visto por última vez")} value={fmtDate(p.lastSeen)} />
          </dl>
          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">
              {t("Historial reciente")}
            </div>
            {history.data?.pending ? (
              <p className="text-xs text-slate-500">{t("Historial pendiente.")}</p>
            ) : (history.data?.data?.length ?? 0) === 0 ? (
              <p className="text-xs text-slate-500">{t("Sin puntos de historial todavía.")}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>{history.data?.data?.length} {t("puntos registrados.")}</span>
                <CsvDownloadButton
                  printerId={p.id}
                  type="status"
                  className="text-accent hover:underline disabled:opacity-60"
                />
                <PdfDownloadButton
                  printer={p}
                  points={history.data?.data ?? []}
                  className="text-accent hover:underline disabled:opacity-60"
                />
              </div>
            )}
          </div>
        </Section>
      </div>
    </>
  );
}
