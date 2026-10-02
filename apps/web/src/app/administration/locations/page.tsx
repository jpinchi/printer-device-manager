"use client";

/** Ubicaciones (sección 3): listar, crear, editar y eliminar. */
import { useState } from "react";
import { Topbar } from "@/components/Topbar";
import { Spinner, ErrorState, EmptyState } from "@/components/States";
import { useConfirm } from "@/components/ConfirmProvider";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiLocation } from "@/lib/types";
import { fmtDate } from "@/lib/format";

export default function LocationsPage() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const locations = useAsync(() => api.listLocations(), []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // Edición en línea: id de la ubicación en edición + sus campos.
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.createLocation({ name: name.trim(), description: description.trim() || undefined });
      setName(""); setDescription("");
      setMsg(t("Ubicación creada."));
      locations.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  const list: ApiLocation[] = locations.data?.data ?? [];

  function startEdit(l: ApiLocation) {
    setMsg(null);
    setEditId(l.id);
    setEditName(l.name);
    setEditDescription(l.description ?? "");
  }

  function cancelEdit() {
    setEditId(null);
    setEditName("");
    setEditDescription("");
  }

  async function saveEdit(l: ApiLocation) {
    const nm = editName.trim();
    if (!nm) { setMsg(t("El nombre no puede estar vacío.")); return; }
    setMsg(null);
    try {
      await api.updateLocation(l.id, { name: nm, description: editDescription.trim() });
      setMsg(`${t("Ubicación")} "${nm}" ${t("actualizada.")}`);
      cancelEdit();
      locations.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("No se pudo guardar"));
    }
  }

  async function remove(l: ApiLocation) {
    const ok = await confirm({
      title: t("Eliminar ubicación"),
      message: `${t("¿Eliminar la ubicación")} "${l.name}"? ${t("Las impresoras que la tengan quedarán sin ubicación.")}`,
      confirmLabel: t("Eliminar"),
      danger: true,
    });
    if (!ok) return;
    setMsg(null);
    try {
      await api.deleteLocation(l.id);
      setMsg(`${t("Ubicación")} "${l.name}" ${t("eliminada.")}`);
      locations.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("No se pudo eliminar"));
    }
  }

  return (
    <>
      <Topbar title="Ubicaciones" help="Define oficinas o áreas y asígnalas a las impresoras para saber dónde está cada equipo." />
      <main className="flex-1 space-y-4 p-6">
        <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-4">
          <div className="flex-1">
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Nombre")}</label>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Finanzas, Piso 3…")} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Descripción (opcional)")}</label>
            <input className="input w-full" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button className="btn">{t("Crear ubicación")}</button>
          {msg && <span className="w-full text-xs text-muted">{msg}</span>}
        </form>

        {locations.loading && <Spinner />}
        {locations.error && <ErrorState message={locations.error} />}
        {locations.data && list.length === 0 && (
          <EmptyState title={t("Sin ubicaciones.")} hint={t("Crea una arriba para organizar la flota.")} />
        )}
        {list.length > 0 && (
          <div className="card divide-y divide-border/60">
            {list.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 p-4">
                {editId === l.id ? (
                  <>
                    <div className="flex flex-1 flex-wrap items-end gap-3">
                      <div className="min-w-[160px] flex-1">
                        <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Nombre")}</label>
                        <input
                          className="input w-full"
                          value={editName}
                          autoFocus
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(l); if (e.key === "Escape") cancelEdit(); }}
                        />
                      </div>
                      <div className="min-w-[160px] flex-1">
                        <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Descripción (opcional)")}</label>
                        <input
                          className="input w-full"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(l); if (e.key === "Escape") cancelEdit(); }}
                        />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button onClick={() => saveEdit(l)} className="btn">{t("Guardar")}</button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-slate-400 hover:text-slate-200"
                      >
                        {t("Cancelar")}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="min-w-0">
                      <div className="font-medium">{l.name}</div>
                      {l.description && <div className="text-xs text-muted">{l.description}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-[11px] text-slate-500">{fmtDate(l.createdAt)}</span>
                      <button
                        onClick={() => startEdit(l)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
                        title={t("Editar ubicación")}
                      >
                        {t("Editar")}
                      </button>
                      <button
                        onClick={() => remove(l)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-danger hover:text-danger"
                        title={t("Eliminar ubicación")}
                      >
                        {t("Eliminar")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
