"use client";

/**
 * Pie del menú: versión de la app + acción de actualización, adaptado al contexto.
 *
 * - App de escritorio (Electron, hay `window.pdmDesktop`): muestra la versión
 *   INSTALADA y un botón "Buscar actualizaciones" que dispara electron-updater.
 *   Si el feed anuncia una versión más nueva, lo indica.
 * - Web (navegador/LAN): muestra la última versión publicada y un botón para
 *   DESCARGAR la app de escritorio (el navegador no puede auto-actualizarse).
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface PdmDesktop {
  isDesktop: boolean;
  getVersion: () => Promise<string>;
  checkForUpdates: () => Promise<boolean>;
}

function getBridge(): PdmDesktop | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { pdmDesktop?: PdmDesktop }).pdmDesktop;
}

export function DesktopUpdater() {
  const { t } = useI18n();
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [current, setCurrent] = useState<string | null>(null); // versión instalada (desktop)
  const [latest, setLatest] = useState<string | null>(null); // última publicada (feed)
  const [available, setAvailable] = useState(false); // hay instalador en el servidor
  const [checking, setChecking] = useState(false);
  const [serverVer, setServerVer] = useState<string | null>(null); // versión del servidor que sirve esta web
  const [serverIsHub, setServerIsHub] = useState(false);
  const [serverUpdate, setServerUpdate] = useState(false);

  useEffect(() => {
    const d = getBridge();
    const desktop = !!d?.isDesktop;
    setIsDesktop(desktop);
    if (desktop) d!.getVersion().then(setCurrent).catch(() => {});
    api
      .desktopInfo()
      .then((i) => {
        setLatest(i.version ?? null);
        setAvailable(!!i.available);
      })
      .catch(() => {});
    // Versión del SERVIDOR que sirve esta página (para ver la versión del hub).
    api
      .hubVersion()
      .then((h) => {
        setServerVer(h.current);
        setServerIsHub(h.isHub);
        setServerUpdate(h.updateAvailable);
      })
      .catch(() => {});
  }, []);

  if (isDesktop === null) return null; // primer render: aún no sabemos el contexto

  async function check() {
    const d = getBridge();
    if (!d) return;
    setChecking(true);
    try {
      await d.checkForUpdates();
    } catch {
      /* el diálogo de resultado lo muestra el proceso principal de Electron */
    }
    setTimeout(() => setChecking(false), 3000);
  }

  // En la web mostramos la versión del SERVIDOR que sirve la página (así se ve
  // la versión real del hub de cada sede); en el Desktop, la instalada.
  const shownVersion = isDesktop ? current : (serverVer ?? latest);
  const updateReady = isDesktop && current && latest && current !== latest;

  return (
    <div className="border-t border-border/70 px-5 py-3">
      <div className="text-[11px] text-slate-400">
        Printer Device Manager{" "}
        <span className="font-mono text-slate-300">{shownVersion ? `v${shownVersion}` : "—"}</span>
        {!isDesktop && serverIsHub && (
          <span className="ml-1.5 rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-500">
            {t("Hub")}
          </span>
        )}
      </div>
      {!isDesktop && serverIsHub && serverUpdate && (
        <div className="mt-1 text-[10px] text-warn">
          {t("Hay una versión más nueva")} {available && latest ? `(v${latest})` : ""}
        </div>
      )}

      {isDesktop ? (
        <>
          {updateReady && (
            <div className="mt-1 text-[10px] text-accent">
              {t("Nueva versión disponible:")} v{latest}
            </div>
          )}
          <button
            onClick={check}
            disabled={checking}
            className="mt-2 w-full rounded-md border border-border px-2 py-1.5 text-[11px] text-muted transition hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {checking ? t("Buscando actualizaciones…") : t("Buscar actualizaciones")}
          </button>
        </>
      ) : (
        available && (
          <a
            href="/api/desktop/installer"
            className="mt-2 block w-full rounded-md border border-border px-2 py-1.5 text-center text-[11px] text-muted transition hover:border-accent hover:text-accent"
          >
            {t("Descargar app de escritorio")}
          </a>
        )
      )}
    </div>
  );
}
