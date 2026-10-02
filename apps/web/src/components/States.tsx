"use client";

/** Estados reutilizables: cargando, error, vacío y "pendiente" (endpoint futuro). */
import { useI18n } from "@/lib/i18n";

export function Spinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex animate-fade-in items-center justify-center gap-3 py-16 text-sm text-muted">
      <span className="relative inline-flex h-5 w-5">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
        <span className="absolute inset-1 animate-ping rounded-full bg-accent/20" />
      </span>
      {label ?? t("Cargando…")}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className="card p-6 text-center">
      <p className="text-sm text-red-300">{t("No se pudieron cargar los datos.")}</p>
      <p className="mt-1 text-xs text-muted">{message}</p>
      <p className="mt-3 text-xs text-slate-500">
        {t("¿Está el backend corriendo? Verifica la conexión.")}
      </p>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="card p-10 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Estado "pendiente": el endpoint lo construye otro agente en paralelo. */
export function PendingState({
  feature,
  agent,
}: {
  feature: string;
  agent: string;
}) {
  const { t } = useI18n();
  return (
    <div className="card border-dashed p-10 text-center">
      <p className="text-sm font-medium text-slate-200">
        {feature} — {t("pendiente")}
      </p>
      <p className="mx-auto mt-2 max-w-md text-xs text-muted">
        {t("Este módulo consume un endpoint que aún no responde; se poblará automáticamente cuando esté disponible.")}{" "}
        <span className="text-accent">{agent}</span>
      </p>
    </div>
  );
}
