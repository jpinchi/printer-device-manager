/**
 * Generación de un reporte PDF PROFESIONAL del historial de una impresora.
 *
 * Todo se dibuja vectorialmente con jsPDF (nítido a cualquier zoom), con el
 * mismo lenguaje visual de la app (tema oscuro, acentos sky/indigo, colores de
 * tóner K/C/M/Y). Incluye cabecera con identidad de la impresora, tarjetas KPI,
 * gráfica de nivel de tóner, gráfica del contador de páginas y una tabla de
 * puntos recientes. Se ejecuta en el cliente a partir de los datos ya cargados.
 */
import { jsPDF } from "jspdf";
import type { ApiPrinter, ApiHistoryPoint } from "./types";
import { fmtNumber, fmtUptime, TONER_LOW_THRESHOLD } from "./format";

type RGB = [number, number, number];

/** Paleta alineada con el tema de la app (tailwind.config / globals). */
const C = {
  bg: [11, 17, 32] as RGB,
  card: [20, 31, 54] as RGB,
  cardHi: [26, 38, 64] as RGB,
  border: [42, 56, 82] as RGB,
  text: [226, 232, 240] as RGB,
  muted: [147, 164, 195] as RGB,
  sub: [110, 126, 156] as RGB,
  accent: [56, 189, 248] as RGB,
  accent2: [129, 140, 248] as RGB,
  ok: [34, 197, 94] as RGB,
  warn: [245, 158, 11] as RGB,
  danger: [244, 63, 94] as RGB,
  K: [226, 232, 240] as RGB,
  Cn: [34, 211, 238] as RGB,
  M: [232, 121, 249] as RGB,
  Y: [250, 204, 21] as RGB,
};

/** Mezcla fg sobre bg con alfa (para simular translúcidos manteniendo nitidez). */
function blend(fg: RGB, bg: RGB, a: number): RGB {
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
  ];
}

const setFill = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
const setStroke = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);
const setText = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);

/** Fecha compacta para ejes/tabla. */
function fmtAxis(ms: number): string {
  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Series {
  label: string;
  color: RGB;
  data: Array<[number, number]>;
}

/** Deriva las series de tóner y de páginas desde los puntos de historial. */
function buildSeries(points: ApiHistoryPoint[]) {
  const ts = (p: ApiHistoryPoint) => Date.parse(p.timestamp ?? "") || 0;
  const ordered = points.filter((p) => p.timestamp).sort((a, b) => ts(a) - ts(b));
  const mk = (pick: (p: ApiHistoryPoint) => number | null | undefined): Array<[number, number]> =>
    ordered
      .map((p) => [ts(p), pick(p)] as [number, number | null | undefined])
      .filter((e): e is [number, number] => e[1] != null);

  const toner: Series[] = [
    { label: "Negro (K)", color: C.K, data: mk((p) => p.tonerBlack) },
    { label: "Cian (C)", color: C.Cn, data: mk((p) => p.tonerCyan) },
    { label: "Magenta (M)", color: C.M, data: mk((p) => p.tonerMagenta) },
    { label: "Amarillo (Y)", color: C.Y, data: mk((p) => p.tonerYellow) },
  ].filter((s) => s.data.length > 0);

  const pages: Series[] = [{ label: "Páginas totales", color: C.accent, data: mk((p) => p.totalPages) }].filter(
    (s) => s.data.length > 0,
  );

  return { ordered, toner, pages };
}

const PAGE = { w: 595.28, h: 841.89, margin: 40 };

/** Fondo de página + banda superior de acento (se pinta al crear cada página). */
function paintBackground(doc: jsPDF) {
  setFill(doc, C.bg);
  doc.rect(0, 0, PAGE.w, PAGE.h, "F");
  // Banda superior con un degradado simulado (franjas de accent → accent2).
  const bandH = 5;
  for (let i = 0; i < PAGE.w; i += 6) {
    const t = i / PAGE.w;
    setFill(doc, blend(C.accent2, C.accent, t));
    doc.rect(i, 0, 6, bandH, "F");
  }
}

/** Logo estilo app: cuadrado con acento y silueta de impresora. */
function drawLogo(doc: jsPDF, x: number, y: number, s: number) {
  doc.setLineWidth(0);
  setFill(doc, C.accent);
  doc.roundedRect(x, y, s, s, s * 0.28, s * 0.28, "F");
  // Silueta de impresora en tono oscuro.
  setFill(doc, C.bg);
  const u = s / 20;
  doc.rect(x + 6 * u, y + 5 * u, 8 * u, 3 * u, "F"); // papel superior
  doc.roundedRect(x + 4 * u, y + 8 * u, 12 * u, 6 * u, u, u, "F"); // cuerpo
  doc.rect(x + 6 * u, y + 13 * u, 8 * u, 4 * u, "F"); // salida
}

/** Tarjeta KPI: etiqueta + valor grande coloreado. */
function drawKpi(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  valueColor: RGB,
) {
  setFill(doc, C.card);
  setStroke(doc, C.border);
  doc.setLineWidth(0.7);
  doc.roundedRect(x, y, w, h, 7, 7, "FD");
  setText(doc, C.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(label.toUpperCase(), x + 12, y + 16, { charSpace: 0.6 });
  setText(doc, valueColor);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(value, x + 12, y + h - 12);
}

interface ChartOpts {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  subtitle?: string;
  series: Series[];
  yMin: number;
  yMax: number;
  yFmt: (v: number) => string;
  lowThreshold?: number;
  legendValue?: (s: Series) => string;
}

/** Panel de gráfica de líneas (tarjeta + rejilla + series + leyenda). */
function drawLineChart(doc: jsPDF, o: ChartOpts) {
  // Tarjeta contenedora.
  setFill(doc, C.card);
  setStroke(doc, C.border);
  doc.setLineWidth(0.7);
  doc.roundedRect(o.x, o.y, o.w, o.h, 8, 8, "FD");

  // Título.
  setText(doc, C.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(o.title, o.x + 14, o.y + 20);
  if (o.subtitle) {
    setText(doc, C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(o.subtitle, o.x + 14, o.y + 33);
  }

  // Área de trazado.
  const padL = 44;
  const padR = 16;
  const padT = 44;
  const padB = 46; // deja sitio para leyenda + fechas
  const plot = {
    x: o.x + padL,
    y: o.y + padT,
    w: o.w - padL - padR,
    h: o.h - padT - padB,
  };

  const active = o.series.filter((s) => s.data.length >= 2);
  if (active.length === 0) {
    setText(doc, C.sub);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Datos insuficientes para graficar (se necesitan ≥2 lecturas).", o.x + o.w / 2, o.y + o.h / 2, {
      align: "center",
    });
    return;
  }

  const allT = active.flatMap((s) => s.data.map(([t]) => t));
  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const tSpan = tMax - tMin || 1;
  const vSpan = o.yMax - o.yMin || 1;
  const X = (t: number) => plot.x + ((t - tMin) / tSpan) * plot.w;
  const Yv = (v: number) => plot.y + (1 - (v - o.yMin) / vSpan) * plot.h;

  // Banda "zona baja" (tóner ≤ umbral).
  if (o.lowThreshold != null) {
    setFill(doc, blend(C.danger, C.card, 0.14));
    const yb = Yv(o.lowThreshold);
    doc.rect(plot.x, yb, plot.w, Yv(o.yMin) - yb, "F");
  }

  // Rejilla + etiquetas Y (5 divisiones).
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  for (let i = 0; i < 5; i++) {
    const v = o.yMin + (vSpan * i) / 4;
    const yy = Yv(v);
    setStroke(doc, blend(C.border, C.card, 0.8));
    doc.setLineWidth(0.5);
    doc.line(plot.x, yy, plot.x + plot.w, yy);
    setText(doc, C.sub);
    doc.text(o.yFmt(v), plot.x - 6, yy + 2.5, { align: "right" });
  }

  // Etiquetas X (inicio / medio / fin).
  for (let i = 0; i < 3; i++) {
    const t = tMin + (tSpan * i) / 2;
    const align = i === 0 ? "left" : i === 2 ? "right" : "center";
    setText(doc, C.sub);
    doc.text(fmtAxis(t), X(t), plot.y + plot.h + 14, { align: align as "left" | "right" | "center" });
  }

  // Series.
  for (const s of active) {
    setStroke(doc, s.color);
    doc.setLineWidth(1.6);
    for (let i = 1; i < s.data.length; i++) {
      doc.line(X(s.data[i - 1][0]), Yv(s.data[i - 1][1]), X(s.data[i][0]), Yv(s.data[i][1]));
    }
    // Punto del último valor.
    const last = s.data[s.data.length - 1];
    setFill(doc, s.color);
    doc.circle(X(last[0]), Yv(last[1]), 2.4, "F");
  }

  // Leyenda (con valor actual opcional).
  let lx = plot.x;
  const ly = o.y + o.h - 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (const s of active) {
    setFill(doc, s.color);
    doc.roundedRect(lx, ly - 6, 8, 8, 1.5, 1.5, "F");
    setText(doc, C.muted);
    const val = o.legendValue ? o.legendValue(s) : "";
    const txt = val ? `${s.label}  ${val}` : s.label;
    doc.text(txt, lx + 12, ly);
    lx += doc.getTextWidth(txt) + 30;
  }
}

/** Pie de página en todas las páginas (se llama al final, sobre el fondo ya pintado). */
function drawFooters(doc: jsPDF, printer: ApiPrinter, generatedAt: string) {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    setStroke(doc, C.border);
    doc.setLineWidth(0.5);
    doc.line(PAGE.margin, PAGE.h - 30, PAGE.w - PAGE.margin, PAGE.h - 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setText(doc, C.sub);
    doc.text("Printer Device Manager", PAGE.margin, PAGE.h - 18);
    doc.text(`${printer.name} · ${printer.ipAddress}`, PAGE.w / 2, PAGE.h - 18, { align: "center" });
    doc.text(`Página ${p} de ${total}  ·  ${generatedAt}`, PAGE.w - PAGE.margin, PAGE.h - 18, {
      align: "right",
    });
  }
}

/** Uptime "en vivo" a partir del último valor persistido. */
function liveUptime(printer: ApiPrinter): number | null {
  if (printer.uptimeSeconds == null || !printer.uptimeReadAt) return null;
  return printer.uptimeSeconds + Math.max(0, Math.floor((Date.now() - Date.parse(printer.uptimeReadAt)) / 1000));
}

function sanitize(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "impresora";
}

/**
 * Construye y descarga el PDF del historial de una impresora.
 */
export function generateHistoryReport(printer: ApiPrinter, points: ApiHistoryPoint[]): void {
  const { doc, filename } = buildHistoryReport(printer, points);
  doc.save(filename);
}

/**
 * Construye el documento PDF (sin descargarlo). Separado de la descarga para
 * poder generarlo también fuera del navegador (p. ej. verificación en Node).
 */
export function buildHistoryReport(
  printer: ApiPrinter,
  points: ApiHistoryPoint[],
): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const { ordered, toner, pages } = buildSeries(points);
  const generatedAt = new Date().toLocaleString("es-ES");
  const M = PAGE.margin;
  const contentW = PAGE.w - 2 * M;

  paintBackground(doc);

  // --- Cabecera -----------------------------------------------------------
  drawLogo(doc, M, M, 34);
  setText(doc, C.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("REPORTE DE HISTORIAL", M + 46, M + 12, { charSpace: 1.2 });
  setText(doc, C.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(printer.name, M + 46, M + 30);
  // Sub-línea: modelo · fabricante · ubicación.
  const subParts = [printer.model, printer.manufacturer, printer.location?.name].filter(Boolean) as string[];
  setText(doc, C.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (subParts.length) doc.text(subParts.join("  ·  "), M + 46, M + 44);
  // Derecha: IP + generado.
  setText(doc, C.accent);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(printer.ipAddress, PAGE.w - M, M + 12, { align: "right" });
  setText(doc, C.sub);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Generado: ${generatedAt}`, PAGE.w - M, M + 26, { align: "right" });

  let y = M + 62;

  // --- KPIs ---------------------------------------------------------------
  const last = ordered[ordered.length - 1];
  const tonerVals = [
    { c: C.K, v: last?.tonerBlack },
    { c: C.Cn, v: last?.tonerCyan },
    { c: C.M, v: last?.tonerMagenta },
    { c: C.Y, v: last?.tonerYellow },
  ].filter((t) => t.v != null) as { c: RGB; v: number }[];
  const minToner = tonerVals.length ? tonerVals.reduce((a, b) => (b.v < a.v ? b : a)) : null;

  const isOnline = String(printer.status).toUpperCase() === "ONLINE";
  const up = liveUptime(printer);
  const gap = 12;
  const kpiW = (contentW - gap * 3) / 4;
  const kpiH = 52;
  drawKpi(doc, M, y, kpiW, kpiH, "Estado", isOnline ? "En línea" : String(printer.status), isOnline ? C.ok : C.danger);
  drawKpi(doc, M + (kpiW + gap), y, kpiW, kpiH, "Páginas totales", last?.totalPages != null ? fmtNumber(last.totalPages) : "—", C.accent);
  drawKpi(doc, M + (kpiW + gap) * 2, y, kpiW, kpiH, "Uptime", up != null ? fmtUptime(up) : "—", C.text);
  drawKpi(
    doc,
    M + (kpiW + gap) * 3,
    y,
    kpiW,
    kpiH,
    "Tóner más bajo",
    minToner ? `${Math.round(minToner.v)}%` : "—",
    minToner && minToner.v <= TONER_LOW_THRESHOLD ? C.danger : C.text,
  );
  y += kpiH + 16;

  // --- Gráfica de tóner ---------------------------------------------------
  const chartH = 200;
  drawLineChart(doc, {
    x: M,
    y,
    w: contentW,
    h: chartH,
    title: "Nivel de tóner",
    subtitle: "Porcentaje restante por cartucho (0–100 %). La franja roja marca el nivel bajo.",
    series: toner,
    yMin: 0,
    yMax: 100,
    yFmt: (v) => `${Math.round(v)}%`,
    lowThreshold: TONER_LOW_THRESHOLD,
    legendValue: (s) => `${Math.round(s.data[s.data.length - 1][1])}%`,
  });
  y += chartH + 16;

  // --- Gráfica de contador ------------------------------------------------
  const pageVals = pages[0]?.data.map(([, v]) => v) ?? [];
  const pMin = pageVals.length ? Math.min(...pageVals) : 0;
  const pMax = pageVals.length ? Math.max(...pageVals) : 1;
  const pPad = Math.max(1, Math.round((pMax - pMin) * 0.08));
  let pageSub = "Acumulado histórico (solo crece).";
  if (pages[0] && pages[0].data.length >= 2) {
    const d = pages[0].data;
    const delta = d[d.length - 1][1] - d[0][1];
    const days = Math.max((d[d.length - 1][0] - d[0][0]) / 86_400_000, 1 / 24);
    pageSub = `Crecimiento en el periodo: +${fmtNumber(delta)} pág.  ·  ~${fmtNumber(delta / days)} pág./día`;
  }
  drawLineChart(doc, {
    x: M,
    y,
    w: contentW,
    h: chartH,
    title: "Contador total de páginas",
    subtitle: pageSub,
    series: pages,
    yMin: Math.max(0, pMin - pPad),
    yMax: pMax + pPad,
    yFmt: (v) => fmtNumber(v),
  });
  y += chartH + 20;

  // --- Tabla de puntos recientes -----------------------------------------
  drawTable(doc, M, y, contentW, ordered);

  // --- Pies ---------------------------------------------------------------
  drawFooters(doc, printer, generatedAt);
  const filename = `historial-${sanitize(printer.name || printer.ipAddress)}-${new Date().toISOString().slice(0, 10)}.pdf`;
  return { doc, filename };
}

/** Tabla "Puntos recientes" dibujada a mano, con paginación y tema oscuro. */
function drawTable(doc: jsPDF, x: number, startY: number, w: number, ordered: ApiHistoryPoint[]) {
  const rows = ordered.slice().reverse().slice(0, 60); // los 60 más recientes
  const cols = [
    { key: "fecha", label: "Fecha", w: 0.28, align: "left" as const },
    { key: "estado", label: "Estado", w: 0.16, align: "left" as const },
    { key: "k", label: "K", w: 0.09, align: "right" as const },
    { key: "c", label: "C", w: 0.09, align: "right" as const },
    { key: "m", label: "M", w: 0.09, align: "right" as const },
    { key: "y", label: "Y", w: 0.09, align: "right" as const },
    { key: "pag", label: "Páginas", w: 0.2, align: "right" as const },
  ];
  const rowH = 16;
  const headH = 20;
  const bottom = PAGE.h - 44;

  const drawHeader = (yy: number) => {
    // Título de sección.
    setText(doc, C.text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Puntos recientes", x + 2, yy - 8);
    // Cabecera de tabla.
    setFill(doc, C.cardHi);
    doc.roundedRect(x, yy, w, headH, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setText(doc, C.muted);
    let cx = x;
    for (const col of cols) {
      const cw = col.w * w;
      const tx = col.align === "right" ? cx + cw - 8 : cx + 8;
      doc.text(col.label, tx, yy + 13, { align: col.align });
      cx += cw;
    }
    return yy + headH;
  };

  let y = drawHeader(startY + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  const cell = (p: ApiHistoryPoint, key: string): string => {
    switch (key) {
      case "fecha":
        return p.timestamp ? fmtAxis(Date.parse(p.timestamp)) : "—";
      case "estado":
        return p.status ?? "—";
      case "k":
        return p.tonerBlack != null ? String(p.tonerBlack) : "—";
      case "c":
        return p.tonerCyan != null ? String(p.tonerCyan) : "—";
      case "m":
        return p.tonerMagenta != null ? String(p.tonerMagenta) : "—";
      case "y":
        return p.tonerYellow != null ? String(p.tonerYellow) : "—";
      case "pag":
        return p.totalPages != null ? fmtNumber(p.totalPages) : "—";
      default:
        return "—";
    }
  };

  rows.forEach((p, i) => {
    if (y + rowH > bottom) {
      doc.addPage();
      paintBackground(doc);
      y = drawHeader(PAGE.margin + 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
    }
    if (i % 2 === 1) {
      setFill(doc, blend(C.card, C.bg, 0.5));
      doc.rect(x, y, w, rowH, "F");
    }
    let cx = x;
    for (const col of cols) {
      const cw = col.w * w;
      const tx = col.align === "right" ? cx + cw - 8 : cx + 8;
      const low = ["k", "c", "m", "y"].includes(col.key);
      const raw = cell(p, col.key);
      const isLow = low && raw !== "—" && Number(raw) <= TONER_LOW_THRESHOLD;
      setText(doc, isLow ? C.danger : col.key === "fecha" ? C.muted : C.text);
      doc.text(raw, tx, y + 11, { align: col.align });
      cx += cw;
    }
    y += rowH;
  });
}
