/**
 * Tipos de cara a la API (vista Frontend).
 *
 * La API devuelve filas Prisma, cuya forma difiere ligeramente de los tipos de
 * dominio de `@pdm/types` (p. ej. el contador usa `counterType` en vez de
 * `type`, y las filas traen `id`/`printerId`/timestamps). Reutilizamos los
 * enums de `@pdm/types` como CONTRATO y definimos aquí las interfaces que
 * realmente viajan por HTTP.
 */
import type {
  Manufacturer,
  SupplyColor,
  SupplyType,
  CounterType,
  OnlineState,
} from "@pdm/types";

export type { Manufacturer, SupplyColor, SupplyType, CounterType, OnlineState };

/** Ubicación (modelo Location). */
export interface ApiLocation {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Unidad de trabajo (fila WorkUnit): misma forma que ApiLocation. */
export interface ApiWorkUnit {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Consumible tal como lo devuelve la API (fila PrinterSupply). */
export interface ApiSupply {
  id: string;
  printerId: string;
  name: string;
  type: SupplyType | string;
  color: SupplyColor | string;
  level: number;
  maxCapacity: number;
  percent: number | null;
  updatedAt?: string;
}

/** Contador (fila PrinterCounter). Se acumulan histórico; deduplicar por tipo. */
export interface ApiCounter {
  id: string;
  printerId: string;
  counterType: CounterType | string;
  value: number;
  collectedAt?: string;
}

/** Bandeja (fila PrinterTray). */
export interface ApiTray {
  id: string;
  printerId: string;
  trayName: string;
  paperSize?: string | null;
  paperType?: string | null;
  capacity?: number | null;
  currentLevel?: number | null;
  capacityUnit?: string | null;
  isEmpty: boolean;
}

/**
 * Impresora tal como la devuelve la API.
 *
 * `GET /api/printers` incluye `supplies` + `location`.
 * `GET /api/printers/:id` incluye además `counters` + `trays`.
 * Las credenciales SNMP NUNCA se usan en el cliente (sección 23).
 */
export interface ApiPrinter {
  id: string;
  name: string;
  ipAddress: string;
  macAddress?: string | null;
  hostname?: string | null;
  manufacturer: Manufacturer | string;
  model?: string | null;
  serialNumber?: string | null;
  firmware?: string | null;
  snmpVersion?: string;
  sysObjectId?: string | null;
  status: OnlineState | string;
  lastSeen?: string | null;
  /** sysUpTime (segundos) y momento de lectura, para calcular el uptime en vivo. */
  uptimeSeconds?: number | null;
  uptimeReadAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  locationId?: string | null;
  location?: ApiLocation | null;
  workUnitId?: string | null;
  workUnit?: ApiWorkUnit | null;
  supplies?: ApiSupply[];
  counters?: ApiCounter[];
  trays?: ApiTray[];
}

export interface ApiHealth {
  ok: boolean;
  mock: boolean;
  time: string;
}

/** Configuración SNMP efectiva del servidor (community enmascarada). */
export interface ApiSnmpConfig {
  version: string;
  community: string;
  timeoutMs: number;
  retries: number;
  mock: boolean;
  polling: {
    enabled: boolean;
    intervals: {
      status: number;
      errors: number;
      supplies: number;
      trays: number;
      counters: number;
      deviceInfo: number;
    };
  };
}

/** Resultado de una prueba de conectividad SNMP contra una IP. */
export interface ApiSnmpTest {
  ip: string;
  reachable: boolean;
  isPrinter: boolean;
  manufacturer: string;
  model: string | null;
  serialNumber: string | null;
  sysDescr: string | null;
  sysObjectId: string | null;
  uptimeSeconds: number | null;
  status: string;
  supplies: number;
  trays: number;
  counters: Array<{ type: string; value: number }>;
  failedOids: number;
  queriedAt: string;
}

/** Usuario (modelo User, sin passwordHash). */
export interface ApiUser {
  id: string;
  username: string;
  role: "Administrator" | "Technician" | "Viewer" | string;
  active: boolean;
  /** true = debe cambiar la contraseña en el próximo login (tras un reset). */
  mustChangePassword?: boolean;
  /** true = tiene un código de recuperación configurado. */
  hasRecoveryCode?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Alerta / evento. La forma exacta la define el Agente Alerts (Fase 5); nos
 * alineamos con el modelo `PrinterEvent`. Campos opcionales por tolerancia.
 */
export interface ApiAlert {
  id: string;
  printerId?: string;
  severity?: "INFO" | "WARNING" | "ERROR" | string;
  type?: string;
  message?: string;
  source?: string | null;
  createdAt?: string;
  resolvedAt?: string | null;
  acknowledgedAt?: string | null;
  conditionKey?: string | null;
  active?: boolean;
  /** Datos de la impresora afectada (para identificarla en la UI). */
  printer?: {
    name: string;
    ip: string;
    manufacturer: string;
    model: string | null;
    location: string | null;
  } | null;
}

/** Foto de un modelo de impresora (metadatos; la imagen se sirve por /lookup). */
export interface ApiModelImage {
  key: string;
  manufacturer: string;
  model: string;
  fileName: string;
  fileSize: number;
  updatedAt: string;
}

/** Ajustes de la aplicación (#5). La contraseña SMTP nunca llega al cliente. */
export interface ApiSettings {
  id: string;
  tonerLowPercent: number;
  tonerEmptyPercent: number;
  costPerPageBw: number;
  costPerPageColor: number;
  currency: string;
  replenishDays: number;
  alertEmailEnabled: boolean;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure: boolean;
  smtpUser?: string | null;
  alertFrom?: string | null;
  alertTo?: string | null;
  hasSmtpPassword: boolean;
  updatedAt?: string;
}

/** Entrada del catálogo de drivers. */
export interface ApiDriver {
  id: string;
  manufacturer: string;
  models: string;
  name: string;
  os: string;
  version?: string | null;
  url?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  hasFile: boolean;
  installArgs?: string | null;
  notes?: string | null;
  installable: boolean;
  fileKind?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Resultado de la sonda de conexión remota (SMB admin$ + WMI/DCOM) a un equipo. */
export interface ApiRemoteProbe {
  host: string;
  reachable: boolean;
  smbOk: boolean;
  wmiOk: boolean;
  authOk: boolean;
  remoteName: string | null;
  osVersion: string | null;
  userForm: string | null; // formato de usuario que autenticó (DOMINIO\usuario o usuario@FQDN)
  error: string | null;
}

/** Resultado de una instalación remota de driver. */
export interface ApiRemoteInstall {
  ok: boolean;
  host: string;
  driver: string;
  message: string;
  log: string;
}

/** Resultado de instalar un driver en el host del servidor. */
export interface ApiInstallResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  message: string;
}

/** Punto de historial (Fase 6, Agente Historial). Forma tentativa. */
export interface ApiHistoryPoint {
  id?: string;
  printerId?: string;
  status?: string;
  tonerBlack?: number | null;
  tonerCyan?: number | null;
  tonerMagenta?: number | null;
  tonerYellow?: number | null;
  totalPages?: number | null;
  timestamp?: string;
}

/** Una IP evaluada por el escáner de disponibilidad. */
export interface ApiIpScanEntry {
  ip: string;
  used: boolean;
  via: "printer" | "icmp" | "arp" | null;
  mac: string | null;
  printerName: string | null;
  printerModel: string | null;
  /** Ubicación (nombre) de la impresora del inventario que ocupa esta IP, o null. */
  printerLocation: string | null;
  /** Nombre del dispositivo que ocupa la IP (DNS inverso o NetBIOS), o null. */
  hostname: string | null;
  /** Identificación SNMP en vivo (aunque no esté en el inventario). */
  snmpName: string | null;
  snmpModel: string | null;
  snmpManufacturer: string | null;
  isPrinter: boolean;
  /** ¿respondió algo en vivo (ping/ARP/SNMP)? Si es false y está en inventario → reservada. */
  respondedLive: boolean;
}

/** Resultado de la sonda SNMP-write (Etapa 1 del cambio de IP remoto). */
export interface ApiSnmpWriteProbe {
  ip: string;
  reachable: boolean;
  sysName: string | null;
  currentSysLocation: string;
  addresses: Array<{ ip: string; mask: string | null }>;
  gateway: string | null;
  /** true si la community RW aceptó un SET no destructivo (write habilitado). */
  writeCommunityWorks: boolean;
  writeError: string | null;
}

/** Resultado de asignar una IP por SNMP (Etapa 2, flujo en dos tiempos). */
export interface ApiAssignIp {
  ip: string;
  newIp: string;
  mask: string | null;
  gateway: string | null;
  wrote: { ip?: boolean; mask?: boolean; gateway?: boolean };
  errors: string[] | null;
  before: { configIp: string | null; activeIp: string | null };
  after: { configIp: string | null; activeIp: string | null };
  /** true = escrita pero pendiente de reinicio para aplicar. */
  pending: boolean;
  /** true = el registro de inventario se apuntó a la IP nueva. */
  inventoryUpdated: boolean;
  inventoryError: string | null;
  note: string;
}

/** Resultado del escáner de IPs libres/en uso. */
export interface ApiIpScan {
  scanned: number;
  used: number;
  free: number;
  freeIps: string[];
  entries: ApiIpScanEntry[];
}

/** Resultado de un escaneo de descubrimiento (docs/api.md). */
export interface ApiDiscoveryResult {
  scannedIps: number;
  reachableCount: number;
  totalDevices: number;
  printersFound: number;
  byManufacturer: Record<string, number>;
  devices: Array<{
    ip: string;
    isPrinter: boolean;
    manufacturer?: string;
    model?: string;
  }>;
  durationMs: number;
}
