"use client";

/** Tarjetas de resumen de la flota (sección 7). */
import Link from "next/link";
import type { ApiPrinter, ApiAlert } from "@/lib/types";
import { hasTonerLow } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface CardDef {
  label: string;
  value: number;
  tone: "neutral" | "ok" | "warn" | "danger";
  pending?: boolean;
  /** Destino al hacer clic en la tarjeta (vista filtrada). */
  href?: string;
}

function toneClasses(tone: CardDef["tone"]): string {
  switch (tone) {
    case "ok":
      return "text-ok";
    case "warn":
      return "text-warn";
    case "danger":
      return "text-danger";
    default:
      return "text-slate-100";
  }
}

function toneDot(tone: CardDef["tone"]): string {
  switch (tone) {
    case "ok":
      return "bg-ok shadow-[0_0_12px_rgba(34,197,94,0.6)]";
    case "warn":
      return "bg-warn shadow-[0_0_12px_rgba(245,158,11,0.6)]";
    case "danger":
      return "bg-danger shadow-[0_0_12px_rgba(244,63,94,0.6)]";
    default:
      return "bg-slate-500";
  }
}

export function SummaryCards({
  printers,
  alerts,
  alertsPending,
}: {
  printers: ApiPrinter[];
  alerts: ApiAlert[];
  alertsPending: boolean;
}) {
  const { t } = useI18n();
  const total = printers.length;
  const online = printers.filter((p) => p.status === "ONLINE").length;
  const offline = printers.filter((p) => p.status === "OFFLINE").length;
  const tonerLow = printers.filter(hasTonerLow).length;

  // Errores/Warnings se derivan de las alertas activas (sin resolver).
  const active = alerts.filter((a) => !a.resolvedAt);
  const errors = active.filter((a) => a.severity === "ERROR").length;
  const warnings = active.filter((a) => a.severity === "WARNING").length;

  const cards: CardDef[] = [
    { label: "Total de equipos", value: total, tone: "neutral", href: "/devices" },
    { label: "En línea", value: online, tone: "ok", href: "/devices?status=ONLINE" },
    { label: "Fuera de línea", value: offline, tone: offline ? "danger" : "neutral", href: "/devices?status=OFFLINE" },
    { label: "Tóner bajo", value: tonerLow, tone: tonerLow ? "warn" : "neutral", href: "/devices?toner=low" },
    { label: "Errores", value: errors, tone: errors ? "danger" : "neutral", pending: alertsPending, href: "/monitoring/alerts" },
    { label: "Advertencias", value: warnings, tone: warnings ? "warn" : "neutral", pending: alertsPending, href: "/monitoring/alerts" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c, i) => {
        const inner = (
          <>
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
                {t(c.label)}
              </div>
              <span className={`h-2 w-2 rounded-full ${toneDot(c.tone)}`} />
            </div>
            <div
              className={`mt-2 text-3xl font-bold tabular-nums ${
                c.label === "Total de equipos" ? "text-gradient" : toneClasses(c.tone)
              }`}
            >
              {c.pending ? "—" : c.value}
            </div>
            {c.pending && (
              <div className="mt-1 text-[10px] text-slate-500">{t("alertas pendiente")}</div>
            )}
          </>
        );

        const cardClass =
          "card animate-fade-in-up p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow";
        const style = { animationDelay: `${i * 45}ms` };

        // Si la tarjeta tiene destino, se vuelve navegable (cursor pointer + foco).
        return c.href ? (
          <Link
            key={c.label}
            href={c.href}
            className={`${cardClass} block cursor-pointer outline-none focus-visible:border-accent/60 focus-visible:shadow-glow`}
            style={style}
          >
            {inner}
          </Link>
        ) : (
          <div key={c.label} className={cardClass} style={style}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
