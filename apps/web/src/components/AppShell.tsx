"use client";

/**
 * Envoltorio de la aplicación: decide el "chrome" según la ruta.
 *
 * En rutas normales monta la navegación lateral (Sidebar) y el notificador de
 * alertas. En /login se renderiza SOLO el contenido (sin sidebar ni chrome),
 * para que la pantalla de inicio de sesión ocupe todo el viewport.
 */
import { Suspense, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { AlertNotifier } from "./AlertNotifier";
import { ConfirmProvider } from "./ConfirmProvider";
import { api } from "@/lib/api";
import { applyTonerThreshold } from "@/lib/format";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = (pathname ?? "").replace(/\/+$/, "") === "/login";

  // Carga los ajustes una vez y aplica el umbral de tóner configurado.
  useEffect(() => {
    if (bare) return;
    api.getSettings().then((s) => applyTonerThreshold(s.tonerLowPercent)).catch(() => {});
  }, [bare]);

  if (bare) return <ConfirmProvider>{children}</ConfirmProvider>;

  return (
    <ConfirmProvider>
      <div className="flex h-screen overflow-hidden">
        <Suspense
          fallback={<aside className="hidden w-64 shrink-0 border-r border-border bg-panel md:block" />}
        >
          <Sidebar />
        </Suspense>
        {/* Columna de contenido con su PROPIO scroll: el sidebar queda fijo. */}
        <div id="app-scroll" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </div>
      <AlertNotifier />
    </ConfirmProvider>
  );
}
