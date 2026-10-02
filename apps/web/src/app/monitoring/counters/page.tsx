"use client";

/** Vista de contadores de toda la flota (sección 6). */
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { IpLink } from "@/components/IpLink";
import { Spinner, ErrorState, EmptyState } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiPrinter } from "@/lib/types";
import { latestCounters, fmtNumber } from "@/lib/format";

// La lista de impresoras no trae contadores; se cargan los detalles con
// CONCURRENCIA ACOTADA (antes se disparaban N peticiones a la vez → avalancha
// contra el backend en flotas grandes).
async function loadPrintersWithCounters(): Promise<ApiPrinter[]> {
  const list = await api.listPrinters();
  const out: ApiPrinter[] = new Array(list.length);
  const LIMIT = 8;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(LIMIT, list.length) }, async () => {
      while (i < list.length) {
        const idx = i++;
        out[idx] = await api.getPrinter(list[idx].id);
      }
    }),
  );
  return out;
}

const COLS = ["TOTAL", "BLACK_WHITE", "COLOR", "COPIES", "PRINTS", "DUPLEX", "SCANS", "FAX"];
const COL_LABEL: Record<string, string> = {
  TOTAL: "Total", BLACK_WHITE: "B/N", COLOR: "Color", COPIES: "Copias",
  PRINTS: "Impr.", DUPLEX: "Dúplex", SCANS: "Escan.", FAX: "Fax",
};

export default function CountersPage() {
  const { t } = useI18n();
  const printers = useAsync<ApiPrinter[]>(loadPrintersWithCounters, []);

  return (
    <>
      <Topbar title="Contadores" help="Páginas impresas (total, color y negro) que cada impresora reporta por SNMP." />
      <main className="flex-1 p-6">
        {printers.loading && <Spinner label={t("Cargando contadores…")} />}
        {printers.error && <ErrorState message={printers.error} />}
        {printers.data && printers.data.length === 0 && <EmptyState title={t("Sin impresoras.")} />}
        {printers.data && printers.data.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 text-left">{t("Número de serie")}</th>
                  <th className="px-4 py-3 text-left">{t("Modelo")}</th>
                  <th className="px-4 py-3 text-left">{t("IP")}</th>
                  <th className="px-4 py-3 text-left">{t("Ubicación")}</th>
                  {COLS.map((c) => (
                    <th key={c} className="px-4 py-3 text-right">{t(COL_LABEL[c])}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {printers.data.map((p) => {
                  const counters = latestCounters(p.counters);
                  const byType = new Map(counters.map((c) => [c.counterType, c.value]));
                  return (
                    <tr key={p.id} className="border-b border-border/60 last:border-0 hover-elev">
                      <td className="px-4 py-3">
                        <Link href={`/printer?id=${p.id}`} className="font-mono font-medium text-slate-100 hover:text-accent" title={p.name}>{p.serialNumber ?? "—"}</Link>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{p.model ?? "—"}</td>
                      <td className="px-4 py-3"><IpLink ip={p.ipAddress} className="text-xs text-muted" /></td>
                      <td className="px-4 py-3 text-slate-300">{p.location?.name ?? <span className="text-slate-500">{t("Sin ubicación")}</span>}</td>
                      {COLS.map((c) => (
                        <td key={c} className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">
                          {byType.has(c) ? fmtNumber(byType.get(c)!) : "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
