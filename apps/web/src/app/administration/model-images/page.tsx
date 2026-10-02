"use client";

/**
 * Fotos por modelo: gestión en bloque. Lista los modelos de la flota (y los que
 * ya tengan foto) con su imagen actual (o la ilustración de respaldo) y permite
 * subir / cambiar / eliminar la foto de cada modelo. Solo Administrator edita.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { Spinner, ErrorState, EmptyState } from "@/components/States";
import { PrinterIllustration } from "@/components/PrinterIllustration";
import { CentralPhotoPicker } from "@/components/CentralPhotoPicker";
import { useConfirm } from "@/components/ConfirmProvider";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getUser } from "@/lib/auth";
import type { ApiPrinter, ApiModelImage } from "@/lib/types";

const keyOf = (manufacturer: string, model: string) => `${manufacturer}|${model}`.trim().toLowerCase();

function ModelCard({
  manufacturer,
  model,
  count,
  hasPhoto,
  isAdmin,
  libraryAvailable,
  onChanged,
}: {
  manufacturer: string;
  model: string;
  count: number;
  hasPhoto: boolean;
  isAdmin: boolean;
  libraryAvailable: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [present, setPresent] = useState(hasPhoto);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setPresent(hasPhoto), [hasPhoto]);

  const mfp = /\b(IM|MP|MFP|MFC|IMAGERUNNER)\b/i.test(model);
  const url = `/api/model-images/lookup?manufacturer=${encodeURIComponent(manufacturer)}&model=${encodeURIComponent(model)}&v=${version}`;

  async function upload(f: File) {
    setBusy(true);
    setErr(null);
    try {
      await api.uploadModelImage(manufacturer, model, f);
      setPresent(true);
      setFailed(false);
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("No se pudo subir"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t("Eliminar foto"),
      message: `${t("¿Eliminar la foto del modelo")} "${model}"?`,
      confirmLabel: t("Eliminar"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteModelImage(keyOf(manufacturer, model));
      setPresent(false);
      onChanged();
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col items-center gap-3 p-4">
      <div className="flex h-28 w-28 items-center justify-center">
        {present && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={model} onError={() => setFailed(true)} className="h-28 w-28 rounded-xl border border-border bg-card object-contain p-1" />
        ) : (
          <PrinterIllustration mfp={mfp} className="h-28 w-28" />
        )}
      </div>
      <div className="text-center">
        <div className="text-sm font-medium text-slate-100">{model}</div>
        <div className="text-[11px] text-muted">
          {manufacturer}
          {count > 0 ? ` · ${count} ${count > 1 ? t("equipos") : t("equipo")}` : ""}
          {present ? "" : ` · ${t("sin foto")}`}
        </div>
      </div>
      {/* Tres acciones fijas: Cambiar (elegir de la biblioteca), Subir (archivo
          manual) y Eliminar (deja la ilustración por defecto). */}
      {isAdmin && (
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setPicker(true)}
            disabled={busy || !libraryAvailable}
            title={libraryAvailable ? t("Elegir la foto de este modelo de la biblioteca") : t("No hay fotos en la biblioteca todavía")}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {t("Cambiar")}
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            title={t("Subir una foto desde este equipo")}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {busy ? t("Subiendo…") : t("Subir")}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy || !present}
            title={present ? t("Borrar la foto (queda la ilustración por defecto)") : t("Este modelo no tiene foto")}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
          >
            {t("Eliminar")}
          </button>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      )}

      {err && <p className="text-center text-[11px] text-danger">{err}</p>}

      {picker && (
        <CentralPhotoPicker
          targetManufacturer={manufacturer}
          targetModel={model}
          onAssigned={() => { setPresent(true); setFailed(false); setVersion((v) => v + 1); onChanged(); }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

export default function ModelImagesPage() {
  const { t } = useI18n();
  const printers = useAsync<ApiPrinter[]>(() => api.listPrinters(), []);
  const images = useAsync<ApiModelImage[]>(() => api.listModelImages(), []);
  const central = useAsync<{ self: boolean; images: ApiModelImage[] }>(() => api.listCentralModelImages(), []);
  const me = getUser();
  const isAdmin = !me || me.role === "Administrator";

  const imageKeys = useMemo(() => new Set((images.data ?? []).map((i) => i.key)), [images.data]);
  // Hay biblioteca de fotos para el botón "Cambiar": las de la central (desde un
  // Desktop) o las propias (si ESTE equipo es la central).
  const libraryAvailable = !!central.data && central.data.images.length > 0;
  // Solo tiene sentido avisar de "reutilizar de la central" en un Desktop.
  const centralReuse = !!central.data && !central.data.self && central.data.images.length > 0;

  // Modelos de la flota + modelos que ya tienen foto (aunque no estén en flota).
  const models = useMemo(() => {
    const map = new Map<string, { manufacturer: string; model: string; count: number }>();
    for (const p of printers.data ?? []) {
      const model = String(p.model ?? "").trim();
      if (!model) continue;
      const k = keyOf(String(p.manufacturer), model);
      const e = map.get(k) ?? { manufacturer: String(p.manufacturer), model, count: 0 };
      e.count++;
      map.set(k, e);
    }
    for (const img of images.data ?? []) {
      if (!map.has(img.key)) map.set(img.key, { manufacturer: img.manufacturer, model: img.model, count: 0 });
    }
    return [...map.values()].sort((a, b) => a.model.localeCompare(b.model));
  }, [printers.data, images.data]);

  return (
    <>
      <Topbar title="Fotos por modelo" help="Sube una foto por modelo para reconocer visualmente cada impresora en la app." />
      <main className="flex-1 space-y-4 p-6">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-100">{t("Fotos por modelo")}</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            {t("Sube la foto real de cada modelo de tu flota. Se muestra en el detalle de todas las impresoras de ese modelo; si un modelo no tiene foto, se usa una ilustración. Recomendado: PNG cuadrado (~400×400), fondo transparente.")}
          </p>
          {centralReuse && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] text-accent">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
              {t("La central tiene fotos por modelo que puedes reutilizar: pulsa \"Cambiar\" en un modelo y elígela de la biblioteca.")}
            </p>
          )}
        </div>

        {(printers.loading || images.loading) && <Spinner />}
        {printers.error && <ErrorState message={printers.error} />}
        {!printers.loading && models.length === 0 && (
          <EmptyState title={t("Sin modelos.")} hint={t("Agrega impresoras para ver sus modelos aquí.")} />
        )}

        {models.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {models.map((m) => (
              <ModelCard
                key={keyOf(m.manufacturer, m.model)}
                manufacturer={m.manufacturer}
                model={m.model}
                count={m.count}
                hasPhoto={imageKeys.has(keyOf(m.manufacturer, m.model))}
                isAdmin={isAdmin}
                libraryAvailable={libraryAvailable}
                onChanged={() => images.reload()}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
