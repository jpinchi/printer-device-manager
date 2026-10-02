/**
 * Utilidades de presentación y derivación de datos de la flota.
 */
import type { ApiPrinter, ApiCounter, ApiSupply } from "./types";

/**
 * Umbral de "tóner bajo" (%). Es un `let` con live-binding: se inicializa en 20
 * y `applyTonerThreshold` lo actualiza con el valor de Ajustes al cargar la app,
 * de modo que todos los componentes que lo importan lo recogen sin cambios.
 */
export let TONER_LOW_THRESHOLD = 20;

/** Actualiza el umbral de tóner bajo (desde Ajustes). */
export function applyTonerThreshold(percent: number | null | undefined): void {
  if (typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100) {
    TONER_LOW_THRESHOLD = percent;
  }
}

/** Etiquetas legibles para colores de consumible. */
export const COLOR_LABEL: Record<string, string> = {
  BLACK: "Negro",
  CYAN: "Cian",
  MAGENTA: "Magenta",
  YELLOW: "Amarillo",
  OTHER: "Otro",
};

/** Inicial (K/C/M/Y) para etiquetar cada tóner de forma compacta. */
export const COLOR_LETTER: Record<string, string> = {
  BLACK: "K",
  CYAN: "C",
  MAGENTA: "M",
  YELLOW: "Y",
  OTHER: "·",
};

/** Orden canónico de los tóneres (K, C, M, Y) para presentarlos consistentes. */
const COLOR_ORDER = ["BLACK", "CYAN", "MAGENTA", "YELLOW"];

/** Tóneres/tinta ordenados K→C→M→Y (los desconocidos, al final). */
export function orderedToners(p: ApiPrinter): ApiSupply[] {
  return tonerSupplies(p).slice().sort((a, b) => {
    const ai = COLOR_ORDER.indexOf(String(a.color));
    const bi = COLOR_ORDER.indexOf(String(b.color));
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

/** Los tóneres en nivel bajo (≤ umbral), en orden K→C→M→Y. */
export function lowToners(p: ApiPrinter): ApiSupply[] {
  return orderedToners(p).filter(
    (s) => s.percent != null && s.percent <= TONER_LOW_THRESHOLD,
  );
}

/** % a partir del cual se avisa "a la mitad" (heads-up). Fijo. */
export const TONER_NOTICE_THRESHOLD = 50;

/** Nivel de severidad de un tóner. */
export type TonerLevel = "ok" | "notice" | "low" | "critical";

/**
 * Nivel de un tóner según su % y los umbrales:
 *  - "critical": <= mitad del umbral bajo (p. ej. <=10% con umbral 20%).
 *  - "low": entre la mitad del umbral bajo y el umbral bajo.
 *  - "notice": entre el umbral bajo y el 50% (aviso "a la mitad").
 *  - "ok": por encima del 50% (o sin dato).
 * Los tramos low/critical se adaptan si cambias el umbral en Ajustes.
 */
export function tonerLevel(percent: number | null | undefined): TonerLevel {
  if (percent == null) return "ok";
  if (percent <= TONER_LOW_THRESHOLD / 2) return "critical";
  if (percent <= TONER_LOW_THRESHOLD) return "low";
  if (percent <= TONER_NOTICE_THRESHOLD) return "notice";
  return "ok";
}

/** Paleta de clases por nivel de tóner. */
export interface TonerTone {
  level: TonerLevel;
  /** ¿Cualquier nivel con color? (notice || low || critical) */
  flag: boolean;
  /** ¿Está por debajo del umbral bajo? (low || critical) */
  low: boolean;
  /** Color de texto para el % (neutro si ok). */
  text: string;
  /** Anillo para barras (vacío si ok). */
  ring: string;
  /** Borde+fondo+texto para chips/píldoras. */
  chip: string;
}

/**
 * Clases Tailwind por nivel de tóner, para pintar el %/chip/anillo de forma
 * CONSISTENTE en toda la app: rojo (crítico), ámbar (bajo), teal (a la mitad),
 * neutro (ok). Se usan cadenas literales (no interpoladas) para que el JIT de
 * Tailwind las genere; este archivo está dentro del `content` de tailwind.
 */
export function tonerTone(percent: number | null | undefined): TonerTone {
  const level = tonerLevel(percent);
  if (level === "critical") {
    return {
      level, flag: true, low: true,
      text: "text-danger",
      ring: "ring-1 ring-danger/60",
      chip: "border-danger/40 bg-danger/10 text-danger",
    };
  }
  if (level === "low") {
    return {
      level, flag: true, low: true,
      text: "text-warn",
      ring: "ring-1 ring-warn/60",
      chip: "border-warn/40 bg-warn/10 text-warn",
    };
  }
  if (level === "notice") {
    return {
      level, flag: true, low: false,
      text: "text-notice",
      ring: "ring-1 ring-notice/60",
      chip: "border-notice/40 bg-notice/10 text-notice",
    };
  }
  return {
    level, flag: false, low: false,
    text: "text-muted",
    ring: "",
    chip: "border-border bg-elev text-slate-300",
  };
}

/**
 * Extrae el nivel real (%) de un mensaje de alerta de tóner. Los mensajes son
 * del tipo "…por debajo del 20%. Nivel actual: 10%." → se toma el ÚLTIMO % del
 * texto (el nivel real, no el umbral). Devuelve null si no hay porcentaje.
 */
export function tonerPercentFromMessage(message: string | null | undefined): number | null {
  if (!message) return null;
  const all = message.match(/(\d+)\s*%/g);
  if (!all || all.length === 0) return null;
  const last = all[all.length - 1].match(/(\d+)/);
  return last ? Number(last[1]) : null;
}

/** Severidad de color de una alerta para pintar de forma consistente. */
export type AlertLevel = "danger" | "warn" | "notice" | "info";

/**
 * Nivel de color de una alerta. Para las de tóner (TONER_*) usa los MISMOS
 * tramos que el resto de la app (crítico=rojo, bajo=ámbar, mitad=teal), leyendo
 * el nivel real del mensaje; para las demás, mapea por severidad (ERROR→rojo,
 * WARNING→ámbar, resto→info).
 */
export function alertLevel(a: {
  type?: string | null;
  severity?: string | null;
  message?: string | null;
}): AlertLevel {
  const type = (a.type ?? "").toUpperCase();
  if (type.startsWith("TONER")) {
    const pct = tonerPercentFromMessage(a.message);
    const lvl =
      pct != null
        ? tonerLevel(pct)
        : type === "TONER_EMPTY"
          ? "critical"
          : type === "TONER_NOTICE"
            ? "notice"
            : "low";
    return lvl === "critical" ? "danger" : lvl === "low" ? "warn" : lvl === "notice" ? "notice" : "info";
  }
  const sev = (a.severity ?? "").toUpperCase();
  if (sev === "ERROR") return "danger";
  if (sev === "WARNING") return "warn";
  return "info";
}

/** Clase de color de texto por nivel de alerta (etiqueta severidad · tipo). */
export const ALERT_TEXT: Record<AlertLevel, string> = {
  danger: "text-danger",
  warn: "text-warn",
  notice: "text-notice",
  info: "text-muted",
};

/** Color del borde izquierdo (acento) de una tarjeta de alerta, por nivel. */
export const ALERT_BORDER: Record<AlertLevel, string> = {
  danger: "border-l-danger",
  warn: "border-l-warn",
  notice: "border-l-notice",
  info: "border-l-accent",
};

/** Variable CSS del color de tinte de la tarjeta de alerta, por nivel. */
export const ALERT_TINT_VAR: Record<AlertLevel, string> = {
  danger: "--color-danger",
  warn: "--color-warn",
  notice: "--color-notice",
  info: "--color-accent",
};

/** Menor porcentaje de tóner de la impresora (para ordenar por "más gastado"). */
export function minTonerPercent(p: ApiPrinter): number | null {
  const vals = tonerSupplies(p)
    .map((s) => s.percent)
    .filter((v): v is number => v != null);
  return vals.length ? Math.min(...vals) : null;
}

/** Tema de la app para elegir colores legibles según fondo claro/oscuro. */
export type UiTheme = "dark" | "light";

const TONER_DARK: Record<string, string> = {
  BLACK: "#e2e8f0",
  CYAN: "#22d3ee",
  MAGENTA: "#e879f9",
  YELLOW: "#facc15",
  OTHER: "#38bdf8",
};
// En claro se usan tonos más oscuros/saturados para que se distingan sobre
// fondos claros (el negro pasa de casi-blanco a gris oscuro; el amarillo a
// ámbar, etc.).
const TONER_LIGHT: Record<string, string> = {
  BLACK: "#334155",
  CYAN: "#0891b2",
  MAGENTA: "#c026d3",
  YELLOW: "#ca8a04",
  OTHER: "#0284c7",
};

/**
 * Color CSS de la barra/serie de un consumible, adaptado al tema. Por defecto
 * usa la paleta oscura (compatibilidad con llamadas sin tema).
 */
export function supplyBarColor(color: string, theme: UiTheme = "dark"): string {
  const table = theme === "light" ? TONER_LIGHT : TONER_DARK;
  return table[color] ?? table.OTHER;
}

/** Etiquetas legibles para tipos de contador. */
export const COUNTER_LABEL: Record<string, string> = {
  TOTAL: "Total de páginas",
  BLACK_WHITE: "Blanco y negro",
  COLOR: "Color",
  COPIES: "Copias",
  PRINTS: "Impresiones",
  SCANS: "Escaneos",
  FAX: "Fax",
  DUPLEX: "Dúplex",
};

/** Tóner negro (%), o null si no disponible. */
export function blackTonerPercent(p: ApiPrinter): number | null {
  const k = (p.supplies ?? []).find((s) => s.color === "BLACK");
  return k?.percent ?? null;
}

/** ¿La impresora tiene algún tóner por debajo del umbral? */
export function hasTonerLow(p: ApiPrinter): boolean {
  return (p.supplies ?? []).some(
    (s) =>
      s.type === "TONER" &&
      s.percent != null &&
      s.percent <= TONER_LOW_THRESHOLD,
  );
}

/** Solo los consumibles de tipo tóner/tinta, útil para la vista de Supplies. */
export function tonerSupplies(p: ApiPrinter): ApiSupply[] {
  return (p.supplies ?? []).filter(
    (s) => s.type === "TONER" || s.type === "INK",
  );
}

/**
 * La API acumula filas de contadores (una por poll). Deja el valor más reciente
 * por tipo, ordenado por `collectedAt`.
 */
export function latestCounters(counters: ApiCounter[] = []): ApiCounter[] {
  const byType = new Map<string, ApiCounter>();
  for (const c of counters) {
    const prev = byType.get(c.counterType);
    if (!prev) {
      byType.set(c.counterType, c);
      continue;
    }
    const a = c.collectedAt ? Date.parse(c.collectedAt) : 0;
    const b = prev.collectedAt ? Date.parse(prev.collectedAt) : 0;
    if (a >= b) byType.set(c.counterType, c);
  }
  return [...byType.values()];
}

/** Contador TOTAL más reciente, o null. */
export function totalCounter(p: ApiPrinter): number | null {
  const total = latestCounters(p.counters).find((c) => c.counterType === "TOTAL");
  return total?.value ?? null;
}

/**
 * Formatea enteros grandes con COMA como separador de miles (ej. 154,332).
 * Los contadores son páginas enteras; se usa `en-US` para que el separador de
 * miles sea "," y no "." (que en es-ES se confunde con un decimal).
 */
export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}

/** Uptime en segundos → texto legible (d h m). */
export function fmtUptime(seconds?: number | null): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

/** Fecha ISO → local legible. */
export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES");
}

/** Tiempo relativo simple ("hace 5 min"). */
export function fmtRelative(iso?: string | null): string {
  if (!iso) return "nunca";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "nunca";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}
