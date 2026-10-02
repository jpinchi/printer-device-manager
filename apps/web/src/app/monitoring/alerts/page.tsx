"use client";

/** Vista de alertas (Fase 5): listado con ack/resolución. */
import { useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { IpLink } from "@/components/IpLink";
import { Spinner, ErrorState, EmptyState, PendingState } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { useRealtime } from "@/hooks/useRealtime";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiAlert } from "@/lib/types";
import { fmtRelative, alertLevel, ALERT_TEXT, ALERT_BORDER, ALERT_TINT_VAR } from "@/lib/format";

export default function AlertsPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState("active");
  const alerts = useAsync(() => api.listAlerts(status), [status]);
  useRealtime(() => alerts.reload());

  async function ack(id: string) { await api.ackAlert(id); alerts.reload(); }
  async function resolve(id: string) { await api.resolveAlert(id); alerts.reload(); }

  const soft = alerts.data;
  const list: ApiAlert[] = soft?.data ?? [];

  return (
    <>
      <Topbar title="Alertas" help="Avisos automáticos: tóner bajo, sin papel, atascos o impresora fuera de línea." />
      <main className="flex-1 space-y-4 p-6">
        <div className="flex gap-2">
          {["active", "resolved", "all"].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-lg px-3 py-1.5 text-sm capitalize ${status === s ? "bg-accent/15 text-accent" : "text-muted hover-elev"}`}
            >
              {s === "active" ? t("Activas") : s === "resolved" ? t("Resueltas") : t("Todas")}
            </button>
          ))}
        </div>

        {alerts.loading && <Spinner />}
        {alerts.error && <ErrorState message={alerts.error} />}
        {soft?.pending && <PendingState feature="Alertas" agent="Alert Engine (Fase 5)" />}
        {soft && !soft.pending && list.length === 0 && (
          <EmptyState title={t("Sin alertas.")} hint={t("No hay alertas que coincidan con el filtro.")} />
        )}

        {list.length > 0 && (
          <div className="space-y-3">
            {list.map((a) => {
              const pr = a.printer;
              const lvl = alertLevel(a);
              const tone = ALERT_TEXT[lvl];
              // Los avisos "a la mitad" (notice) nacen resueltos pero deben tener
              // PROTAGONISMO: no se atenúan. El resto de resueltas sí se atenúan.
              const dim = a.resolvedAt && lvl !== "notice";
              // Tinte MUY tenue del color del nivel sobre la tarjeta (el
              // background-image se pinta encima del background-color, así no se
              // pierde la card). Todas las tarjetas lo llevan según su nivel.
              const tintStyle = {
                backgroundImage: `linear-gradient(rgb(var(${ALERT_TINT_VAR[lvl]}) / 0.08), rgb(var(${ALERT_TINT_VAR[lvl]}) / 0.08))`,
              };
              return (
                <div
                  key={a.id}
                  style={tintStyle}
                  className={`card animate-fade-in-up flex flex-col gap-3 border-l-4 ${ALERT_BORDER[lvl]} p-4 sm:flex-row sm:items-start sm:justify-between ${dim ? "opacity-70" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    {/* Severidad + tipo */}
                    <div className={`text-xs font-semibold uppercase tracking-wider ${tone}`}>
                      {a.severity} · {a.type}
                    </div>

                    {/* Impresora afectada — prominente */}
                    <div className="mt-1.5">
                      {a.printerId ? (
                        <Link href={`/printer?id=${a.printerId}`} className="text-base font-semibold text-slate-100 hover:text-accent">
                          {pr?.name ?? t("Impresora")}
                        </Link>
                      ) : (
                        <span className="text-base font-semibold text-slate-100">{pr?.name ?? t("Impresora")}</span>
                      )}
                      {pr && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                          {pr.ip && <IpLink ip={pr.ip} />}
                          {pr.model && <span>· {pr.model}</span>}
                          {pr.manufacturer && <span className="text-slate-500">{pr.manufacturer}</span>}
                          <span className="inline-flex items-center gap-1">
                            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10 10.5a2 2 0 100-4 2 2 0 000 4z" />
                              <path d="M10 18s6-4.686 6-9a6 6 0 10-12 0c0 4.314 6 9 6 9z" />
                            </svg>
                            {pr.location ?? t("Sin ubicación")}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Mensaje de la alerta */}
                    <div className="mt-2 text-sm text-slate-200">{a.message}</div>

                    {/* Metadatos temporales */}
                    <div className="mt-1 text-[11px] text-slate-500">
                      {fmtRelative(a.createdAt)}
                      {a.acknowledgedAt && ` · ${t("reconocida")}`}
                      {a.resolvedAt && ` · ${t("resuelta")}`}
                    </div>
                  </div>

                  {!a.resolvedAt && (
                    <div className="flex shrink-0 gap-2">
                      {!a.acknowledgedAt && (
                        <button className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent" onClick={() => ack(a.id)}>
                          {t("Reconocer")}
                        </button>
                      )}
                      <button className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-ok hover:text-ok" onClick={() => resolve(a.id)}>
                        {t("Resolver")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
