/**
 * Gestión del token de sesión en el cliente.
 *
 * Guarda el JWT-lite emitido por `/api/auth/login` en localStorage y lo adjunta
 * a las llamadas de la API. Al recibir 401, el cliente limpia el token y
 * redirige a /login (ver lib/api.ts).
 */
const TOKEN_KEY = "pdm.token";
const USER_KEY = "pdm.user";

export interface SessionUser {
  id: string;
  username: string;
  role: string;
  /** true = debe cambiar la contraseña antes de usar la app (tras un reset). */
  mustChangePassword?: boolean;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, user: SessionUser): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}
