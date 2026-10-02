"use client";

/** Unidades de trabajo: listar, crear, editar y eliminar (espejo de Ubicaciones). */
import { useState } from "react";
import { Topbar } from "@/components/Topbar";
import { Spinner, ErrorState, EmptyState } from "@/components/States";
import { useConfirm } from "@/components/ConfirmProvider";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiWorkUnit } from "@/lib/types";
import { fmtDate } from "@/lib/format";

export default function WorkUnitsPage() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const workUnits = useAsync(() => api.listWorkUnits(), []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // Edición en línea: id de la unidad en edición + sus campos.
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.createWorkUnit({ name: name.trim(), description: description.trim() || undefined });
      setName(""); setDescription("");
      setMsg(t("Unidad de trabajo creada."));
      workUnits.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  const list: ApiWorkUnit[] = workUnits.data?.data ?? [];

  function startEdit(w: ApiWorkUnit) {
    setMsg(null);
    setEditId(w.id);
    setEditName(w.name);
    setEditDescription(w.description ?? "");
  }

  function cancelEdit() {
    setEditId(null);
    setEditName("");
    setEditDescription("");
  }

  async function saveEdit(w: ApiWorkUnit) {
    const nm = editName.trim();
    if (!nm) { setMsg(t("El nombre no puede estar vacío.")); return; }
    setMsg(null);
    try {
      await api.updateWorkUnit(w.id, { name: nm, description: editDescription.trim() });
      setMsg(`${t("Unidad de trabajo")} "${nm}" ${t("actualizada.")}`);
      cancelEdit();
      workUnits.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("No se pudo guardar"));
    }
  }

  async function remove(w: ApiWorkUnit) {
    const ok = await confirm({
      title: t("Eliminar unidad de trabajo"),
      message: `${t("¿Eliminar la unidad de trabajo")} "${w.name}"? ${t("Las impresoras que la tengan quedarán sin unidad de trabajo.")}`,
      confirmLabel: t("Eliminar"),
      danger: true,
    });
    if (!ok) return;
    setMsg(null);
    try {
      await api.deleteWorkUnit(w.id);
      setMsg(`${t("Unidad de trabajo")} "${w.name}" ${t("eliminada.")}`);
      workUnits.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("No se pudo eliminar"));
    }
  }

  return (
    <>
      <Topbar title="Unidades de trabajo" help="Define unidades de trabajo y asígnalas a las impresoras para clasificar la flota (además de la ubicación)." />
      <main className="flex-1 space-y-4 p-6">
        <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-4">
          <div className="flex-1">
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Nombre")}</label>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Patrullas, Investigaciones…")} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Descripción (opcional)")}</label>
            <input className="input w-full" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button className="btn">{t("Crear unidad de trabajo")}</button>
          {msg && <span className="w-full text-xs text-muted">{msg}</span>}
        </form>

        {workUnits.loading && <Spinner />}
        {workUnits.error && <ErrorState message={workUnits.error} />}
        {workUnits.data && list.length === 0 && (
          <EmptyState title={t("Sin unidades de trabajo.")} hint={t("Crea una arriba para organizar la flota.")} />
        )}
        {list.length > 0 && (
          <div className="card divide-y divide-border/60">
            {list.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 p-4">
                {editId === w.id ? (
                  <>
                    <div className="flex flex-1 flex-wrap items-end gap-3">
                      <div className="min-w-[160px] flex-1">
                        <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Nombre")}</label>
                        <input
                          className="input w-full"
                          value={editName}
                          autoFocus
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(w); if (e.key === "Escape") cancelEdit(); }}
                        />
                      </div>
                      <div className="min-w-[160px] flex-1">
                        <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Descripción (opcional)")}</label>
                        <input
                          className="input w-full"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(w); if (e.key === "Escape") cancelEdit(); }}
                        />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button onClick={() => saveEdit(w)} className="btn">{t("Guardar")}</button>
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
                      <div className="font-medium">{w.name}</div>
                      {w.description && <div className="text-xs text-muted">{w.description}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-[11px] text-slate-500">{fmtDate(w.createdAt)}</span>
                      <button
                        onClick={() => startEdit(w)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
                        title={t("Editar unidad de trabajo")}
                      >
                        {t("Editar")}
                      </button>
                      <button
                        onClick={() => remove(w)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-danger hover:text-danger"
                        title={t("Eliminar unidad de trabajo")}
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
