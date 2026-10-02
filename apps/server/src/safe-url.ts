/**
 * Validación de URLs externas a las que el servidor REENVÍA credenciales
 * (hubUrl / centralUrl). Objetivo: evitar SSRF a destinos peligrosos y
 * protocolos raros, y no colgarse si el destino no responde.
 *
 * La red de la organizaciÃ³n es PRIVADA (10.x), así que NO se bloquean los rangos
 * privados ni loopback (un hub puede estar en la misma máquina). Sí se bloquean
 * los destinos "trampa": no-especificado (0.0.0.0/::) y link-local/metadata
 * (169.254.0.0/16, fe80::/10) — el clásico 169.254.169.254 de metadatos cloud.
 */

/** Parsea y exige esquema http(s). Devuelve la URL o null. */
export function parseHttpUrl(raw: string | null | undefined): URL | null {
  if (!raw || typeof raw !== "string") return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return u;
}

/** ¿Host prohibido como destino (link-local/metadata o no especificado)? */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "" || h === "0.0.0.0" || h === "::") return true;
  // IPv6 link-local (fe80::/10 → fe8_/fe9_/fea_/feb_).
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local + metadata cloud)
  }
  return false;
}

/**
 * Valida una URL de destino de reenvío de credenciales. Devuelve la URL
 * normalizada (sin `/` final) o null si no es válida/segura.
 */
export function safeForwardUrl(raw: string | null | undefined): string | null {
  const u = parseHttpUrl(raw);
  if (!u) return null;
  if (isBlockedHost(u.hostname)) return null;
  return u.toString().replace(/\/+$/, "");
}

/** `fetch` con timeout (aborta si el destino no responde a tiempo). */
export function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}
