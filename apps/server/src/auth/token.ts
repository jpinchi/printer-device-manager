/**
 * Tokens de sesión stateless tipo "JWT-lite" firmados con HMAC-SHA256
 * (`node:crypto`), SIN librerías JWT (sección 23).
 *
 * Estructura: <headerB64url>.<payloadB64url>.<signatureB64url>
 *   header  = { alg: "HS256", typ: "JWT" }
 *   payload = { sub, role, iat, exp }   (exp/iat en segundos epoch)
 *
 * El secreto (SESSION_SECRET) nunca se incluye en el token ni se loguea.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { authConfig } from "./config.js";

export interface TokenPayload {
  /** userId. */
  sub: string;
  /** Rol del usuario (Administrator | Technician | Viewer). */
  role: string;
  /** Emitido en (segundos epoch). */
  iat: number;
  /** Expira en (segundos epoch). */
  exp: number;
}

/** Datos mínimos para emitir un token; iat/exp se calculan al firmar. */
export interface TokenClaims {
  sub: string;
  role: string;
}

const HEADER = { alg: "HS256", typ: "JWT" } as const;

function base64urlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(data: string): string {
  return createHmac("sha256", authConfig.sessionSecret).update(data).digest("base64url");
}

/**
 * Firma un token para el sujeto/rol dados. El TTL viene de
 * `AUTH_TOKEN_TTL_HOURS` (default 8 h). Devuelve la cadena compacta.
 */
export function signToken(
  claims: TokenClaims,
  ttlHours: number = authConfig.tokenTtlHours,
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: claims.sub,
    role: claims.role,
    iat: nowSec,
    exp: nowSec + Math.round(ttlHours * 3600),
  };
  const headerB64 = base64urlEncode(JSON.stringify(HEADER));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signature = sign(`${headerB64}.${payloadB64}`);
  return `${headerB64}.${payloadB64}.${signature}`;
}

/** Resultado de verificar un token. */
export type VerifyResult =
  | { valid: true; payload: TokenPayload }
  | { valid: false; reason: "malformed" | "bad-signature" | "expired" };

/**
 * Verifica firma y expiración de un token. Comparación de firma en tiempo
 * constante. No lanza: devuelve un resultado discriminado.
 */
export function verifyToken(token: string): VerifyResult {
  if (typeof token !== "string") return { valid: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };

  const [headerB64, payloadB64, signatureB64] = parts;
  const expectedSig = sign(`${headerB64}.${payloadB64}`);

  // timingSafeEqual exige misma longitud; si difieren, firma inválida.
  const a = Buffer.from(signatureB64);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad-signature" };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64)) as TokenPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (
    typeof payload?.sub !== "string" ||
    typeof payload?.role !== "string" ||
    typeof payload?.exp !== "number"
  ) {
    return { valid: false, reason: "malformed" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) return { valid: false, reason: "expired" };

  return { valid: true, payload };
}
