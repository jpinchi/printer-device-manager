"use client";

/**
 * Menú de perfil de la barra superior: un botón con avatar ("Perfil") que abre
 * un mini-menú con el usuario y su rol, y permite cambiar la contraseña (y de
 * paso definir/actualizar el código de recuperación) sin depender del admin.
 *
 * Reusa POST /api/auth/change-password (la clave actual es la prueba de
 * identidad). Al cambiarla, refresca la sesión con el token nuevo.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { getUser, setSession, type SessionUser } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

function AvatarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function ProfileMenu({ user }: { user: SessionUser }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Cerrar el mini-menú al hacer clic fuera o pulsar Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-slate-300 transition hover:border-accent hover:text-accent"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/15 text-accent">
          <AvatarIcon className="h-3.5 w-3.5" />
        </span>
        {t("Perfil")}
        <svg viewBox="0 0 24 24" className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-card shadow-glow"
        >
          {/* Cabecera: avatar + usuario + rol */}
          <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent/15 text-accent">
              <AvatarIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{user.username}</p>
              <p className="text-[11px] text-muted">{user.role}</p>
            </div>
          </div>
          {/* Acciones */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setModal(true);
            }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-accent/10 hover:text-accent"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            {t("Cambiar contraseña")}
          </button>
        </div>
      )}

      {modal && <ChangePasswordModal username={user.username} onClose={() => setModal(false)} />}
    </div>
  );
}

/** Modal de cambio de contraseña propio (con código de recuperación opcional). */
function ChangePasswordModal({ username, onClose }: { username: string; onClose: () => void }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError(t("La nueva contraseña debe tener al menos 8 caracteres"));
    if (next !== next2) return setError(t("Las contraseñas no coinciden"));
    setBusy(true);
    try {
      const { token, user } = await api.changePassword({
        username,
        currentPassword: current,
        newPassword: next,
        recoveryCode: recovery.trim() || undefined,
      });
      // Refresca la sesión con el token nuevo (conserva el usuario actualizado).
      setSession(token, { ...(getUser() ?? user), ...user });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo cambiar la contraseña"));
    } finally {
      setBusy(false);
    }
  }

  // Portal a <body>: el header tiene backdrop-filter, que crea un bloque
  // contenedor para los `fixed`; sin el portal el modal se centraría respecto
  // al header (~64px de alto) en vez del viewport.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-md overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <h3 className="text-base font-semibold text-slate-100">{t("Contraseña actualizada")}</h3>
            <p className="mt-2 text-sm text-muted">
              {t("Tu contraseña se cambió correctamente.")}
              {recovery.trim() ? " " + t("Tu código de recuperación quedó guardado.") : ""}
            </p>
            <div className="mt-5 flex justify-end">
              <button className="btn" onClick={onClose}>{t("Entendido")}</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <h3 className="text-base font-semibold text-slate-100">{t("Cambiar contraseña")}</h3>
            <p className="mt-1 text-xs text-muted">{t("Usuario")}: <span className="text-slate-200">{username}</span></p>

            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted">{t("Contraseña actual")}</label>
                <input type="password" className="input w-full" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted">{t("Nueva contraseña (mín. 8)")}</label>
                <input type="password" className="input w-full" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted">{t("Repite la nueva contraseña")}</label>
                <input type="password" className="input w-full" value={next2} onChange={(e) => setNext2(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="space-y-1.5 border-t border-border/60 pt-3">
                <label className="text-xs font-medium text-muted">{t("Código de recuperación (opcional)")}</label>
                <input type="text" className="input w-full" value={recovery} onChange={(e) => setRecovery(e.target.value)} autoComplete="off" spellCheck={false} placeholder={t("Para poder recuperar tu clave si la olvidas")} />
                <p className="text-[10px] leading-relaxed text-muted">{t("Si lo defines, podrás restablecer tu contraseña desde la pantalla de inicio usando este código.")}</p>
              </div>
            </div>

            {error && (
              <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm text-muted transition hover:border-accent hover:text-accent" onClick={onClose}>
                {t("Cancelar")}
              </button>
              <button className="btn" disabled={busy}>
                {busy ? t("Guardando…") : t("Guardar")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
