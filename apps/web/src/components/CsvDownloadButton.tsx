"use client";

/**
 * Botón de descarga de CSV del historial. Descarga vía fetch con el token de
 * auth (un <a href> no lo adjunta y daría 401). Muestra estado "Descargando…"
 * y, si falla, un mensaje breve.
 */
import { useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function CsvDownloadButton({
  printerId,
  type = "status",
  className,
  label,
}: {
  printerId: string;
  type?: "status" | "counters";
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
      await api.downloadHistoryCsv(printerId, type);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("No se pudo descargar"));
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
          "rounded-md border border-border px-2.5 py-1.5 text-xs text-accent transition-colors hover:border-accent disabled:opacity-60"
        }
      >
        {busy ? t("Descargando…") : label ?? t("Descargar CSV")}
      </button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
