/**
 * Funciones PURAS de parsing/normalización.
 *
 * Sin dependencias de red: reciben datos crudos y devuelven datos normalizados.
 * Son el objetivo principal de las pruebas unitarias (sección 36).
 */
import {
  ENTERPRISE_TO_MANUFACTURER,
  type Manufacturer,
  type SupplyColor,
  type SupplyType,
} from "@pdm/types";

/**
 * Detecta el fabricante. Prioriza el número de empresa del sysObjectID
 * (fiable); si no, cae a heurística sobre el texto de sysDescr.
 */
export function detectManufacturer(
  sysObjectId?: string,
  sysDescr?: string,
): Manufacturer {
  const enterprise = enterpriseNumberOf(sysObjectId);
  if (enterprise !== null && ENTERPRISE_TO_MANUFACTURER[enterprise]) {
    return ENTERPRISE_TO_MANUFACTURER[enterprise];
  }

  const d = (sysDescr ?? "").toUpperCase();
  if (!d) return "UNKNOWN";
  if (d.includes("RICOH") || d.includes("LANIER") || d.includes("SAVIN")) return "RICOH";
  if (d.includes("HEWLETT") || /\bHP\b/.test(d)) return "HP";
  if (d.includes("CANON")) return "CANON";
  if (d.includes("BROTHER")) return "BROTHER";
  if (d.includes("KYOCERA")) return "KYOCERA";
  if (d.includes("XEROX")) return "XEROX";
  if (d.includes("LEXMARK")) return "LEXMARK";
  return "UNKNOWN";
}

/** Extrae el número de empresa IANA de un sysObjectID (1.3.6.1.4.1.<n>...). */
export function enterpriseNumberOf(sysObjectId?: string): number | null {
  if (!sysObjectId) return null;
  const m = sysObjectId.match(/^\.?1\.3\.6\.1\.4\.1\.(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Normaliza nivel/capacidad de Printer-MIB a porcentaje 0-100.
 * Devuelve null cuando el valor no es calculable (estados especiales negativos).
 */
export function supplyPercent(level: number, maxCapacity: number): number | null {
  if (!Number.isFinite(level) || !Number.isFinite(maxCapacity)) return null;
  if (maxCapacity <= 0) return null; // -1 desconocido, -2 sin restricción
  if (level < 0) return null; // -1 desconocido, -2 "queda algo", -3
  const pct = Math.round((level / maxCapacity) * 100);
  return Math.max(0, Math.min(100, pct));
}

/** Clasifica el color a partir de la descripción del consumible. */
export function classifySupplyColor(description: string): SupplyColor {
  const d = description.toUpperCase();
  if (d.includes("BLACK") || /\bK\b/.test(d) || d.includes("NEGRO")) return "BLACK";
  if (d.includes("CYAN") || d.includes("CIAN")) return "CYAN";
  if (d.includes("MAGENTA")) return "MAGENTA";
  if (d.includes("YELLOW") || d.includes("AMARILLO")) return "YELLOW";
  return "OTHER";
}

/** Mapea el enum prtMarkerSuppliesType (Printer-MIB) a nuestro SupplyType. */
export function classifySupplyType(typeCode: number, description = ""): SupplyType {
  // 3=toner 4=wasteToner 6=ink 9=drum 15=fuser 21=staples (subconjunto usual)
  switch (typeCode) {
    case 3:
      return "TONER";
    case 4:
      return "WASTE_TONER";
    case 6:
      return "INK";
    case 9:
      return "DRUM";
    case 15:
      return "FUSER";
    case 21:
      return "STAPLES";
    default:
      break;
  }
  const d = description.toUpperCase();
  if (d.includes("TONER")) return "TONER";
  if (d.includes("DRUM")) return "DRUM";
  if (d.includes("FUSER")) return "FUSER";
  if (d.includes("WASTE")) return "WASTE_TONER";
  if (d.includes("STAPLE")) return "STAPLES";
  if (d.includes("MAINTENANCE") || d.includes("KIT")) return "MAINTENANCE_KIT";
  return "OTHER";
}

/** Convierte sysUpTime (centésimas de segundo) a segundos. */
export function ticksToSeconds(timeticks: number): number {
  return Math.floor(timeticks / 100);
}

/** Formatea un buffer/octetstring de MAC a AA:BB:CC:DD:EE:FF. */
export function formatMac(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  let bytes: number[] = [];
  if (Buffer.isBuffer(raw)) {
    bytes = Array.from(raw);
  } else if (typeof raw === "string") {
    // Puede venir ya como "aa:bb:.." o como bytes crudos.
    if (/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/.test(raw)) {
      return raw.toUpperCase().replace(/-/g, ":");
    }
    bytes = Array.from(Buffer.from(raw, "binary"));
  } else {
    return undefined;
  }
  if (bytes.length !== 6) return undefined;
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":").toUpperCase();
}

/**
 * Normaliza un conteo de bandeja (capacidad/nivel de prtInput). En Printer-MIB
 * los negativos NO son cantidades sino códigos: −1=otro, −2=desconocido,
 * −3=queda papel pero la cantidad es desconocida. Se devuelven como `undefined`
 * para no mostrar "-3" como si fuera un número de hojas.
 */
export function normalizeTrayCount(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/**
 * Etiqueta legible de prtInputCapacityUnit (PrtCapacityUnitTC, RFC 3805).
 * Para bandejas suele ser 8 = hojas. Devuelve `undefined` si es desconocido.
 */
export function capacityUnitLabel(code: unknown): string | undefined {
  switch (Number(code)) {
    case 8:
      return "hojas";
    case 7:
      return "impresiones";
    case 18:
      return "ítems";
    case 11:
      return "horas";
    case 16:
      return "pies";
    case 17:
      return "metros";
    case 19:
      return "%";
    default:
      return undefined; // 1=other, 2=unknown, 3/4=dimensiones (no aplica)
  }
}

/** Tamaños de papel conocidos, en mm [lado corto, lado largo]. */
const PAPER_SIZES_MM: Array<{ name: string; dims: [number, number] }> = [
  { name: "A3", dims: [297, 420] },
  { name: "A4", dims: [210, 297] },
  { name: "A5", dims: [148, 210] },
  { name: "A6", dims: [105, 148] },
  { name: "B4 (JIS)", dims: [257, 364] },
  { name: "B5 (JIS)", dims: [182, 257] },
  { name: "Carta", dims: [216, 279] },
  { name: "Legal", dims: [216, 356] },
  { name: "Tabloide", dims: [279, 432] },
  { name: "Ejecutivo", dims: [184, 267] },
  { name: "Media carta", dims: [140, 216] },
];

/**
 * Deriva el TAMAÑO real del papel a partir de las dimensiones de prtInput
 * (feedDir/xFeedDir) y su unidad (prtInputDimUnit: 3=diezmilésimas de pulgada,
 * 4=micrómetros). Intenta reconocer un tamaño estándar (A4, Carta…) y, si no,
 * devuelve las medidas en mm ("216 × 279 mm"). Devuelve `undefined` si no hay
 * dimensiones válidas.
 */
export function paperSizeFromDims(
  feedDir: unknown,
  xFeedDir: unknown,
  dimUnit: unknown,
): string | undefined {
  const a = Number(feedDir);
  const b = Number(xFeedDir);
  const unit = Number(dimUnit);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return undefined;

  // A milímetros según la unidad declarada.
  const toMm =
    unit === 4
      ? (v: number) => v / 1000 // micrómetros → mm
      : (v: number) => (v / 10000) * 25.4; // diezmilésimas de pulgada → mm (por defecto)
  const mmA = toMm(a);
  const mmB = toMm(b);
  const short = Math.min(mmA, mmB);
  const long = Math.max(mmA, mmB);

  const TOL = 4; // mm
  for (const { name, dims } of PAPER_SIZES_MM) {
    if (Math.abs(short - dims[0]) <= TOL && Math.abs(long - dims[1]) <= TOL) return name;
  }
  return `${Math.round(short)} × ${Math.round(long)} mm`;
}

/** ¿El sysObjectID/sysDescr corresponde a una impresora? (sección 14) */
export function looksLikePrinter(sysDescr?: string, hasPrinterMib = false): boolean {
  if (hasPrinterMib) return true;
  const d = (sysDescr ?? "").toUpperCase();
  return (
    d.includes("PRINTER") ||
    d.includes("MFP") ||
    d.includes("IMAGE") ||
    d.includes("LASERJET") ||
    d.includes("RICOH") ||
    d.includes("KYOCERA")
  );
}
