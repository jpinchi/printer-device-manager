/**
 * @pdm/types — Contrato compartido del proyecto.
 *
 * Estos tipos son consumidos por TODOS los paquetes/apps (snmp-core, server,
 * frontend, tests). Son un CONTRATO congelado: no se modifican sin coordinar
 * con el orquestador, porque un cambio aquí impacta a todos los agentes.
 */

// ---------------------------------------------------------------------------
// Fabricantes
// ---------------------------------------------------------------------------

export type Manufacturer =
  | "RICOH"
  | "HP"
  | "CANON"
  | "BROTHER"
  | "KYOCERA"
  | "XEROX"
  | "LEXMARK"
  | "UNKNOWN";

/** Números de empresa IANA (rama sysObjectID 1.3.6.1.4.1.<n>). */
export const ENTERPRISE_TO_MANUFACTURER: Record<number, Manufacturer> = {
  367: "RICOH",
  11: "HP",
  1602: "CANON",
  2435: "BROTHER",
  1347: "KYOCERA",
  253: "XEROX",
  641: "LEXMARK",
};

// ---------------------------------------------------------------------------
// SNMP
// ---------------------------------------------------------------------------

export type SnmpVersion = "v1" | "v2c" | "v3";

export interface SnmpCredentials {
  version: SnmpVersion;
  community: string;
  timeoutMs?: number;
  retries?: number;
}

// ---------------------------------------------------------------------------
// Estado del dispositivo
// ---------------------------------------------------------------------------

export type OnlineState = "ONLINE" | "OFFLINE" | "UNKNOWN";

export type DeviceCondition =
  | "READY"
  | "PRINTING"
  | "WARNING"
  | "ERROR"
  | "PAPER_JAM"
  | "DOOR_OPEN"
  | "PAPER_EMPTY"
  | "TONER_LOW"
  | "TONER_EMPTY"
  | "MAINTENANCE_REQUIRED"
  | "UNKNOWN";

export interface PrinterStatus {
  online: OnlineState;
  conditions: DeviceCondition[];
  /** Texto crudo de estado si el dispositivo lo expone. */
  raw?: string;
}

// ---------------------------------------------------------------------------
// Consumibles
// ---------------------------------------------------------------------------

export type SupplyColor = "BLACK" | "CYAN" | "MAGENTA" | "YELLOW" | "OTHER";

export type SupplyType =
  | "TONER"
  | "INK"
  | "DRUM"
  | "FUSER"
  | "WASTE_TONER"
  | "MAINTENANCE_KIT"
  | "STAPLES"
  | "OTHER";

export interface Supply {
  name: string;
  type: SupplyType;
  color: SupplyColor;
  /** Nivel crudo reportado por Printer-MIB (puede ser negativo = estado especial). */
  level: number;
  maxCapacity: number;
  /** Porcentaje 0-100 ya normalizado, o null si no se puede calcular. */
  percent: number | null;
}

// ---------------------------------------------------------------------------
// Contadores
// ---------------------------------------------------------------------------

export type CounterType =
  | "TOTAL"
  | "BLACK_WHITE"
  | "COLOR"
  | "COPIES"
  | "PRINTS"
  | "SCANS"
  | "FAX"
  | "DUPLEX";

export interface Counter {
  type: CounterType;
  value: number;
}

// ---------------------------------------------------------------------------
// Bandejas
// ---------------------------------------------------------------------------

export interface Tray {
  name: string;
  /** Tamaño físico del papel (A4, Carta, "216 × 279 mm"…), derivado de prtInput. */
  paperSize?: string;
  /** Tipo/medio configurado (prtInputMediaName): "Normal 2", "Plain"… */
  paperType?: string;
  capacity?: number;
  currentLevel?: number;
  /** Unidad de capacidad/nivel (prtInputCapacityUnit): normalmente "hojas". */
  capacityUnit?: string;
  isEmpty: boolean;
}

// ---------------------------------------------------------------------------
// Información general / red
// ---------------------------------------------------------------------------

export interface PrinterInfo {
  manufacturer: Manufacturer;
  model?: string;
  serialNumber?: string;
  deviceName?: string;
  hostname?: string;
  macAddress?: string;
  firmware?: string;
  location?: string;
  description?: string;
  /** Uptime en centésimas de segundo (sysUpTime) o segundos normalizados. */
  uptimeSeconds?: number;
  sysObjectId?: string;
  sysDescr?: string;
}

// ---------------------------------------------------------------------------
// Resultado agregado de una consulta (lo que devuelve un adapter/probe)
// ---------------------------------------------------------------------------

export interface ProbeResult {
  ip: string;
  reachable: boolean;
  isPrinter: boolean;
  info: PrinterInfo;
  supplies: Supply[];
  counters: Counter[];
  trays: Tray[];
  status: PrinterStatus;
  /** OIDs que fallaron sin abortar el probe (tolerancia a fallos, sección 34). */
  errors: ProbeError[];
  queriedAt: string; // ISO 8601
}

export interface ProbeError {
  operation: string;
  oid?: string;
  message: string;
}
