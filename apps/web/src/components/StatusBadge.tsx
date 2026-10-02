"use client";

/** Indicador de estado online/offline con punto de color. */
import { useI18n } from "@/lib/i18n";

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const s = (status || "UNKNOWN").toUpperCase();
  const color =
    s === "ONLINE" ? "bg-ok" : s === "OFFLINE" ? "bg-danger" : "bg-muted";
  const label =
    s === "ONLINE" ? t("En línea") : s === "OFFLINE" ? t("Fuera de línea") : t("Desconocido");
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
