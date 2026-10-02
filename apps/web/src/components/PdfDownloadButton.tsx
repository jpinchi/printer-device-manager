"use client";

/**
 * Botón que descarga un reporte PDF profesional del historial de la impresora
 * (tema oscuro de la app, gráficas vectoriales y tabla). Se genera en el cliente
 * a partir de los datos ya cargados. jsPDF se importa de forma diferida para no
 * cargarlo hasta que se use.
 */
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { ApiPrinter, ApiHistoryPoint } from "@/lib/types";

export function PdfDownloadButton({
  printer,
  points,
  className,
  label,
}: {
  printer: ApiPrinter;
  points: ApiHistoryPoint[];
  className?: string;
  label?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const { generateHistoryReport } = await import("@/lib/report");
      generateHistoryReport(printer, points);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("No se pudo generar el PDF"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:border-accent hover:bg-accent/15 disabled:opacity-60"
        }
      >
        {busy ? t("Generando…") : label ?? t("Descargar PDF")}
      </button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
