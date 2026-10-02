"use client";

/**
 * Página de inicio de sesión (secciones 23-24).
 *
 * Pantalla independiente y a pantalla completa (sin sidebar; ver AppShell):
 * tarjeta "glass" centrada sobre un fondo animado de manchas translúcidas
 * (aurora) y una rejilla sutil. Autentica contra /api/auth/login, guarda el
 * token y redirige al dashboard.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setSession } from "@/lib/auth";
import { Logo } from "@/components/icons";
import { LangToggle } from "@/components/LangToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginPlexus } from "@/components/LoginPlexus";
import { useI18n } from "@/lib/i18n";

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Modo de la tarjeta: login normal, "olvidé mi contraseña", o cambio
  // OBLIGATORIO (tras un reset del admin, con la clave temporal).
  const [mode, setMode] = useState<"login" | "forgot" | "mustChange">("login");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Primer arranque (instalación limpia, sin usuarios): crear el administrador.
  const [setup, setSetup] = useState(false);
  // Descarga de la app de escritorio (si el servidor tiene el instalador).
  const [desktop, setDesktop] = useState<{ available: boolean; size?: number; version?: string | null }>({ available: false });
  // Servidor de cuentas (central/hub) al que valida el login esta máquina.
  const [server, setServer] = useState<{ centralUrl: string; source: "file" | "env" | "none" } | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverInput, setServerInput] = useState("");
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const [savingServer, setSavingServer] = useState(false);
  // Versión / auto-update del hub (solo aparece si este servidor es un hub).
  const [hub, setHub] = useState<{ isHub: boolean; current: string; available: string | null; updateAvailable: boolean; updating: boolean } | null>(null);
  const [hubBusy, setHubBusy] = useState(false);
  const [hubMsg, setHubMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .setupNeeded()
      .then((r) => setSetup(!!r.needed))
      .catch(() => {});
    api
      .desktopInfo()
      .then((d) => setDesktop(d))
      .catch(() => {});
    api
      .getServer()
      .then((s) => {
        setServer(s);
        setServerInput(s.centralUrl);
      })
      .catch(() => {});
    api.hubVersion().then(setHub).catch(() => {});
  }, []);

  async function checkHub() {
    setHubBusy(true);
    setHubMsg(null);
    try {
      const h = await api.hubVersion();
      setHub(h);
      setHubMsg(h.updateAvailable ? null : t("Este servidor ya está en la última versión."));
    } catch {
      setHubMsg(t("No se pudo comprobar la versión."));
    } finally {
      setHubBusy(false);
    }
  }

  async function updateHub() {
    setHubBusy(true);
    setHubMsg(null);
    try {
      const r = await api.hubUpdate();
      if (r.upToDate) setHubMsg(t("Este servidor ya está en la última versión."));
      else setHubMsg(t("Actualizando… el servidor se reiniciará solo en 1–2 minutos. Vuelve a entrar luego."));
    } catch (e) {
      setHubMsg(e instanceof Error ? e.message : t("No se pudo iniciar la actualización."));
    } finally {
      setHubBusy(false);
    }
  }

  async function saveServer(e: React.FormEvent) {
    e.preventDefault();
    setSavingServer(true);
    setServerMsg(null);
    try {
      const s = await api.setServer(serverInput.trim());
      setServer(s);
      setServerInput(s.centralUrl);
      setServerMsg(t("Servidor guardado."));
    } catch (err) {
      setServerMsg(err instanceof Error ? err.message : t("No se pudo guardar."));
    } finally {
      setSavingServer(false);
    }
  }

  function goForgot() {
    setError(null);
    setNotice(null);
    setRecoveryCode("");
    setNewPassword("");
    setNewPassword2("");
    setMode("forgot");
  }

  function backToLogin() {
    setError(null);
    setNotice(null);
    setNewPassword("");
    setNewPassword2("");
    setRecoveryCode("");
    setMode("login");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // --- "Olvidé mi contraseña": valida el código de recuperación ---
      if (mode === "forgot") {
        if (newPassword.length < 8) throw new Error(t("La nueva contraseña debe tener al menos 8 caracteres"));
        if (newPassword !== newPassword2) throw new Error(t("Las contraseñas no coinciden"));
        const { token, user } = await api.forgotPassword({
          username: username.trim(),
          recoveryCode: recoveryCode.trim(),
          newPassword,
        });
        setSession(token, user);
        router.push("/");
        return;
      }

      // --- Cambio OBLIGATORIO tras un reset (usa la clave temporal como actual) ---
      if (mode === "mustChange") {
        if (newPassword.length < 8) throw new Error(t("La nueva contraseña debe tener al menos 8 caracteres"));
        if (newPassword !== newPassword2) throw new Error(t("Las contraseñas no coinciden"));
        const { token, user } = await api.changePassword({
          username: username.trim(),
          currentPassword: password,
          newPassword,
          recoveryCode: recoveryCode.trim() || undefined,
        });
        setSession(token, user);
        router.push("/");
        return;
      }

      // --- Login normal (o alta del primer administrador) ---
      if (setup) {
        await api.register(username.trim(), password);
      }
      const { token, user } = await api.login(username.trim(), password);
      // Si el admin marcó la cuenta para cambio obligatorio, no entra aún:
      // pasa a la pantalla de cambio (la clave temporal queda en `password`).
      if (user.mustChangePassword) {
        setSession(token, user);
        setNotice(t("Tu contraseña fue restablecida. Define una nueva para continuar."));
        setNewPassword("");
        setNewPassword2("");
        setRecoveryCode("");
        setMode("mustChange");
        return;
      }
      setSession(token, user);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : setup ? t("No se pudo crear el administrador") : t("Error de autenticación"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Selector de idioma + tema */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <LangToggle />
        <ThemeToggle variant="icon" />
      </div>
      {/* Fondo animado: halo giratorio + aurora + rejilla + partículas.
          Todo con tokens del tema → se adapta a claro y oscuro. */}
      {/* IMPORTANTE: z-0 (NO -z-10). Con -z-10 y sin contexto de apilamiento en
          un ancestro, esta capa quedaba DETRÁS del fondo opaco del <body> y no
          se veía (plana). Solo asomaba durante la animación de entrada
          (.page-enter aplica transform → crea contexto de apilamiento), de ahí
          el "por un segundo se ve bien y luego se queda plano". Con z-0 el fondo
          se ve SIEMPRE; la tarjeta va encima por orden del DOM + su z-10. */}
      <div aria-hidden className="login-canvas pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {/* Halo cónico que gira detrás de la tarjeta (con latido suave).
            IMPORTANTE: cada var() lleva un VALOR POR DEFECTO (fallback). Si la
            hoja de estilos que llega al navegador no define --lg-* (p. ej. una
            CSS en caché de otra versión), sin fallback el `background` entero
            se invalida y el fondo se ve como un color sólido. Con fallback el
            efecto se dibuja siempre. */}
        <div
          className="absolute left-1/2 top-1/2 h-[130vmax] w-[130vmax]"
          style={{
            transform: "translate(-50%, -50%)",
            filter: "blur(var(--lg-blur-halo, 80px))",
            background:
              "conic-gradient(from 0deg, rgb(var(--color-accent) / var(--lg-halo-a, 0.48)), transparent 20%, rgb(var(--color-accent2) / var(--lg-halo-b, 0.44)) 50%, transparent 72%, rgb(var(--color-accent) / var(--lg-halo-a, 0.48)))",
            animation: "halo-spin 26s linear infinite, soft-pulse 7s ease-in-out infinite",
          }}
        />
        {/* Aurora: cuatro manchas que derivan con presencia; también en el
            CENTRO (no solo esquinas) para que el fondo no se vea plano. */}
        <div
          className="aurora-blob absolute -left-40 -top-40 h-[40rem] w-[40rem] rounded-full"
          style={{ filter: "blur(var(--lg-blur-aurora, 100px))", background: "radial-gradient(circle, rgb(var(--color-accent) / var(--lg-aurora-strong, 0.62)), transparent 70%)", animationDuration: "15s" }}
        />
        <div
          className="aurora-blob absolute -bottom-48 -right-32 h-[44rem] w-[44rem] rounded-full"
          style={{ filter: "blur(var(--lg-blur-aurora, 100px))", background: "radial-gradient(circle, rgb(var(--color-accent2) / var(--lg-aurora-strong, 0.62)), transparent 70%)", animationDuration: "18s", animationDelay: "-5s" }}
        />
        <div
          className="aurora-blob absolute left-[8%] top-[62%] h-[26rem] w-[26rem] rounded-full"
          style={{ filter: "blur(var(--lg-blur-aurora, 100px))", background: "radial-gradient(circle, rgb(var(--color-accent2) / var(--lg-aurora-mid, 0.42)), transparent 70%)", animationDuration: "16s", animationDelay: "-11s" }}
        />
        <div
          className="aurora-blob absolute left-1/2 top-1/3 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full"
          style={{ filter: "blur(var(--lg-blur-aurora, 100px))", background: "radial-gradient(circle, rgb(var(--color-accent) / var(--lg-aurora-mid, 0.42)), transparent 70%)", animationDuration: "13s", animationDelay: "-9s" }}
        />
        {/* Resplandor central (el que da el "baño" de azul del centro hacia
            arriba). Grande, brillante y con latido suave. */}
        <div
          className="absolute left-1/2 top-[38%] h-[58rem] w-[58rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            filter: "blur(var(--lg-blur-glow, 55px))",
            background: "radial-gradient(circle, rgb(var(--color-accent) / var(--lg-glow-a, 0.6)) 0%, rgb(var(--color-accent2) / var(--lg-glow-b, 0.38)) 38%, transparent 68%)",
            animation: "soft-pulse 9s ease-in-out infinite",
          }}
        />
        {/* Red de partículas (plexus): nodos que flotan y se conectan con
            líneas según cercanía; reaccionan al cursor. Sustituye a la rejilla
            cuadriculada por algo más moderno y con movimiento. */}
        <LoginPlexus />
        {/* Viñeta sutil para enfocar el centro (suave: no aplastar los bordes
            ni la red de partículas). */}
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at center, transparent 60%, rgb(var(--color-bg) / var(--lg-vignette, 0.38)))" }}
        />
      </div>

      {/* Tarjeta glass */}
      <form
        onSubmit={submit}
        className="animate-fade-in-up relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-border/70 bg-card/60 p-8 shadow-glow backdrop-blur-2xl sm:p-10"
      >
        {/* Filo superior luminoso */}
        <div aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />

        {/* Marca */}
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <div aria-hidden className="absolute inset-0 -z-10 rounded-2xl bg-accent/30 blur-2xl" />
            <Logo className="h-14 w-14 drop-shadow-[0_8px_24px_rgba(56,189,248,0.45)]" />
          </div>
          <h1 className="text-gradient mt-4 text-2xl font-semibold tracking-tight">
            Printer Device Manager
          </h1>
          <p className="mt-1 text-sm text-muted">
            {mode === "forgot"
              ? t("Recupera tu acceso con tu código de recuperación")
              : mode === "mustChange"
                ? t("Define una nueva contraseña para continuar")
                : setup
                  ? t("Primer arranque: crea la cuenta de administrador")
                  : t("Inicia sesión para continuar")}
          </p>
        </div>

        {/* Campos */}
        <div className="mt-8 space-y-4">
          {/* Usuario: editable salvo en el cambio obligatorio (ya se conoce). */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted" htmlFor="u">
              {t("Usuario")}
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                <UserIcon />
              </span>
              <input
                id="u"
                className="input w-full pl-10"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus={mode !== "mustChange"}
                autoComplete="username"
                placeholder="admin"
                readOnly={mode === "mustChange"}
              />
            </div>
          </div>

          {/* Contraseña actual: solo en login/setup (en cambio obligatorio se
              usa la temporal ya introducida; en olvido no aplica). */}
          {(mode === "login") && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted" htmlFor="p">
                  {t("Contraseña")}
                </label>
                {!setup && (
                  <button
                    type="button"
                    onClick={goForgot}
                    className="text-[11px] text-muted transition hover:text-accent"
                  >
                    {t("¿Olvidaste tu contraseña?")}
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                  <LockIcon />
                </span>
                <input
                  id="p"
                  type="password"
                  className="input w-full pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={setup ? "new-password" : "current-password"}
                  placeholder="••••••••"
                />
              </div>
            </div>
          )}

          {/* Código de recuperación: obligatorio en "olvido", opcional en cambio. */}
          {(mode === "forgot" || mode === "mustChange") && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted" htmlFor="rc">
                {mode === "forgot" ? t("Código de recuperación") : t("Código de recuperación (opcional)")}
              </label>
              <input
                id="rc"
                type="text"
                className="input w-full"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={mode === "forgot" ? t("El código que definiste o te dio el admin") : t("Defínelo para futuras recuperaciones")}
              />
            </div>
          )}

          {/* Contraseña nueva + confirmación (olvido y cambio obligatorio). */}
          {(mode === "forgot" || mode === "mustChange") && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted" htmlFor="np">
                  {t("Nueva contraseña (mín. 8)")}
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                    <LockIcon />
                  </span>
                  <input
                    id="np"
                    type="password"
                    className="input w-full pl-10"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted" htmlFor="np2">
                  {t("Repite la nueva contraseña")}
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                    <LockIcon />
                  </span>
                  <input
                    id="np2"
                    type="password"
                    className="input w-full pl-10"
                    value={newPassword2}
                    onChange={(e) => setNewPassword2(e.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {notice && (
          <div className="animate-fade-in mt-4 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
            {notice}
          </div>
        )}

        {error && (
          <div className="animate-fade-in mt-4 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <button className="btn mt-6 w-full justify-center" disabled={busy}>
          {busy ? (
            <>
              <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-6.2-8.6" strokeLinecap="round" />
              </svg>
              {mode === "forgot" ? t("Restableciendo…") : mode === "mustChange" ? t("Guardando…") : setup ? t("Creando…") : t("Entrando…")}
            </>
          ) : mode === "forgot" ? (
            t("Restablecer contraseña")
          ) : mode === "mustChange" ? (
            t("Guardar y entrar")
          ) : setup ? (
            t("Crear administrador")
          ) : (
            t("Iniciar sesión")
          )}
        </button>

        {(mode === "forgot" || mode === "mustChange") && (
          <button
            type="button"
            onClick={backToLogin}
            className="mt-3 w-full text-center text-[11px] text-muted transition hover:text-accent"
          >
            {t("Volver a iniciar sesión")}
          </button>
        )}
      </form>

      {/* Descarga de la app de escritorio (si el servidor la ofrece) */}
      {desktop.available && (
        <div className="animate-fade-in relative z-10 mt-5 flex w-full max-w-md flex-col items-center gap-1.5 text-center">
          <a
            href="/api/desktop/installer"
            download
            className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card/50 px-4 py-2.5 text-sm text-slate-200 shadow-soft backdrop-blur-xl transition hover:border-accent/60 hover:text-accent"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            {t("Descargar app de escritorio (Windows)")}
          </a>
          <span className="text-[11px] text-muted">
            {desktop.version ? `v${desktop.version} · ` : ""}
            {typeof desktop.size === "number" ? `${Math.round(desktop.size / 1048576)} MB · ` : ""}
            {t("tras descargar, ejecútalo para instalar")}
          </span>
        </div>
      )}

      {/* Guía en PDF: disponible SIEMPRE, incluso antes de iniciar sesión, para
          tener las instrucciones listas desde el principio. */}
      <div className="animate-fade-in relative z-10 mt-3 flex w-full max-w-md justify-center text-center">
        <a
          href="/guia-instalacion-pdm.pdf"
          download
          className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card/40 px-4 py-2 text-xs text-muted shadow-soft backdrop-blur-xl transition hover:border-accent/60 hover:text-accent"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3v4a1 1 0 0 0 1 1h4" />
            <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M9 13h6" />
            <path d="M9 17h4" />
          </svg>
          {t("Descargar guía de instrucciones (PDF)")}
        </a>
      </div>

      {/* Ajuste "Servidor": a qué central/hub valida el login esta máquina.
          Por defecto la central; cada sede puede apuntar a su propio hub. */}
      {server && (
        <div className="animate-fade-in relative z-10 mt-4 w-full max-w-md text-center">
          {!serverOpen ? (
            <button
              type="button"
              onClick={() => setServerOpen(true)}
              className="text-[11px] text-muted transition hover:text-accent"
            >
              {t("Servidor")}: <span className="font-mono">{server.centralUrl || t("esta máquina")}</span> · {t("Cambiar")}
            </button>
          ) : (
            <form onSubmit={saveServer} className="rounded-xl border border-border/70 bg-card/50 p-3 text-left backdrop-blur-xl">
              <label className="mb-1 block text-[11px] font-medium text-muted">
                {t("Servidor de cuentas (central o hub de tu sede)")}
              </label>
              <div className="flex gap-2">
                <input
                  className="input w-full text-sm"
                  value={serverInput}
                  onChange={(e) => setServerInput(e.target.value)}
                  placeholder="http://192.0.2.24:2626"
                  spellCheck={false}
                />
                <button className="btn shrink-0" disabled={savingServer}>
                  {savingServer ? t("Guardando…") : t("Guardar")}
                </button>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
                {t("Tu usuario y clave se validan contra este servidor. Déjalo en la central, o apunta al hub de tu sede. Solo se puede cambiar desde esta máquina.")}
              </p>
              {serverMsg && <p className="mt-1 text-[11px] text-accent">{serverMsg}</p>}
            </form>
          )}
        </div>
      )}

      {/* Versión / actualización del hub de la sede (solo en un hub) */}
      {hub?.isHub && (
        <div className="animate-fade-in relative z-10 mt-4 w-full max-w-md rounded-xl border border-border/70 bg-card/50 p-3 text-center backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-muted">
            <span>{t("Servidor de la sede")}</span>
            <span className="font-mono text-slate-300">v{hub.current}</span>
            {hub.updateAvailable ? (
              <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-warn">
                {t("versión nueva")}: v{hub.available}
              </span>
            ) : (
              <span className="rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-ok">{t("al día")}</span>
            )}
          </div>
          <div className="mt-2 flex justify-center gap-2">
            {hub.updateAvailable ? (
              <button
                type="button"
                onClick={updateHub}
                disabled={hubBusy}
                className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                {hubBusy ? t("Actualizando…") : t("Actualizar ahora")}
              </button>
            ) : (
              <button
                type="button"
                onClick={checkHub}
                disabled={hubBusy}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {hubBusy ? t("Comprobando…") : t("Comprobar versión")}
              </button>
            )}
          </div>
          {hubMsg && <p className="mt-2 text-[11px] text-muted">{hubMsg}</p>}
        </div>
      )}
    </main>
  );
}
