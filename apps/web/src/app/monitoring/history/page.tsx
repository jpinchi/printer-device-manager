"use client";

/**
 * Historial por impresora (Fase 6): evolución en el tiempo.
 *
 * Objetivo: entender de un vistazo la TENDENCIA de una impresora — si el tóner
 * está bajando y a qué ritmo, y cómo crece el contador total de páginas.
 *
 * Los gráficos son SVG inline INTERACTIVOS: al pasar el cursor aparece una guía
 * vertical y un tooltip con la fecha y el valor exacto de cada serie en ese
 * instante. Cada lectura real se marca con un punto (lo demás es interpolación).
 * El gráfico de tóner sombrea la zona de "nivel bajo" (≤20 %) para que se lea
 * como un depósito que se vacía, no como una línea abstracta.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { Select } from "@/components/Select";
import { IpLink } from "@/components/IpLink";
import { CsvDownloadButton } from "@/components/CsvDownloadButton";
import { PdfDownloadButton } from "@/components/PdfDownloadButton";
import { Spinner, ErrorState, EmptyState, PendingState } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { useTheme } from "@/hooks/useTheme";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiPrinter, ApiHistoryPoint } from "@/lib/types";
import { fmtDate, fmtNumber, supplyBarColor, TONER_LOW_THRESHOLD } from "@/lib/format";

/** Una serie temporal a graficar. */
interface Series {
  key: string;
  label: string;
  color: string;
  /** Puntos [timestampMs, valor]; los null se omiten. */
  data: Array<[number, number]>;
}

/** Fecha compacta para el eje X (dd/MM HH:mm). */
function fmtAxis(ms: number): string {
  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Gráfico de líneas (SVG inline) INTERACTIVO: eje Y etiquetado, rejilla,
 * marcadores en cada lectura, guía vertical + tooltip al pasar el cursor y,
 * opcionalmente, una banda de umbral (p. ej. tóner bajo) y relleno de área.
 */
function TrendChart({
  series,
  yMin,
  yMax,
  yFormat,
  height = 220,
  lowThreshold,
  fillArea = false,
}: {
  series: Series[];
  yMin: number;
  yMax: number;
  yFormat: (v: number) => string;
  height?: number;
  /** Si se indica, sombrea la franja [yMin, lowThreshold] como "zona baja". */
  lowThreshold?: number;
  /** Rellena el área bajo la línea (recomendado solo con 1 serie activa). */
  fillArea?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const uid = useId().replace(/:/g, ""); // ids válidos para SVG (sin ':')

  const w = 760;
  const h = height;
  const padL = 52; // etiquetas del eje Y
  const padR = 16;
  const padT = 16;
  const padB = 30; // etiquetas del eje X

  const active = series.filter((s) => s.data.length >= 1);
  const allT = active.flatMap((s) => s.data.map(([t]) => t));
  const hasData = active.some((s) => s.data.length >= 2);

  const tMin = allT.length ? Math.min(...allT) : 0;
  const tMax = allT.length ? Math.max(...allT) : 1;
  const tSpan = tMax - tMin || 1;
  const vSpan = yMax - yMin || 1;

  const x = (t: number) => padL + ((t - tMin) / tSpan) * (w - padL - padR);
  const y = (v: number) => padT + (1 - (v - yMin) / vSpan) * (h - padT - padB);

  // Instantes únicos (todas las series comparten los timestamps de cada poll).
  const times = useMemo(
    () => [...new Set(allT)].sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allT.join(",")],
  );

  if (!hasData) {
    return (
      <div className="flex h-[180px] items-center justify-center text-center text-xs text-muted">
        Datos insuficientes para graficar (se necesitan ≥2 lecturas).
      </div>
    );
  }

  // Convierte la posición del cursor al timestamp de la lectura más cercana.
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * w;
    let best = times[0];
    let bestDx = Infinity;
    for (const t of times) {
      const dx = Math.abs(x(t) - vx);
      if (dx < bestDx) {
        bestDx = dx;
        best = t;
      }
    }
    setHoverT(best);
  };

  const ticksY = Array.from({ length: 5 }, (_, i) => yMin + (vSpan * i) / 4);
  const ticksX = Array.from({ length: 4 }, (_, i) => tMin + (tSpan * i) / 3);

  // Valor de una serie en el instante t, INTERPOLADO sobre la línea dibujada
  // (así el tooltip coincide con el punto donde la guía cruza la línea). Devuelve
  // null si t cae fuera del rango medido de esa serie (no inventamos datos).
  const valueAt = (data: Array<[number, number]>, t: number): number | null => {
    const n = data.length;
    if (n === 0 || t < data[0][0] || t > data[n - 1][0]) return null;
    for (let i = 0; i < n - 1; i++) {
      const [t0, v0] = data[i];
      const [t1, v1] = data[i + 1];
      if (t >= t0 && t <= t1) return t1 === t0 ? v1 : v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
    }
    return data[n - 1][1];
  };

  const hoverX = hoverT != null ? x(hoverT) : null;
  const tooltipRows =
    hoverT != null
      ? active
          .map((s) => ({ s, v: valueAt(s.data, hoverT) }))
          .filter((r): r is { s: Series; v: number } => r.v != null)
      : [];

  // Firma de los datos: al cambiar (otra impresora / nuevos puntos) fuerza el
  // remontaje de la línea + tracer para que la animación de trazado se reinicie.
  // Al mover el cursor NO cambia, así que la animación no se repite en cada hover.
  const sig = `${times.length}-${tMin}-${tMax}`;
  const drawDur = "1.6s";

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        role="img"
        aria-label="Gráfico de tendencia"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverT(null)}
      >
        <defs>
          {active.map((s) => (
            <linearGradient key={s.key} id={`${uid}-area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {/* Banda de "zona baja" (p. ej. tóner ≤ 20 %) */}
        {lowThreshold != null && (
          <g>
            <rect
              x={padL}
              y={y(lowThreshold)}
              width={w - padL - padR}
              height={y(yMin) - y(lowThreshold)}
              className="fill-danger"
              opacity={0.07}
            />
            <line
              x1={padL}
              y1={y(lowThreshold)}
              x2={w - padR}
              y2={y(lowThreshold)}
              className="stroke-danger"
              strokeWidth={1}
              strokeDasharray="4 4"
              opacity={0.5}
            />
            <text x={w - padR} y={y(lowThreshold) - 4} textAnchor="end" className="fill-danger" fontSize={9} opacity={0.8}>
              nivel bajo
            </text>
          </g>
        )}

        {/* Rejilla + etiquetas Y */}
        {ticksY.map((tk, i) => {
          const yy = y(tk);
          return (
            <g key={i}>
              <line x1={padL} y1={yy} x2={w - padR} y2={yy} className="stroke-border" strokeWidth={1} opacity={0.3} />
              <text x={padL - 8} y={yy + 3} textAnchor="end" className="fill-slate-500" fontSize={10}>
                {yFormat(tk)}
              </text>
            </g>
          );
        })}

        {/* Etiquetas X */}
        {ticksX.map((tk, i) => {
          const anchor = i === 0 ? "start" : i === ticksX.length - 1 ? "end" : "middle";
          return (
            <text key={i} x={x(tk)} y={h - 9} textAnchor={anchor} className="fill-slate-500" fontSize={9.5}>
              {fmtAxis(tk)}
            </text>
          );
        })}

        {/* Series: área opcional + línea + marcadores por lectura.
            Con muchos puntos NO se dibujan marcadores (saturarían la línea);
            el punto final y la guía del cursor bastan para leer valores. */}
        {active.map((s) => {
          if (s.data.length < 2) return null;
          const line = s.data.map(([t, v], i) => `${i === 0 ? "M" : "L"} ${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
          const areaPath =
            `M ${x(s.data[0][0]).toFixed(1)} ${y(yMin).toFixed(1)} ` +
            s.data.map(([t, v]) => `L ${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ") +
            ` L ${x(s.data[s.data.length - 1][0]).toFixed(1)} ${y(yMin).toFixed(1)} Z`;
          const showMarkers = s.data.length <= 48;
          const lineId = `${uid}-line-${s.key}`;
          const ease = "0.33 0 0.15 1"; // curva de easing (SMIL keySplines)
          // key con `sig`: se remonta al cambiar de impresora/datos y reinicia
          // la animación; con el hover (sig igual) se conserva y NO se repite.
          return (
            <g key={`${s.key}-${sig}`}>
              {fillArea && (
                <path d={areaPath} fill={`url(#${uid}-area-${s.key})`} stroke="none" opacity={0}>
                  <animate attributeName="opacity" from={0} to={1} dur={drawDur} begin="0s" fill="freeze" />
                </path>
              )}

              {/* Línea que se DIBUJA de izquierda a derecha (stroke-dashoffset) */}
              <path
                id={lineId}
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1}
              >
                <animate
                  attributeName="stroke-dashoffset"
                  from={1}
                  to={0}
                  dur={drawDur}
                  begin="0s"
                  fill="freeze"
                  calcMode="spline"
                  keyTimes="0;1"
                  keySplines={ease}
                />
              </path>

              {showMarkers &&
                s.data.map(([t, v], i) => <circle key={i} cx={x(t)} cy={y(v)} r={2} fill={s.color} opacity={0.9} />)}

              {/* Tracer: recorre la línea siguiendo su forma real (sube cuando la
                  línea sube) y se queda fijo en el último valor al terminar. */}
              <circle r={4.5} fill={s.color} stroke="#0f172a" strokeWidth={1.5}>
                <animateMotion
                  dur={drawDur}
                  begin="0s"
                  fill="freeze"
                  calcMode="spline"
                  keyPoints="0;1"
                  keyTimes="0;1"
                  keySplines={ease}
                >
                  <mpath href={`#${lineId}`} />
                </animateMotion>
              </circle>
            </g>
          );
        })}

        {/* Guía vertical + puntos resaltados en la posición del cursor */}
        {hoverX != null && (
          <g>
            <line x1={hoverX} y1={padT} x2={hoverX} y2={h - padB} className="stroke-slate-400" strokeWidth={1} opacity={0.5} />
            {tooltipRows.map(({ s, v }) => (
              <circle key={s.key} cx={hoverX} cy={y(v)} r={4} fill={s.color} stroke="var(--color-card, #0f172a)" strokeWidth={1.5} />
            ))}
          </g>
        )}
      </svg>

      {/* Tooltip (HTML sobre el SVG) */}
      {hoverT != null && hoverX != null && tooltipRows.length > 0 && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[9rem] -translate-x-1/2 rounded-lg border border-border bg-card/95 px-2.5 py-2 shadow-soft backdrop-blur"
          style={{ left: `${(hoverX / w) * 100}%` }}
        >
          <div className="mb-1 text-[10px] font-medium text-slate-400">{fmtDate(new Date(hoverT).toISOString())}</div>
          <ul className="space-y-0.5">
            {tooltipRows.map(({ s, v }) => (
              <li key={s.key} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-slate-300">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
                <span className="font-mono tabular-nums text-slate-100">{yFormat(v)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Tarjeta compacta con el nivel ACTUAL de un tóner (último valor conocido). */
function LevelBadge({ label, color, value }: { label: string; color: string; value: number | null }) {
  const low = value != null && value <= TONER_LOW_THRESHOLD;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-sunken px-3 py-2">
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
        <div className={`font-mono text-sm tabular-nums ${low ? "text-danger" : "text-slate-100"}`}>
          {value != null ? `${Math.round(value)}%` : "—"}
        </div>
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const { t } = useI18n();
  const printers = useAsync<ApiPrinter[]>(() => api.listPrinters(), []);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    if (!selected && printers.data && printers.data.length) setSelected(printers.data[0].id);
  }, [printers.data, selected]);

  const history = useAsync(
    () => (selected ? api.getHistory(selected) : Promise.resolve({ data: [], pending: false, error: null })),
    [selected],
  );
  const soft = history.data;
  const points: ApiHistoryPoint[] = soft?.data ?? [];
  const theme = useTheme();

  const current = (printers.data ?? []).find((p) => p.id === selected);

  // Opciones del selector con estilo del tema.
  const options = (printers.data ?? []).map((p) => ({
    value: p.id,
    label: `${p.name} · ${p.model ?? "—"} · ${p.location?.name ?? t("Sin ubicación")}`,
  }));

  // Convierte los puntos (con timestamp) en series de tóner y de páginas.
  const { tonerSeries, pageSeries, hasToner, hasPages } = useMemo(() => {
    const ts = (v: ApiHistoryPoint) => Date.parse(v.timestamp ?? "") || 0;
    const ordered = points.filter((p) => p.timestamp).sort((a, b) => ts(a) - ts(b));

    const mk = (pick: (p: ApiHistoryPoint) => number | null | undefined): Array<[number, number]> =>
      ordered
        .map((p) => [ts(p), pick(p)] as [number, number | null | undefined])
        .filter((e): e is [number, number] => e[1] != null);

    const tonerSeries: Series[] = [
      { key: "K", label: "Negro (K)", color: supplyBarColor("BLACK", theme), data: mk((p) => p.tonerBlack) },
      { key: "C", label: "Cian (C)", color: supplyBarColor("CYAN", theme), data: mk((p) => p.tonerCyan) },
      { key: "M", label: "Magenta (M)", color: supplyBarColor("MAGENTA", theme), data: mk((p) => p.tonerMagenta) },
      { key: "Y", label: "Amarillo (Y)", color: supplyBarColor("YELLOW", theme), data: mk((p) => p.tonerYellow) },
    ];
    const pageSeries: Series[] = [
      { key: "TOTAL", label: "Páginas totales", color: supplyBarColor("OTHER", theme), data: mk((p) => p.totalPages) },
    ];

    const hasToner = tonerSeries.some((s) => s.data.length >= 2);
    const hasPages = pageSeries[0].data.length >= 2;
    return { tonerSeries, pageSeries, hasToner, hasPages };
  }, [points, theme]);

  // Series de tóner que realmente tienen datos (evita líneas/leyendas vacías).
  const tonerActive = tonerSeries.filter((s) => s.data.length >= 1);
  const singleToner = tonerActive.filter((s) => s.data.length >= 2).length === 1;

  // Último valor conocido por tóner, para las tarjetas de "nivel actual".
  const lastOf = (s: Series): number | null => (s.data.length ? s.data[s.data.length - 1][1] : null);

  // Rango del eje Y para páginas (con un pequeño margen).
  const pageBounds = useMemo(() => {
    const vals = pageSeries[0].data.map(([, v]) => v);
    if (vals.length === 0) return { min: 0, max: 1 };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max(1, Math.round((max - min) * 0.08));
    return { min: Math.max(0, min - pad), max: max + pad };
  }, [pageSeries]);

  // Resumen del contador: cuánto ha crecido en el periodo y a qué ritmo diario.
  const pageStats = useMemo(() => {
    const d = pageSeries[0].data;
    if (d.length < 2) return null;
    const [t0, v0] = d[0];
    const [t1, v1] = d[d.length - 1];
    const delta = v1 - v0;
    const days = Math.max((t1 - t0) / 86_400_000, 1 / 24); // mínimo 1h para no dividir por ~0
    return { delta, perDay: delta / days };
  }, [pageSeries]);

  return (
    <>
      <Topbar title="Historial" help="Registro de eventos y cambios de estado en el tiempo, para auditar qué pasó y cuándo." />
      <main className="flex-1 space-y-4 p-6">
        {/* Explicación del propósito */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-100">{t("Evolución histórica de la impresora")}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            {t("Cada línea es una serie medida en cada ciclo de sondeo. Pasa el cursor por un gráfico para ver la fecha y el valor exacto de ese punto. Arriba, el nivel de tóner (K/C/M/Y) baja según se consume (la franja roja marca el nivel bajo); abajo, el contador total de páginas solo puede subir, y su pendiente indica el volumen de impresión.")}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Select
              value={selected}
              onChange={setSelected}
              options={options}
              placeholder={t("Selecciona impresora…")}
              className="w-72"
            />
            {selected && <CsvDownloadButton printerId={selected} type="status" />}
            {selected && current && <PdfDownloadButton printer={current} points={points} />}
          </div>

          {/* Contexto de la impresora seleccionada */}
          {current && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <IpLink ip={current.ipAddress} className="text-slate-400" />
              {current.model && <span>· {current.model}</span>}
              {current.manufacturer && <span className="text-slate-500">{current.manufacturer}</span>}
              <span className="inline-flex items-center gap-1">
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 10.5a2 2 0 100-4 2 2 0 000 4z" />
                  <path d="M10 18s6-4.686 6-9a6 6 0 10-12 0c0 4.314 6 9 6 9z" />
                </svg>
                {current.location?.name ?? t("Sin ubicación")}
              </span>
            </div>
          )}
        </div>

        {(printers.loading || history.loading) && <Spinner />}
        {history.error && <ErrorState message={history.error} />}
        {soft?.pending && <PendingState feature="Historial" agent="History (Fase 6)" />}

        {selected && soft && !soft.pending && (
          <>
            {points.length === 0 ? (
              <EmptyState title={t("Sin puntos de historial.")} hint={t("Se genera con cada poll/ciclo de polling.")} />
            ) : (
              <>
                {/* Gráfico de tóner (0–100 %) */}
                <div className="card p-5">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{t("Nivel de tóner")}</div>
                      <div className="text-[11px] text-muted">{t("Porcentaje restante en cada cartucho (0–100 %)")}</div>
                    </div>
                    {hasToner && <div className="text-[11px] text-slate-500">{t("↓ la línea baja = se está agotando")}</div>}
                  </div>

                  {/* Niveles ACTUALES por color (último valor conocido) */}
                  {tonerActive.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {tonerActive.map((s) => (
                        <LevelBadge key={s.key} label={t(s.label)} color={s.color} value={lastOf(s)} />
                      ))}
                    </div>
                  )}

                  <div className="mt-3">
                    <TrendChart
                      series={tonerSeries}
                      yMin={0}
                      yMax={100}
                      yFormat={(v) => `${Math.round(v)}%`}
                      lowThreshold={TONER_LOW_THRESHOLD}
                      fillArea={singleToner}
                    />
                  </div>
                </div>

                {/* Gráfico de contador total */}
                <div className="card p-5">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{t("Contador total de páginas")}</div>
                      <div className="text-[11px] text-muted">{t("Acumulado histórico (solo puede crecer)")}</div>
                    </div>
                    {hasPages && <div className="text-[11px] text-slate-500">{t("↑ pendiente = volumen de impresión")}</div>}
                  </div>

                  {/* Resumen: crecimiento en el periodo y ritmo diario */}
                  {pageStats && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <div className="rounded-lg border border-border bg-sunken px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted">{t("Crecimiento en el periodo")}</div>
                        <div className="font-mono text-sm tabular-nums text-slate-100">+{fmtNumber(pageStats.delta)} {t("pág.")}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-sunken px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted">{t("Ritmo estimado")}</div>
                        <div className="font-mono text-sm tabular-nums text-slate-100">~{fmtNumber(pageStats.perDay)} {t("pág./día")}</div>
                      </div>
                    </div>
                  )}

                  <div className="mt-3">
                    <TrendChart
                      series={pageSeries}
                      yMin={pageBounds.min}
                      yMax={pageBounds.max}
                      yFormat={(v) => fmtNumber(v)}
                      fillArea
                    />
                  </div>
                </div>

                {/* Tabla de puntos recientes */}
                <div className="card overflow-x-auto">
                  <div className="border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted">
                    {t("Puntos recientes (últimos 12)")}
                  </div>
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                        <th className="px-4 py-3 text-left">{t("Fecha")}</th>
                        <th className="px-4 py-3 text-left">{t("Estado")}</th>
                        <th className="px-4 py-3 text-right">K</th>
                        <th className="px-4 py-3 text-right">C</th>
                        <th className="px-4 py-3 text-right">M</th>
                        <th className="px-4 py-3 text-right">Y</th>
                        <th className="px-4 py-3 text-right">{t("Páginas")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {points.slice().reverse().slice(0, 12).map((p, i) => (
                        <tr key={i} className="border-b border-border/60 last:border-0 hover-elev">
                          <td className="px-4 py-2 text-xs text-muted">{fmtDate(p.timestamp)}</td>
                          <td className="px-4 py-2">{p.status ?? "—"}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{p.tonerBlack ?? "—"}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{p.tonerCyan ?? "—"}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{p.tonerMagenta ?? "—"}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{p.tonerYellow ?? "—"}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtNumber(p.totalPages)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
