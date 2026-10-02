/**
 * Deduplicación de dispositivos descubiertos (sección 26: "Evitar duplicados
 * por IP/MAC/serial").
 *
 * Función PURA y testeable. Recorre la lista en orden y descarta cualquier
 * dispositivo cuya IP, MAC o serial ya se haya visto. Conserva la primera
 * aparición (la más "temprana" del escaneo).
 */
import type { DiscoveredDevice } from "./types.js";

/** Normaliza una MAC a minúsculas sin separadores, o "" si no aplica. */
function normalizeMac(mac?: string): string {
  if (!mac) return "";
  return mac.toLowerCase().replace(/[^0-9a-f]/g, "");
}

/** Normaliza un serial (trim + minúsculas), o "" si no aplica. */
function normalizeSerial(serial?: string): string {
  if (!serial) return "";
  return serial.trim().toLowerCase();
}

/** Normaliza una IP (trim), o "" si no aplica. */
function normalizeIp(ip?: string): string {
  if (!ip) return "";
  return ip.trim();
}

/**
 * Devuelve una copia de `devices` sin duplicados por IP, MAC o serial.
 *
 * Un dispositivo es duplicado si comparte cualquiera de esas tres claves con
 * uno ya aceptado. MAC/serial vacíos o ausentes NO cuentan como colisión
 * (dos equipos sin MAC no se consideran el mismo).
 */
export function dedupeDevices(devices: DiscoveredDevice[]): DiscoveredDevice[] {
  const seenIps = new Set<string>();
  const seenMacs = new Set<string>();
  const seenSerials = new Set<string>();
  const out: DiscoveredDevice[] = [];

  for (const device of devices) {
    const ip = normalizeIp(device.ip);
    const mac = normalizeMac(device.mac);
    const serial = normalizeSerial(device.serial);

    const dupByIp = ip !== "" && seenIps.has(ip);
    const dupByMac = mac !== "" && seenMacs.has(mac);
    const dupBySerial = serial !== "" && seenSerials.has(serial);

    if (dupByIp || dupByMac || dupBySerial) {
      continue;
    }

    if (ip !== "") seenIps.add(ip);
    if (mac !== "") seenMacs.add(mac);
    if (serial !== "") seenSerials.add(serial);
    out.push(device);
  }

  return out;
}
