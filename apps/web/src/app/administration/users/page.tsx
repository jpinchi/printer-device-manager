"use client";

/**
 * Administración de usuarios (sección 24). Solo Administrator.
 * Lista, crea, cambia rol/estado y elimina usuarios contra /api/users.
 */
import { useState } from "react";
import { Topbar } from "@/components/Topbar";
import { Select } from "@/components/Select";
import { Spinner, ErrorState } from "@/components/States";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/components/ConfirmProvider";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getUser } from "@/lib/auth";
import type { ApiUser } from "@/lib/types";
import { fmtDate } from "@/lib/format";

const ROLES = ["Viewer", "Technician", "Administrator"];

export default function UsersPage() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const users = useAsync<ApiUser[]>(() => api.listUsers(), []);
  const me = getUser();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("Viewer");
  const [msg, setMsg] = useState<string | null>(null);
  // Resultado de un reset (contraseña temporal a comunicar una sola vez).
  const [resetInfo, setResetInfo] = useState<{ username: string; tempPassword?: string } | null>(null);
  // Editor del código de recuperación (usuario objetivo + valor).
  const [codeUser, setCodeUser] = useState<ApiUser | null>(null);
  const [codeValue, setCodeValue] = useState("");
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.createUser({ username: username.trim(), password, role });
      setUsername("");
      setPassword("");
      setRole("Viewer");
      setMsg(t("Usuario creado."));
      users.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  async function changeRole(u: ApiUser, newRole: string) {
    setMsg(null);
    try {
      await api.updateUser(u.id, { role: newRole });
      users.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  async function toggleActive(u: ApiUser) {
    setMsg(null);
    try {
      await api.updateUser(u.id, { active: !u.active });
      users.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  async function remove(u: ApiUser) {
    setMsg(null);
    try {
      await api.deleteUser(u.id);
      users.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  async function resetPassword(u: ApiUser) {
    setMsg(null);
    const ok = await confirm({
      title: t("Restablecer contraseña"),
      message: t("¿Restablecer la contraseña de este usuario? Se le pedirá cambiarla al entrar."),
      confirmLabel: t("Restablecer"),
    });
    if (!ok) return;
    setBusyAction(true);
    try {
      const r = await api.resetUserPassword(u.id); // sin clave → genera una temporal
      setResetInfo({ username: u.username, tempPassword: r.tempPassword });
      users.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setBusyAction(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!codeUser) return;
    setCodeMsg(null);
    setBusyAction(true);
    try {
      await api.setUserRecoveryCode(codeUser.id, codeValue.trim());
      setCodeUser(null);
      setCodeValue("");
      setMsg(t("Código de recuperación guardado."));
      users.reload();
    } catch (err) {
      setCodeMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setBusyAction(false);
    }
  }

  const forbidden = users.error?.toLowerCase().includes("permiso");

  return (
    <>
      <Topbar title="Usuarios" help="Cuentas y roles: Administrador, Técnico y Visor, cada uno con distintos permisos." />
      <main className="flex-1 space-y-6 p-6">
        {/* Alta de usuario */}
        <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-4">
          <div className="flex-1">
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Usuario")}</label>
            <input className="input w-full" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Contraseña (mín. 6)")}</label>
            <input type="password" className="input w-full" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Rol")}</label>
            <Select
              className="min-w-[160px]"
              value={role}
              onChange={setRole}
              options={ROLES.map((r) => ({ value: r, label: r }))}
            />
          </div>
          <button className="btn">{t("Crear usuario")}</button>
          {msg && <span className="w-full text-xs text-muted">{msg}</span>}
        </form>

        {users.loading && <Spinner label={t("Cargando usuarios…")} />}
        {users.error && forbidden && (
          <div className="card p-8 text-center text-sm text-muted">
            {t("Necesitas rol")} <span className="text-accent">Administrator</span> {t("para gestionar usuarios.")}
          </div>
        )}
        {users.error && !forbidden && <ErrorState message={users.error} />}

        {users.data && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 text-left">{t("Usuario")}</th>
                  <th className="px-4 py-3 text-left">{t("Rol")}</th>
                  <th className="px-4 py-3 text-left">{t("Estado")}</th>
                  <th className="px-4 py-3 text-left">{t("Creado")}</th>
                  <th className="px-4 py-3 text-right">{t("Acciones")}</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => {
                  const isSelf = u.id === me?.id;
                  return (
                    <tr key={u.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3 font-medium">
                        {u.username}
                        {isSelf && <span className="ml-2 text-[10px] text-accent">{t("(tú)")}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          size="sm"
                          className="min-w-[150px]"
                          value={u.role}
                          onChange={(v) => changeRole(u, v)}
                          disabled={isSelf}
                          options={ROLES.map((r) => ({ value: r, label: r }))}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${u.active ? "text-ok" : "text-danger"}`}>
                          <span className={`h-2 w-2 rounded-full ${u.active ? "bg-ok" : "bg-danger"}`} />
                          {u.active ? t("Activo") : t("Inactivo")}
                        </span>
                        {u.mustChangePassword && (
                          <span className="ml-2 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] text-warn" title={t("Debe cambiar la contraseña en el próximo login")}>
                            {t("cambio pendiente")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">{fmtDate(u.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent disabled:opacity-40"
                            onClick={() => resetPassword(u)}
                            disabled={busyAction}
                            title={t("Restablecer contraseña (entrega una temporal)")}
                          >
                            {t("Restablecer")}
                          </button>
                          <button
                            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent disabled:opacity-40"
                            onClick={() => { setCodeUser(u); setCodeValue(""); setCodeMsg(null); }}
                            disabled={busyAction}
                            title={t("Definir el código de recuperación de este usuario")}
                          >
                            {u.hasRecoveryCode ? t("Código ✓") : t("Código")}
                          </button>
                          <button
                            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent disabled:opacity-40"
                            onClick={() => toggleActive(u)}
                            disabled={isSelf}
                          >
                            {u.active ? t("Desactivar") : t("Activar")}
                          </button>
                          <button
                            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-danger hover:text-danger disabled:opacity-40"
                            onClick={() => remove(u)}
                            disabled={isSelf}
                          >
                            {t("Eliminar")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Modal: resultado del reset (contraseña temporal, se muestra una vez). */}
      {resetInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setResetInfo(null)}>
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">{t("Contraseña restablecida")}</h3>
            <p className="mt-1 text-sm text-muted">
              {t("Usuario")}: <span className="font-medium text-slate-100">{resetInfo.username}</span>
            </p>
            {resetInfo.tempPassword ? (
              <>
                <p className="mt-3 text-xs text-muted">{t("Contraseña temporal (cópiala y entrégala al usuario; no se volverá a mostrar):")}</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 select-all rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm">{resetInfo.tempPassword}</code>
                  <button
                    className="btn shrink-0"
                    onClick={() => navigator.clipboard?.writeText(resetInfo.tempPassword ?? "").catch(() => {})}
                  >
                    {t("Copiar")}
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">{t("Se aplicó la contraseña indicada.")}</p>
            )}
            <p className="mt-3 text-xs text-muted">{t("El usuario deberá cambiarla en su próximo inicio de sesión.")}</p>
            <div className="mt-5 flex justify-end">
              <button className="btn" onClick={() => setResetInfo(null)}>{t("Entendido")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: definir el código de recuperación de un usuario. */}
      {codeUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCodeUser(null)}>
          <form className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()} onSubmit={submitCode}>
            <h3 className="text-base font-semibold">{t("Código de recuperación")}</h3>
            <p className="mt-1 text-sm text-muted">
              {t("Usuario")}: <span className="font-medium text-slate-100">{codeUser.username}</span>
            </p>
            <p className="mt-3 text-xs text-muted">
              {t("Con este código el usuario podrá restablecer su contraseña desde la pantalla de inicio si la olvida. Elige algo que recuerde (mín. 8 caracteres).")}
            </p>
            <input
              className="input mt-2 w-full"
              value={codeValue}
              onChange={(e) => setCodeValue(e.target.value)}
              placeholder={t("Código de recuperación")}
              autoFocus
              spellCheck={false}
            />
            {codeMsg && <p className="mt-2 text-xs text-danger">{codeMsg}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent" onClick={() => setCodeUser(null)}>
                {t("Cancelar")}
              </button>
              <button className="btn" disabled={busyAction || codeValue.trim().length < 8}>
                {t("Guardar código")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
