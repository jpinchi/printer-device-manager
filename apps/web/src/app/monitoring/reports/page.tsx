"use client";

/**
 * Reportes: genera y descarga reportes de la flota en PDF, Excel (.xlsx) y CSV,
 * con la última data guardada. La generación es EN EL CLIENTE (ver lib/reports).
 * Extensible: añade entradas a REPORTS con su builder.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { Spinner, ErrorState, EmptyState } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiPrinter } from "@/lib/types";
import {
  buildInventoryReport,
  downloadCsv,
  downloadXlsx,
  downloadPdf,
  type ReportSpec,
} from "@/lib/reports";

type Translate = (s: string) => string;

interface ReportDef {
  id: string;
  title: string;
  description: string;
  build: (printers: ApiPrinter[], t: Translate) => ReportSpec;
}

// Registro de reportes disponibles. Añadir más aquí a futuro.
const REPORTS: ReportDef[] = [
  {
    id: "inventory",
    title: "Inventario de impresoras",
    description: "Todas las impresoras con su estado, ubicación, unidad de trabajo, tóner por color y contador.",
    build: buildInventoryReport,
  },
];

type Fmt = "pdf" | "xlsx" | "csv";

function ReportCard({ def, printers }: { def: ReportDef; printers: ApiPrinter[] }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<Fmt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const spec = useMemo(() => def.build(printers, t), [def, printers, t]);

  async function download(fmt: Fmt) {
    setBusy(fmt);
    setErr(null);
    try {
      if (fmt === "csv") downloadCsv(spec);
      else if (fmt === "xlsx") await downloadXlsx(spec);
      else await downloadPdf(spec, "Printer Device Manager");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("No se pudo generar el reporte."));
    } finally {
      setBusy(null);
    }
  }

  const btn = "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:border-accent hover:text-accent disabled:opacity-50";

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100">{t(def.title)}</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">{t(def.description)}</p>
          <p className="mt-2 text-[11px] text-slate-500">
            {spec.rows.length} {spec.rows.length === 1 ? t("registro") : t("registros")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button className={btn} disabled={busy !== null} onClick={() => download("pdf")}>
            <DocIcon /> {busy === "pdf" ? t("Generando…") : "PDF"}
          </button>
          <button className={btn} disabled={busy !== null} onClick={() => download("xlsx")}>
            <SheetIcon /> {busy === "xlsx" ? t("Generando…") : "Excel"}
          </button>
          <button className={btn} disabled={busy !== null} onClick={() => download("csv")}>
            <SheetIcon /> {busy === "csv" ? t("Generando…") : "CSV"}
          </button>
        </div>
      </div>
      {err && <p className="mt-3 text-xs text-danger">{err}</p>}
    </div>
  );
}

export default function ReportsPage() {
  const { t } = useI18n();
  const printers = useAsync<ApiPrinter[]>(() => api.listPrinters(), []);
  const list = printers.data ?? [];

  return (
    <>
      <Topbar title="Reportes" help="Genera y descarga reportes de la flota en PDF, Excel o CSV con la última data guardada." />
      <main className="flex-1 space-y-4 p-6">
        <div className="card p-5">
          <h1 className="text-sm font-semibold text-slate-100">{t("Reportes")}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            {t("Descarga la información de la flota en PDF, Excel o CSV. Los reportes usan la última data guardada; para tenerla al día, corre \"Actualizar todo\" en")}{" "}
            <Link href="/devices" className="text-accent hover:underline">{t("Impresoras")}</Link>{" "}
            {t("antes de generar.")}
          </p>
        </div>

        {printers.loading && <Spinner />}
        {printers.error && <ErrorState message={printers.error} />}
        {printers.data && list.length === 0 && (
          <EmptyState title={t("Sin datos para reportar.")} hint={t("Agrega impresoras al inventario primero.")} />
        )}

        {printers.data && list.length > 0 &&
          REPORTS.map((def) => <ReportCard key={def.id} def={def} printers={list} />)}
      </main>
    </>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function SheetIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 4v16" />
    </svg>
  );
}
