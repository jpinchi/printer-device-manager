"use client";

/**
 * Tabla principal de dispositivos (sección 7).
 * Filtros (estado, fabricante), búsqueda, ordenamiento y agrupación por
 * ubicación. Trabaja sobre datos ya cargados (client-side).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ApiPrinter } from "@/lib/types";
import {
  totalCounter,
  fmtNumber,
  hasTonerLow,
  orderedToners,
  minTonerPercent,
  COLOR_LETTER,
  COLOR_LABEL,
  supplyBarColor,
  tonerTone,
} from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { Select } from "@/components/Select";
import { IpLink } from "@/components/IpLink";
import { useConfirm } from "@/components/ConfirmProvider";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/lib/i18n";

type SortKey = "serialNumber" | "ipAddress" | "model" | "location" | "workUnit" | "toner" | "counter";
type SortDir = "asc" | "desc";

const UNGROUPED = "Sin ubicación";

function locationName(p: ApiPrinter): string {
  return p.location?.name ?? UNGROUPED;
}

function workUnitName(p: ApiPrinter): string {
  return p.workUnit?.name ?? "";
}

export function DeviceTable({
  printers,
  initialStatus = "ALL",
  initialToner = "ALL",
  onPollAll,
  onDelete,
}: {
  printers: ApiPrinter[];
  initialStatus?: string;
  /** Filtro inicial de tóner: "ALL" | "LOW" (desde ?toner=low). */
  initialToner?: string;
  /** Si se provee, muestra un botón para re-consultar toda la flota por SNMP. */
  onPollAll?: () => Promise<void>;
  /** Si se provee, muestra un botón para eliminar cada impresora de la lista. */
  onDelete?: (p: ApiPrinter) => Promise<void>;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus.toUpperCase());
  const [toner, setToner] = useState(initialToner.toUpperCase());
  const [manufacturer, setManufacturer] = useState("ALL");
  const [model, setModel] = useState("ALL");

  // Los filtros deben reaccionar cuando cambian `initialStatus`/`initialToner`
  // al navegar (?status=…, ?toner=low): el componente no se remonta, solo
  // cambian los props. Sincronizamos el estado del filtro.
  useEffect(() => {
    setStatus(initialStatus.toUpperCase());
  }, [initialStatus]);
  useEffect(() => {
    setToner(initialToner.toUpperCase());
  }, [initialToner]);
  const [grouped, setGrouped] = useState(false);
  const [pollingAll, setPollingAll] = useState(false);

  async function handlePollAll() {
    if (!onPollAll) return;
    setPollingAll(true);
    try {
      await onPollAll();
    } finally {
      setPollingAll(false);
    }
  }

  async function handleDelete(p: ApiPrinter) {
    if (!onDelete) return;
    const ok = await confirm({
      title: t("Eliminar impresora"),
      message: `${t("¿Eliminar la impresora")} "${p.model ?? p.serialNumber ?? p.ipAddress ?? p.name}" ${t("del inventario? Esta acción no se puede deshacer.")}`,
      confirmLabel: t("Eliminar"),
      danger: true,
    });
    if (!ok) return;
    setDeletingId(p.id);
    try {
      await onDelete(p);
    } finally {
      setDeletingId(null);
    }
  }
  const [sortKey, setSortKey] = useState<SortKey>("location");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const manufacturers = useMemo(() => {
    const set = new Set<string>();
    printers.forEach((p) => p.manufacturer && set.add(String(p.manufacturer)));
    return [...set].sort();
  }, [printers]);

  const models = useMemo(() => {
    const set = new Set<string>();
    printers.forEach((p) => p.model && set.add(String(p.model)));
    return [...set].sort();
  }, [printers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return printers.filter((p) => {
      if (status !== "ALL" && String(p.status).toUpperCase() !== status)
        return false;
      if (toner === "LOW" && !hasTonerLow(p)) return false;
      if (manufacturer !== "ALL" && String(p.manufacturer) !== manufacturer)
        return false;
      if (model !== "ALL" && String(p.model) !== model) return false;
      if (!q) return true;
      const hay = [
        p.name,
        p.ipAddress,
        p.model,
        p.serialNumber,
        p.location?.name,
        p.manufacturer,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [printers, search, status, toner, manufacturer, model]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (sortKey) {
        case "toner":
          av = minTonerPercent(a) ?? 101;
          bv = minTonerPercent(b) ?? 101;
          break;
        case "counter":
          av = totalCounter(a) ?? -1;
          bv = totalCounter(b) ?? -1;
          break;
        case "location":
          av = locationName(a).toLowerCase();
          bv = locationName(b).toLowerCase();
          break;
        case "workUnit":
          av = workUnitName(a).toLowerCase();
          bv = workUnitName(b).toLowerCase();
          break;
        default: {
          av = String(a[sortKey] ?? "").toLowerCase();
          bv = String(b[sortKey] ?? "").toLowerCase();
        }
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const groups = useMemo(() => {
    if (!grouped) return null;
    const map = new Map<string, ApiPrinter[]>();
    for (const p of sorted) {
      const key = locationName(p);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sorted, grouped]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const columns: { key: SortKey | null; label: string }[] = [
    { key: null, label: "Estado" },
    { key: "serialNumber", label: "Número de serie" },
    { key: "ipAddress", label: "IP" },
    { key: "model", label: "Modelo" },
    { key: "location", label: "Ubicación" },
    { key: "workUnit", label: "Unidad de trabajo" },
    { key: "toner", label: "Tóner" },
    { key: "counter", label: "Contador" },
    { key: null, label: "" },
  ];

  function renderRow(p: ApiPrinter) {
    return (
      <tr key={p.id} className="border-b border-border/60 last:border-0 hover-elev">
        <td className="whitespace-nowrap px-4 py-3">
          <StatusBadge status={p.status} />
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <Link
            href={`/printer?id=${p.id}`}
            className="font-mono font-medium text-slate-100 hover:text-accent"
            title={p.name}
          >
            {p.serialNumber ?? "—"}
          </Link>
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <IpLink ip={p.ipAddress} className="text-xs text-muted" />
        </td>
        <td className="px-4 py-3 text-slate-300">{p.model ?? "—"}</td>
        <td className="px-4 py-3 text-slate-300">
          {p.location?.name ?? "—"}
        </td>
        <td className="px-4 py-3 text-slate-300">
          {p.workUnit?.name ?? "—"}
        </td>
        <td className="px-4 py-3">
          <TonerCell p={p} />
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-300">
          {fmtNumber(totalCounter(p))}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <Link
              href={`/printer?id=${p.id}`}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
            >
              {t("Ver")}
            </Link>
            {onDelete && (
              <button
                onClick={() => handleDelete(p)}
                disabled={deletingId === p.id}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
                title={t("Eliminar impresora")}
              >
                {deletingId === p.id ? "…" : t("Eliminar")}
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-3">
      {/* Controles: búsqueda + filtros + agrupar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[220px] flex-1"
          placeholder={t("Buscar por nombre, IP, modelo, serial, ubicación…")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="min-w-[170px]"
          value={status}
          onChange={setStatus}
          options={[
            { value: "ALL", label: t("Todos los estados") },
            { value: "ONLINE", label: t("En línea") },
            { value: "OFFLINE", label: t("Fuera de línea") },
            { value: "UNKNOWN", label: t("Desconocido") },
          ]}
        />
        <Select
          className="min-w-[160px]"
          value={toner}
          onChange={setToner}
          options={[
            { value: "ALL", label: t("Todo el tóner") },
            { value: "LOW", label: t("Tóner bajo (≤20%)") },
          ]}
        />
        <Select
          className="min-w-[190px]"
          value={manufacturer}
          onChange={setManufacturer}
          options={[
            { value: "ALL", label: t("Todos los fabricantes") },
            ...manufacturers.map((m) => ({ value: m, label: m })),
          ]}
        />
        <Select
          className="min-w-[180px]"
          value={model}
          onChange={setModel}
          options={[
            { value: "ALL", label: t("Todos los modelos") },
            ...models.map((m) => ({ value: m, label: m })),
          ]}
        />
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted">
          <input
            type="checkbox"
            className="accent-accent"
            checked={grouped}
            onChange={(e) => setGrouped(e.target.checked)}
          />
          {t("Agrupar por ubicación")}
        </label>
        {onPollAll && (
          <button
            className="btn-ghost ml-auto"
            onClick={handlePollAll}
            disabled={pollingAll}
            title={t("Consulta por SNMP todas las impresoras y actualiza la tabla")}
          >
            {pollingAll ? t("Actualizando…") : t("🔄 Actualizar todo")}
          </button>
        )}
      </div>

      <div className="text-xs text-slate-500">
        {sorted.length} {t("de")} {printers.length} {t("dispositivos")}
      </div>

      {/* Tabla — ancho AUTOMÁTICO: cada columna se ajusta a su contenido (una
          línea = angosta; si el texto necesita más, la columna crece/envuelve).
          Sin `w-full`/`min-w` para no estirar columnas más allá de su contenido. */}
      <div className="card overflow-x-auto">
        <table className="w-auto table-auto border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={`px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted ${
                    c.key ? "cursor-pointer select-none hover:text-slate-200" : ""
                  } ${c.label === "Contador" ? "text-right" : ""} ${
                    c.label === "Tóner" ? "text-center" : ""
                  }`}
                  onClick={c.key ? () => toggleSort(c.key as SortKey) : undefined}
                >
                  {t(c.label)}
                  {c.key ? sortArrow(c.key) : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-muted">
                  {t("No hay dispositivos que coincidan con los filtros.")}
                </td>
              </tr>
            )}

            {!grouped && sorted.map(renderRow)}

            {grouped &&
              groups!.map(([loc, items]) => (
                <FragmentGroup key={loc} loc={loc} count={items.length}>
                  {items.map(renderRow)}
                </FragmentGroup>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Celda de tóner: muestra CADA cartucho por color (K/C/M/Y) con su barra y su
 * porcentaje. Los que están en nivel bajo (≤ umbral) se resaltan en rojo — así
 * en una impresora a color se ve exactamente qué tinta está baja (p. ej. la
 * amarilla) y, si hay más de una, todas ellas.
 */
function TonerCell({ p }: { p: ApiPrinter }) {
  const theme = useTheme();
  const { t: tr } = useI18n();
  const toners = orderedToners(p);
  if (toners.length === 0) return <span className="text-muted">—</span>;

  return (
    <div className="mx-auto w-40 space-y-1">
      {toners.map((t) => {
        const pct = t.percent == null ? null : Math.max(0, Math.min(100, t.percent));
        const tone = tonerTone(pct);
        const color = supplyBarColor(String(t.color), theme);
        const letter = COLOR_LETTER[String(t.color)] ?? "·";
        const label = COLOR_LABEL[String(t.color)] ?? t.name;
        const sev =
          tone.level === "critical"
            ? " " + tr("(crítico)")
            : tone.level === "low"
              ? " " + tr("(bajo)")
              : tone.level === "notice"
                ? " " + tr("(medio)")
                : "";
        return (
          <div
            key={t.id}
            className="flex items-center gap-1.5"
            title={`${label}: ${pct == null ? "—" : pct + "%"}${sev}`}
          >
            <span className="w-3.5 shrink-0 text-center text-[10px] font-bold" style={{ color }}>
              {letter}
            </span>
            <div className={`h-1.5 flex-1 overflow-hidden rounded-full bg-border ${tone.ring}`}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct ?? 0}%`, background: pct == null ? "transparent" : color }}
              />
            </div>
            <span
              className={`w-9 shrink-0 text-right text-[11px] tabular-nums ${
                tone.flag ? `font-semibold ${tone.text}` : "text-muted"
              }`}
            >
              {pct == null ? "—" : `${pct}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Cabecera de grupo por ubicación dentro de la tabla. */
function FragmentGroup({
  loc,
  count,
  children,
}: {
  loc: string;
  count: number;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <>
      <tr className="bg-elev">
        <td colSpan={9} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-accent">
          📍 {loc === "Sin ubicación" ? t("Sin ubicación") : loc}{" "}
          <span className="ml-1 font-normal text-slate-500">({count})</span>
        </td>
      </tr>
      {children}
    </>
  );
}
