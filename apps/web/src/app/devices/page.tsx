"use client";

/** Lista de dispositivos (All Printers / Online / Offline según ?status). */
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { DeviceTable } from "@/components/DeviceTable";
import { Spinner, ErrorState, EmptyState } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { useRealtime } from "@/hooks/useRealtime";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiPrinter } from "@/lib/types";

function DevicesInner() {
  const { t } = useI18n();
  const sp = useSearchParams();
  const status = (sp.get("status") ?? "ALL").toUpperCase();
  const toner = (sp.get("toner") ?? "ALL").toUpperCase();
  const printers = useAsync<ApiPrinter[]>(() => api.listPrinters(), []);
  useRealtime(() => printers.reload());

  const pollAll = async () => {
    await api.pollAll();
    printers.reload();
  };

  const title =
    toner === "LOW"
      ? "Tóner bajo"
      : status === "ONLINE"
        ? "En línea"
        : status === "OFFLINE"
          ? "Fuera de línea"
          : "Impresoras";

  return (
    <>
      <Topbar title={title} help="Inventario completo. Filtra por estado, busca por nombre, modelo o IP, y entra a cada impresora para ver su detalle." />
      <main className="flex-1 space-y-6 p-6">
        {printers.loading && <Spinner />}
        {printers.error && <ErrorState message={printers.error} />}
        {printers.data &&
          (printers.data.length === 0 ? (
            <EmptyState title={t("Sin impresoras.")} hint={t("Agrégalas en Dispositivos → Agregar impresora o Red → Descubrimiento.")} />
          ) : (
            <DeviceTable
              printers={printers.data}
              initialStatus={status}
              initialToner={toner}
              onPollAll={pollAll}
              onDelete={async (p) => {
                await api.deletePrinter(p.id);
                printers.reload();
              }}
            />
          ))}
      </main>
    </>
  );
}

export default function DevicesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <DevicesInner />
    </Suspense>
  );
}
