"use client";

/** Vista de consumibles de toda la flota (sección 6). */
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { SupplyBar } from "@/components/SupplyBar";
import { IpLink } from "@/components/IpLink";
import { Spinner, ErrorState, EmptyState } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { useRealtime } from "@/hooks/useRealtime";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiPrinter } from "@/lib/types";
import { orderedToners, lowToners, COLOR_LABEL, tonerTone } from "@/lib/format";

export default function SuppliesPage() {
  const { t } = useI18n();
  const printers = useAsync<ApiPrinter[]>(() => api.listPrinters(), []);
  useRealtime(() => printers.reload());

  return (
    <>
      <Topbar title="Consumibles" help="Niveles de tóner y suministros. Las barras se ponen en rojo cuando bajan del umbral configurado en Ajustes." />
      <main className="flex-1 space-y-4 p-6">
        {/* Botón flotante persistente, a la derecha, fijo junto a la barra
            superior (solo en Consumibles). Sin franja de fondo: solo el botón
            flota sobre el contenido. top-[73px] deja un pequeño espacio bajo el
            Topbar (65px) para el efecto flotante. */}
        <div className="pointer-events-none sticky top-[73px] z-20 -mt-1 flex justify-end">
          <a
            href="https://ricohlatinamerica.service-now.com/navpage.do"
            target="_blank"
            rel="noopener noreferrer"
            className="btn pointer-events-auto inline-flex items-center gap-2 shadow-lg"
            title={t("Abre el portal de RICOH para solicitar tóner")}
          >
            {/* Cilindro / botella de tóner: tapa + cuerpo cilíndrico + banda. */}
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="2.5" width="6" height="3" rx="1" />
              <rect x="6.5" y="5.5" width="11" height="16" rx="3" />
              <path d="M6.5 9.5h11" />
              <path d="M9.5 14h5" />
            </svg>
            {t("Solicitar tóner")}
          </a>
        </div>

        {printers.loading && <Spinner />}
        {printers.error && <ErrorState message={printers.error} />}
        {printers.data && printers.data.length === 0 && <EmptyState title={t("Sin impresoras.")} />}
        {printers.data &&
          printers.data.map((p) => {
            const supplies = orderedToners(p);
            const lows = lowToners(p);
            return (
              <div key={p.id} className="card p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/printer?id=${p.id}`} className="font-medium hover:text-accent">
                        {p.name} <span className="text-xs text-muted">· {p.model}</span>
                      </Link>
                      {lows.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-danger/50 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger">
                          ⚠ {t("Tóner bajo")}
                          <span className="font-mono">
                            {lows.map((s) => COLOR_LABEL[String(s.color)] ?? s.name).join(", ")}
                          </span>
                        </span>
                      )}
                    </div>
                    {/* Ubicación de la impresora monitoreada */}
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 10.5a2 2 0 100-4 2 2 0 000 4z" />
                        <path d="M10 18s6-4.686 6-9a6 6 0 10-12 0c0 4.314 6 9 6 9z" />
                      </svg>
                      <span className="truncate">{p.location?.name ?? t("Sin ubicación")}</span>
                    </div>
                  </div>
                  <IpLink ip={p.ipAddress} className="shrink-0 text-xs text-muted" />
                </div>
                {supplies.length === 0 ? (
                  <p className="text-sm text-muted">{t("Sin datos de consumibles.")}</p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {supplies.map((s) => {
                      const tone = tonerTone(s.percent);
                      return (
                        <li key={s.id} className="grid grid-cols-[110px_1fr] items-center gap-3">
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
              </div>
            );
          })}
      </main>
    </>
  );
}
