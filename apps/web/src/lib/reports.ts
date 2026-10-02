/**
 * Generación de reportes EN EL CLIENTE (PDF, Excel, CSV). Se genera en el
 * navegador para que funcione igual en la web del central y en el Desktop, sin
 * depender de que haya Edge/Chromium instalado. Las librerías pesadas (xlsx,
 * jspdf) se cargan de forma perezosa (import dinámico) solo al descargar.
 *
 * Extensible: cada reporte es un `ReportSpec` (título + columnas + filas). Para
 * añadir uno nuevo, crea otro builder y regístralo en la página de Reportes.
 */
import type { ApiPrinter } from "./types";
import { totalCounter } from "./format";

export type Cell = string | number | null;

export interface ReportColumn {
  header: string;
  /** Ancho sugerido en caracteres (Excel) / peso relativo (PDF). */
  width?: number;
  numeric?: boolean;
}

export interface ReportSpec {
  /** Título mostrado en el documento (localizado). */
  title: string;
  /** Base del nombre de archivo (sin extensión). */
  fileBase: string;
  columns: ReportColumn[];
  rows: Cell[][];
}

// --- Extracción de datos ----------------------------------------------------

function tonerPct(p: ApiPrinter, color: string): number | null {
  const s = (p.supplies ?? []).find(
    (x) => (x.type === "TONER" || x.type === "INK") && String(x.color) === color,
  );
  return s?.percent ?? null;
}

function statusLabel(status: string, t: (s: string) => string): string {
  const s = (status || "UNKNOWN").toUpperCase();
  return s === "ONLINE" ? t("En línea") : s === "OFFLINE" ? t("Fuera de línea") : t("Desconocido");
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/**
 * Reporte "Inventario de impresoras": lo que aparece en la tabla de impresoras,
 * con la última data guardada (estado, ubicación, unidad de trabajo, tóner por
 * color, contador). Una fila por impresora.
 */
export function buildInventoryReport(printers: ApiPrinter[], t: (s: string) => string): ReportSpec {
  const columns: ReportColumn[] = [
    { header: t("Estado"), width: 12 },
    { header: t("Número de serie"), width: 18 },
    { header: t("IP"), width: 15 },
    { header: t("Fabricante"), width: 14 },
    { header: t("Modelo"), width: 16 },
    { header: t("Ubicación"), width: 22 },
    { header: t("Unidad de trabajo"), width: 22 },
    { header: t("Negro") + " (%)", width: 9, numeric: true },
    { header: t("Cian") + " (%)", width: 9, numeric: true },
    { header: t("Magenta") + " (%)", width: 9, numeric: true },
    { header: t("Amarillo") + " (%)", width: 9, numeric: true },
    { header: t("Contador") + " (" + t("páginas") + ")", width: 14, numeric: true },
    { header: t("Última lectura"), width: 20 },
  ];
  const rows: Cell[][] = printers.map((p) => [
    statusLabel(String(p.status), t),
    p.serialNumber ?? "",
    p.ipAddress ?? "",
    p.manufacturer ?? "",
    p.model ?? "",
    p.location?.name ?? "",
    p.workUnit?.name ?? "",
    tonerPct(p, "BLACK"),
    tonerPct(p, "CYAN"),
    tonerPct(p, "MAGENTA"),
    tonerPct(p, "YELLOW"),
    totalCounter(p),
    fmtDateTime(p.lastSeen),
  ]);
  return { title: t("Inventario de impresoras"), fileBase: "inventario-impresoras", columns, rows };
}

// --- Descarga de un blob ----------------------------------------------------

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

// --- CSV (sin librería) -----------------------------------------------------

/** Escapa un campo CSV y neutraliza inyección de fórmulas (= + - @ tab CR). */
function csvField(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(report: ReportSpec): void {
  const lines = [
    report.columns.map((c) => csvField(c.header)).join(","),
    ...report.rows.map((r) => r.map(csvField).join(",")),
  ];
  // BOM UTF-8 para que Excel abra los acentos correctamente.
  const csv = "﻿" + lines.join("\r\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${report.fileBase}-${stamp()}.csv`);
}

// --- Excel (.xlsx) con SheetJS ---------------------------------------------

export async function downloadXlsx(report: ReportSpec): Promise<void> {
  const XLSX = await import("xlsx");
  const aoa: Cell[][] = [report.columns.map((c) => c.header), ...report.rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = report.columns.map((c) => ({ wch: c.width ?? Math.max(10, c.header.length + 2) }));
  // Filtro automático y fila de cabecera congelada.
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: report.rows.length, c: report.columns.length - 1 } }),
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reporte");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  downloadBlob(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${report.fileBase}-${stamp()}.xlsx`,
  );
}

// --- PDF con jsPDF + autoTable (estilo del app) ----------------------------

const ACCENT: [number, number, number] = [3, 105, 161]; // --accent del app (#0369a1)
const ZEBRA: [number, number, number] = [241, 245, 249];
const INK: [number, number, number] = [15, 23, 42];

export async function downloadPdf(report: ReportSpec, subtitle?: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 32;

  // Cabecera: barra de acento + título + subtítulo.
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, pageW, 6, "F");
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(report.title, margin, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const generated = `${new Date().toLocaleString()} · ${report.rows.length} ${report.rows.length === 1 ? "registro" : "registros"}`;
  doc.text(subtitle ? `${subtitle} · ${generated}` : generated, margin, 55);

  const numericIdx = new Set(report.columns.map((c, i) => (c.numeric ? i : -1)).filter((i) => i >= 0));
  autoTable(doc, {
    startY: 68,
    margin: { left: margin, right: margin, bottom: 40 },
    head: [report.columns.map((c) => c.header)],
    body: report.rows.map((r) => r.map((v) => (v == null || v === "" ? "—" : String(v)))),
    styles: { font: "helvetica", fontSize: 8, cellPadding: 4, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.5 },
    headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: "bold", halign: "left" },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: Object.fromEntries([...numericIdx].map((i) => [i, { halign: "right" }])),
    didDrawPage: (data) => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text("Printer Device Manager", margin, doc.internal.pageSize.getHeight() - 18);
      doc.text(`${data.pageNumber} / ${page}`, pageW - margin, doc.internal.pageSize.getHeight() - 18, { align: "right" });
    },
  });
  doc.save(`${report.fileBase}-${stamp()}.pdf`);
}
