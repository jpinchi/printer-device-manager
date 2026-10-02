/**
 * Gestión del tema claro/oscuro. El tema se guarda en localStorage y se aplica
 * como atributo `data-theme` en <html> (los tokens CSS de globals.css cambian
 * según ese atributo). Por defecto: oscuro.
 */
export type Theme = "dark" | "light";

const KEY = "pdm.theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    return window.localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* almacenamiento no disponible (modo privado): igual aplicamos en memoria */
  }
  applyTheme(theme);
}
