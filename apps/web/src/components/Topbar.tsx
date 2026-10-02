"use client";

/** Barra superior: título de página + usuario + estado de conexión / modo mock. */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getUser, clearSession, type SessionUser } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LangToggle } from "@/components/LangToggle";
import { HelpCenter } from "@/components/HelpCenter";
import { HelpTip } from "@/components/HelpTip";
import { ProfileMenu } from "@/components/ProfileMenu";
import { useI18n } from "@/lib/i18n";

export function Topbar({
  title,
  help,
  actions,
}: {
  title: string;
  help?: string;
  /** Controles opcionales que se muestran junto al título (p. ej. un botón de acción). */
  actions?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [mock, setMock] = useState<boolean | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setUser(getUser());
    let alive = true;
    api
      .health()
      .then((h) => {
        if (!alive) return;
        setMock(h.mock);
        setOnline(true);
      })
      .catch(() => alive && setOnline(false));
    return () => {
      alive = false;
    };
  }, []);

  function logout() {
    clearSession();
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/70 bg-bg/85 px-6 py-4 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {t(title)}
          {help && <HelpTip title={title} body={help} />}
        </h1>
        {actions}
      </div>
      <div className="flex items-center gap-2">
        <HelpCenter />
        <LangToggle />
        <ThemeToggle variant="icon" />
        {mock && (
          <span className="rounded-full bg-orange-900/60 px-2.5 py-1 text-[11px] font-medium text-orange-300">
            {t("MODO MOCK")}
          </span>
        )}
        {online === false && (
          <span className="rounded-full bg-red-900/60 px-2.5 py-1 text-[11px] font-medium text-red-300">
            {t("Servidor sin conexión")}
          </span>
        )}
        {online && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-ok animate-pulse-ring" />
            {t("Servidor conectado")}
          </span>
        )}
        {user && (
          <span className="ml-2 inline-flex items-center gap-2 border-l border-border pl-3 text-xs">
            <ProfileMenu user={user} />
            <button
              onClick={logout}
              className="rounded-md border border-border px-2 py-1 text-muted transition hover:border-accent hover:text-accent"
            >
              {t("Salir")}
            </button>
          </span>
        )}
      </div>
    </header>
  );
}
