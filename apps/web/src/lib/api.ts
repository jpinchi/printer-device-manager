/**
 * Cliente de API tipado.
 *
 * Todas las llamadas van a rutas relativas `/api/...`, que Next.js reenvía al
 * backend Express vía rewrites (ver next.config.js). Así el navegador nunca
 * cruza orígenes (sin CORS) y el server no necesita cambios.
 *
 * Degradación elegante: los endpoints de Alerts (Fase 5) e Historial (Fase 6)
 * los construyen otros agentes EN PARALELO. Si aún no existen responden 404;
 * en ese caso devolvemos `pending: true` en vez de lanzar, para que la UI
 * muestre un estado "pendiente" y no un crash.
 */
import type {
  ApiPrinter,
  ApiHealth,
  ApiAlert,
  ApiHistoryPoint,
  ApiDiscoveryResult,
  ApiIpScan,
  ApiLocation,
  ApiWorkUnit,
  ApiUser,
  ApiSnmpConfig,
  ApiSnmpTest,
  ApiDriver,
  ApiInstallResult,
  ApiRemoteProbe,
  ApiRemoteInstall,
  ApiSettings,
  ApiModelImage,
  ApiSnmpWriteProbe,
  ApiAssignIp,
} from "./types";
import { getToken, clearSession, type SessionUser } from "./auth";

/** Error de API con el status HTTP para que la UI decida cómo degradar. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Respuesta tolerante: los datos, o una marca de "pendiente" si el endpoint no existe (404). */
export interface Soft<T> {
  data: T | null;
  pending: boolean; // true => el endpoint aún no está implementado (404)
  error: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    // El dashboard siempre quiere datos frescos.
    cache: "no-store",
  });

  if (!res.ok) {
    // 401 con enforcement activo: sesión inválida/ausente → a login.
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
      clearSession();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* respuesta sin cuerpo JSON */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Envuelve una promesa y convierte 404 en `pending` en vez de error. */
async function soft<T>(p: Promise<T>, emptyValue: T): Promise<Soft<T>> {
  try {
    const data = await p;
    return { data, pending: false, error: null };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Endpoint aún no implementado por el agente correspondiente.
      return { data: emptyValue, pending: true, error: null };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { data: emptyValue, pending: false, error: message };
  }
}

/**
 * Descarga un archivo protegido por auth. Un `<a href>` normal NO adjunta el
 * header `Authorization: Bearer <token>` (el token vive en localStorage), así
 * que con auth activada la ruta responde 401 y "no descarga nada". Aquí se hace
 * `fetch` con el token, se obtiene el blob y se dispara la descarga en cliente.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(path, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      clearSession();
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    throw new ApiError(`No se pudo descargar (HTTP ${res.status})`, res.status);
  }

  // Nombre del archivo: Content-Disposition del server, o el de respaldo.
  const cd = res.headers.get("Content-Disposition");
  const match = cd?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Sube un archivo (multipart) con el token de auth, sin fijar Content-Type. */
async function uploadFile<T>(path: string, file: File, extra: Record<string, string> = {}, field = "file"): Promise<T> {
  const token = getToken();
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append(field, file);
  const res = await fetch(path, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      clearSession();
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    let message = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (b?.error) message = b.error;
    } catch {
      /* sin cuerpo JSON */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  // --- Salud ---
  health: () => request<ApiHealth>("/api/health"),

  // --- Ajustes (#5) ---
  getSettings: () => request<ApiSettings>("/api/settings"),
  updateSettings: (body: Record<string, unknown>) =>
    request<ApiSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),

  // --- Fotos por modelo ---
  listModelImages: () => request<ApiModelImage[]>("/api/model-images"),
  uploadModelImage: (manufacturer: string, model: string, file: File) =>
    uploadFile<{ key: string; model: string }>("/api/model-images", file, { manufacturer, model }),
  deleteModelImage: (key: string) =>
    request<void>(`/api/model-images/${encodeURIComponent(key)}`, { method: "DELETE" }),
  // Biblioteca de la central: fotos por modelo que ya tiene la central, para
  // reutilizarlas en otras sedes. `self` = este equipo ES la central.
  listCentralModelImages: () =>
    request<{ self: boolean; images: ApiModelImage[] }>("/api/model-images/central"),
  // URL (same-origin) de la miniatura de una foto de la central, vía proxy.
  centralModelImageUrl: (manufacturer: string, model: string) =>
    `/api/model-images/central/lookup?manufacturer=${encodeURIComponent(manufacturer)}&model=${encodeURIComponent(model)}`,
  // Copia una foto de la central a este equipo, asignándola al modelo destino.
  importModelImageFromCentral: (body: {
    sourceManufacturer: string;
    sourceModel: string;
    manufacturer: string;
    model: string;
  }) =>
    request<{ key: string; model: string }>("/api/model-images/import-from-central", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // --- Drivers (catálogo A+B+C) ---
  listDrivers: () => request<ApiDriver[]>("/api/drivers"),
  createDriver: (body: Record<string, unknown>) =>
    request<ApiDriver>("/api/drivers", { method: "POST", body: JSON.stringify(body) }),
  updateDriver: (id: string, body: Record<string, unknown>) =>
    request<ApiDriver>(`/api/drivers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDriver: (id: string) => request<void>(`/api/drivers/${id}`, { method: "DELETE" }),
  uploadDriverFile: (id: string, file: File) => uploadFile<ApiDriver>(`/api/drivers/${id}/file`, file),
  downloadDriverFile: (id: string, fileName: string) =>
    downloadFile(`/api/drivers/${id}/download`, fileName),
  installDriver: (id: string, printerId?: string) =>
    request<ApiInstallResult>(`/api/drivers/${id}/install`, {
      method: "POST",
      body: JSON.stringify({ printerId: printerId || undefined }),
    }),

  // --- Instalación remota (SMB admin$ + WMI/DCOM) ---
  remoteInstallProbe: (body: { host: string; username?: string; password?: string }) =>
    request<ApiRemoteProbe>("/api/remote-install/probe", { method: "POST", body: JSON.stringify(body) }),
  remoteInstall: (body: { host: string; driverId: string; printerId?: string; username: string; password: string }) =>
    request<ApiRemoteInstall>("/api/remote-install/install", { method: "POST", body: JSON.stringify(body) }),
  // Delegación a un hub (servidor que sí autentica al dominio).
  remoteHubGet: () =>
    request<{ enabled: boolean; hubUrl: string; hubUser: string; hasPassword: boolean }>("/api/remote-install/hub"),
  remoteHubSet: (body: { hubUrl: string; hubUser?: string; hubPassword?: string }) =>
    request<{ enabled: boolean; hubUrl: string; hubUser: string; hasPassword: boolean }>("/api/remote-install/hub", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remoteHubDrivers: () => request<ApiDriver[]>("/api/remote-install/hub/drivers"),
  remoteHubPrinters: () => request<ApiPrinter[]>("/api/remote-install/hub/printers"),

  // --- SNMP ---
  snmpConfig: () => request<ApiSnmpConfig>("/api/snmp/config"),
  snmpTest: (body: { ip: string; community?: string; version?: string }) =>
    request<ApiSnmpTest>("/api/snmp/test", { method: "POST", body: JSON.stringify(body) }),

  // --- Exportación CSV (descarga con auth) ---
  downloadHistoryCsv: (printerId: string, type: "status" | "counters" = "status") =>
    downloadFile(
      `/api/printers/${printerId}/history.csv?type=${type}`,
      `${type}-${printerId}.csv`,
    ),

  // --- Autenticación (secciones 23-24) ---
  login: (username: string, password: string) =>
    request<{ token: string; user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string) =>
    request<{ user: SessionUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<{ user: SessionUser }>("/api/auth/me"),
  setupNeeded: () => request<{ needed: boolean }>("/api/auth/setup-needed"),

  // --- Recuperación / cambio de contraseña ---
  // Cambio propio (o cambio obligatorio tras un reset). La clave ACTUAL es la
  // prueba de identidad; opcionalmente define el código de recuperación.
  changePassword: (body: {
    username: string;
    currentPassword: string;
    newPassword: string;
    recoveryCode?: string;
  }) =>
    request<{ token: string; user: SessionUser }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // "Olvidé mi contraseña": valida el código de recuperación y fija una nueva.
  forgotPassword: (body: { username: string; recoveryCode: string; newPassword: string }) =>
    request<{ token: string; user: SessionUser }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // --- Versión / auto-update del hub (público) ---
  hubVersion: () =>
    request<{ isHub: boolean; current: string; available: string | null; updateAvailable: boolean; updating: boolean }>("/api/hub/version"),
  hubUpdate: () =>
    request<{ started?: boolean; upToDate?: boolean; to?: string }>("/api/hub/update", { method: "POST" }),

  // --- Servidor de cuentas (central/hub) al que valida el login esta máquina ---
  getServer: () =>
    request<{ centralUrl: string; source: "file" | "env" | "none" }>("/api/auth/server"),
  setServer: (centralUrl: string) =>
    request<{ centralUrl: string; source: "file" | "env" | "none" }>("/api/auth/server", {
      method: "PUT",
      body: JSON.stringify({ centralUrl }),
    }),

  // --- Importar datos de la central/hub (inventario, ubicaciones, unidades, fotos) ---
  importFromCentral: (body: { centralUrl?: string; username: string; password: string }) =>
    request<{ ok: boolean; locations: number; workUnits: number; printers: number; images: number }>("/api/import/from-central", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // --- Sincronizar y guardar: empuja la data local al hub de la sede ---
  syncPush: (body: { serverUrl?: string; username: string; password: string }) =>
    request<{ ok: boolean; sent: Record<string, number>; applied: Record<string, number> }>("/api/sync/push", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // --- App de escritorio (descarga del instalador; público) ---
  desktopInfo: () =>
    request<{ available: boolean; fileName?: string; size?: number; version?: string | null }>("/api/desktop/info"),

  // --- Gestión de usuarios (admin-only) ---
  listUsers: () => request<ApiUser[]>("/api/users"),
  createUser: (body: { username: string; password: string; role: string }) =>
    request<ApiUser>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: { role?: string; active?: boolean }) =>
    request<ApiUser>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUser: (id: string) =>
    request<void>(`/api/users/${id}`, { method: "DELETE" }),
  // Reset de contraseña por el admin: fija una temporal (o la indicada) y obliga
  // a cambiarla. Devuelve la temporal EN CLARO una sola vez si se generó.
  resetUserPassword: (id: string, newPassword?: string) =>
    request<{ user: ApiUser; tempPassword?: string }>(`/api/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify(newPassword ? { newPassword } : {}),
    }),
  setUserRecoveryCode: (id: string, code: string) =>
    request<{ user: ApiUser }>(`/api/users/${id}/recovery-code`, {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  // --- Inventario (siempre disponible, Oleada 0) ---
  listPrinters: () => request<ApiPrinter[]>("/api/printers"),
  getPrinter: (id: string) => request<ApiPrinter>(`/api/printers/${id}`),
  addPrinter: (body: { ip: string; community?: string; version?: string }) =>
    request<{ printer: ApiPrinter }>("/api/printers", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  pollPrinter: (id: string) =>
    request<{ printer: ApiPrinter }>(`/api/printers/${id}/poll`, {
      method: "POST",
    }),
  pollAll: () =>
    request<{ total: number; online: number; offline: number; failed: number }>(
      "/api/printers/poll-all",
      { method: "POST" },
    ),
  deletePrinter: (id: string) =>
    request<void>(`/api/printers/${id}`, { method: "DELETE" }),
  setPrinterLocation: (id: string, locationId: string | null) =>
    request<ApiPrinter>(`/api/printers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ locationId }),
    }),
  setPrinterWorkUnit: (id: string, workUnitId: string | null) =>
    request<ApiPrinter>(`/api/printers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ workUnitId }),
    }),

  // --- Descubrimiento (Fase 2) ---
  scanDiscovery: (body: Record<string, unknown>) =>
    request<ApiDiscoveryResult>("/api/discovery/scan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  discoveryResults: () =>
    soft<ApiDiscoveryResult | null>(
      request<ApiDiscoveryResult>("/api/discovery/results"),
      null,
    ),

  // --- Escáner de IPs disponibles ---
  ipScan: (body: { start?: string; end?: string; cidr?: string; timeoutMs?: number }) =>
    request<ApiIpScan>("/api/network/ip-scan", { method: "POST", body: JSON.stringify(body) }),

  // --- Cambio de IP remoto · Etapa 1: sonda de capacidad SNMP-write (sin riesgo) ---
  snmpWriteProbe: (body: { ip: string; community?: string; writeCommunity: string; version?: string }) =>
    request<ApiSnmpWriteProbe>("/api/network/snmp-write-probe", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // --- Cambio de IP remoto · Etapa 2: escribir la IP (aplica al reiniciar) ---
  assignIp: (body: { ip: string; newIp: string; mask?: string; gateway?: string; writeCommunity: string; community?: string; version?: string; updateInventory?: boolean }) =>
    request<ApiAssignIp>("/api/network/assign-ip", { method: "POST", body: JSON.stringify(body) }),

  // --- Ubicaciones (Fase 3, planificado — puede no existir aún) ---
  listLocations: () => soft<ApiLocation[]>(request("/api/locations"), []),
  // --- Unidades de trabajo ---
  listWorkUnits: () => soft<ApiWorkUnit[]>(request("/api/workunits"), []),

  // --- Alerts (Fase 5) ---
  listAlerts: (status = "active") =>
    soft<ApiAlert[]>(request(`/api/alerts?status=${status}`), []),
  ackAlert: (id: string) =>
    request<unknown>(`/api/alerts/${id}/ack`, { method: "POST" }),
  resolveAlert: (id: string) =>
    request<unknown>(`/api/alerts/${id}/resolve`, { method: "POST" }),

  // --- Ubicaciones (Fase 3) ---
  createLocation: (body: { name: string; description?: string }) =>
    request<ApiLocation>("/api/locations", { method: "POST", body: JSON.stringify(body) }),
  updateLocation: (id: string, body: { name?: string; description?: string | null }) =>
    request<ApiLocation>(`/api/locations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteLocation: (id: string) =>
    request<void>(`/api/locations/${id}`, { method: "DELETE" }),
  createWorkUnit: (body: { name: string; description?: string }) =>
    request<ApiWorkUnit>("/api/workunits", { method: "POST", body: JSON.stringify(body) }),
  updateWorkUnit: (id: string, body: { name?: string; description?: string | null }) =>
    request<ApiWorkUnit>(`/api/workunits/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteWorkUnit: (id: string) =>
    request<void>(`/api/workunits/${id}`, { method: "DELETE" }),

  // --- Historial (Fase 6) ---
  // `limit` (default 12): últimos N puntos para el panel "Historial reciente".
  getHistory: (printerId: string, limit = 12) =>
    soft<ApiHistoryPoint[]>(
      request<{ history: ApiHistoryPoint[] }>(
        `/api/printers/${printerId}/history?limit=${limit}`,
      ).then((r) => r.history ?? []),
      [],
    ),
};
