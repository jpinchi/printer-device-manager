"use client";

/**
 * Panel de control (#7): centro de acción de la flota. Agrega lo que ya se
 * recolecta (estado, tóner, contadores, alertas) en widgets accionables:
 * qué requiere atención, tóners bajos, top consumidoras, consumo/costo estimado
 * y alertas recientes.
 */
import Link from "next/link";
import { useMemo } from "react";
import { Topbar } from "@/components/Topbar";
import { Spinner, ErrorState } from "@/components/States";
import { StatusBadge } from "@/components/StatusBadge";
import { IpLink } from "@/components/IpLink";
import { useAsync } from "@/hooks/useAsync";
import { useRealtime } from "@/hooks/useRealtime";
import { useTheme } from "@/hooks/useTheme";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiPrinter, ApiAlert } from "@/lib/types";
import {
  latestCounters,
  totalCounter,
  orderedToners,
  lowToners,
  fmtNumber,
  fmtRelative,
  supplyBarColor,
  COLOR_LABEL,
  TONER_LOW_THRESHOLD,
  tonerTone,
  alertLevel,
  ALERT_TEXT,
} from "@/lib/format";

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-accent">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, tone = "text-slate-100", href }: { label: string; value: React.ReactNode; tone?: string; href?: string }) {
  const inner = (
    <>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
    </>
  );
  const cls = "card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow";
  return href ? <Link href={href} className={`${cls} block`}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

export default function PanelPage() {
  const { t } = useI18n();
  const printers = useAsync<ApiPrinter[]>(() => api.listPrinters(), []);
  const alerts = useAsync(() => api.listAlerts("active"), []);
  const theme = useTheme();
  useRealtime(() => {
    printers.reload();
    alerts.reload();
  });

  const list = printers.data ?? [];
  const activeAlerts: ApiAlert[] = (alerts.data?.data ?? []).filter((a) => !a.resolvedAt);

  const derived = useMemo(() => {
    const online = list.filter((p) => String(p.status).toUpperCase() === "ONLINE").length;
    const offline = list.filter((p) => String(p.status).toUpperCase() === "OFFLINE");

    // Tóners bajos por impresora (usa el umbral configurado).
    const lowByPrinter = list
      .map((p) => ({ p, lows: lowToners(p) }))
      .filter((x) => x.lows.length > 0);

    // Requieren atención: offline o con alerta activa de ERROR.
    const errorPrinterIds = new Set(activeAlerts.filter((a) => a.severity === "ERROR").map((a) => a.printerId));
    const attention = list
      .filter((p) => String(p.status).toUpperCase() === "OFFLINE" || errorPrinterIds.has(p.id))
      .map((p) => {
        const errs = activeAlerts.filter((a) => a.printerId === p.id && a.severity === "ERROR");
        const reason =
          String(p.status).toUpperCase() === "OFFLINE"
            ? "Fuera de línea"
            : errs[0]?.type || "Error del dispositivo";
        return { p, reason };
      });

    // Top consumidoras por total de páginas.
    const top = [...list]
      .map((p) => ({ p, total: totalCounter(p) ?? 0 }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Consumo acumulado por tipo (para costo estimado).
    let bwPages = 0;
    let colorPages = 0;
    for (const p of list) {
      const cs = latestCounters(p.counters);
      const bw = cs.find((c) => c.counterType === "BLACK_WHITE")?.value;
      const color = cs.find((c) => c.counterType === "COLOR")?.value;
      const total = cs.find((c) => c.counterType === "TOTAL")?.value ?? 0;
      if (bw != null || color != null) {
        bwPages += bw ?? 0;
        colorPages += color ?? 0;
      } else {
        bwPages += total; // sin desglose → se asume B/N (mono)
      }
    }
    return { online, offline, lowByPrinter, attention, top, bwPages, colorPages };
    // Deps ESTABLES (las referencias de datos), no `list`/`activeAlerts` que son
    // arrays nuevos en cada render — si no, el memo recomputaría siempre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printers.data, alerts.data]);

  if (printers.loading && !printers.data) return (<><Topbar title="Panel de control" help="Métricas clave y accesos rápidos a las secciones más usadas." /><main className="flex-1 p-6"><Spinner /></main></>);
  if (printers.error) return (<><Topbar title="Panel de control" help="Métricas clave y accesos rápidos a las secciones más usadas." /><main className="flex-1 p-6"><ErrorState message={printers.error} /></main></>);

  return (
    <>
      <Topbar title="Panel de control" help="Métricas clave y accesos rápidos a las secciones más usadas." />
      <main className="flex-1 space-y-4 p-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label={t("Impresoras")} value={list.length} href="/devices" />
          <Kpi label={t("En línea")} value={derived.online} tone="text-ok" href="/devices?status=ONLINE" />
          <Kpi label={t("Fuera de línea")} value={derived.offline.length} tone={derived.offline.length ? "text-danger" : "text-slate-100"} href="/devices?status=OFFLINE" />
          <Kpi label={t("Alertas activas")} value={activeAlerts.length} tone={activeAlerts.length ? "text-warn" : "text-slate-100"} href="/monitoring/alerts" />
          <Kpi label={t("Tóners bajos")} value={derived.lowByPrinter.length} tone={derived.lowByPrinter.length ? "text-danger" : "text-slate-100"} href="/devices?toner=low" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Requieren atención */}
          <Card title={t("Requieren atención")} right={<span className="text-[11px] text-muted">{derived.attention.length}</span>}>
            {derived.attention.length === 0 ? (
              <p className="text-sm text-ok">{t("✓ Todo en orden.")}</p>
            ) : (
              <ul className="space-y-2">
                {derived.attention.map(({ p, reason }) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-sunken px-3 py-2">
                    <div className="min-w-0">
                      <Link href={`/printer?id=${p.id}`} className="font-medium text-slate-100 hover:text-accent">{p.name}</Link>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <IpLink ip={p.ipAddress} className="text-[11px]" />
                        {p.location?.name && <span>· {p.location.name}</span>}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-danger/50 bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">{t(reason)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Tóners bajos */}
          <Card title={t("Tóners bajos")} right={<Link href="/devices?toner=low" className="text-[11px] text-accent hover:underline">{t("ver todo")}</Link>}>
            {derived.lowByPrinter.length === 0 ? (
              <p className="text-sm text-muted">{t("Ninguno bajo el umbral")} ({TONER_LOW_THRESHOLD}%).</p>
            ) : (
              <ul className="space-y-2">
                {derived.lowByPrinter.slice(0, 8).map(({ p, lows }) => (
                  <li key={p.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/printer?id=${p.id}`} className="block truncate text-sm text-slate-200 hover:text-accent">{p.name}</Link>
                      <div className="truncate text-[11px] text-muted">{p.location?.name ?? t("Sin ubicación")}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      {lows.map((s) => {
                        // Color por nivel (helper compartido): rojo crítico / ámbar bajo.
                        const tone = tonerTone(s.percent);
                        return (
                          <span key={s.id} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${tone.chip}`} title={COLOR_LABEL[String(s.color)] ?? s.name}>
                            <span className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/20" style={{ backgroundColor: supplyBarColor(String(s.color), theme) }} />
                            <span className="font-mono text-sm font-bold tabular-nums">{s.percent ?? 0}%</span>
                          </span>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Top consumidoras */}
          <Card title={t("Top consumidoras (páginas)")}>
            {derived.top.length === 0 ? (
              <p className="text-sm text-muted">{t("Sin datos de contadores todavía.")}</p>
            ) : (
              <ul className="space-y-2">
                {derived.top.map(({ p, total }, i) => {
                  const max = derived.top[0].total || 1;
                  return (
                    <li key={p.id} className="flex items-center gap-3">
                      <span className="w-4 shrink-0 text-right text-xs text-slate-500">{i + 1}</span>
                      <div className="w-40 shrink-0">
                        <Link href={`/printer?id=${p.id}`} className="block truncate text-sm text-slate-200 hover:text-accent">{p.name}</Link>
                        <div className="truncate text-[10px] text-muted">{p.location?.name ?? t("Sin ubicación")}</div>
                      </div>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((total / max) * 100)}%` }} />
                      </div>
                      <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-slate-300">{fmtNumber(total)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Consumo acumulado */}
          <Card title={t("Consumo acumulado")}>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-sunken p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted">{t("Páginas B/N")}</div>
                <div className="mt-1 font-mono text-lg tabular-nums text-slate-100">{fmtNumber(derived.bwPages)}</div>
              </div>
              <div className="rounded-lg border border-border bg-sunken p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted">{t("Páginas color")}</div>
                <div className="mt-1 font-mono text-lg tabular-nums text-slate-100">{fmtNumber(derived.colorPages)}</div>
              </div>
            </div>
          </Card>
        </div>

        {/* Alertas recientes */}
        <Card title={t("Alertas recientes")} right={<Link href="/monitoring/alerts" className="text-[11px] text-accent hover:underline">{t("ver todas")}</Link>}>
          {alerts.data?.pending ? (
            <p className="text-sm text-muted">{t("Motor de alertas pendiente.")}</p>
          ) : activeAlerts.length === 0 ? (
            <p className="text-sm text-ok">{t("✓ Sin alertas activas.")}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {activeAlerts.slice(0, 6).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${ALERT_TEXT[alertLevel(a)]}`}>{a.severity} · {a.type}</span>
                    <div className="truncate text-sm text-slate-200">
                      {a.printerId ? <Link href={`/printer?id=${a.printerId}`} className="hover:text-accent">{a.printer?.name ?? t("Impresora")}</Link> : (a.printer?.name ?? "Impresora")}
                      {a.printer?.location ? <span className="text-slate-500"> · {a.printer.location}</span> : null}
                      {a.message ? <span className="text-muted"> — {a.message}</span> : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500">{fmtRelative(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
