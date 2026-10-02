"use client";

/**
 * Foto del modelo de impresora: intenta cargar la foto real subida
 * (/api/model-images/lookup) y, si ese modelo aún no tiene foto, cae a la
 * ilustración vectorial. Un Administrator puede subir/cambiar la foto del modelo
 * desde aquí (aplica a todas las impresoras de ese modelo).
 */
import { useEffect, useRef, useState } from "react";
import { PrinterIllustration } from "./PrinterIllustration";
import { CentralPhotoPicker } from "./CentralPhotoPicker";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const keyOf = (manufacturer: string, model: string) => `${manufacturer}|${model}`.trim().toLowerCase();

export function PrinterPhoto({
  manufacturer,
  model,
  mfp = true,
  canEdit = false,
}: {
  manufacturer: string;
  model?: string | null;
  mfp?: boolean;
  canEdit?: boolean;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [centralAvailable, setCentralAvailable] = useState(false);
  const [centralExact, setCentralExact] = useState(false);
  const [picker, setPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasModel = !!(model && model.trim());
  useEffect(() => setFailed(false), [manufacturer, model]);

  // Disponibilidad de la biblioteca de la central (para reutilizar la foto de
  // este modelo si aún no la tiene local). Solo si se puede editar.
  useEffect(() => {
    if (!canEdit || !hasModel) return;
    let alive = true;
    api
      .listCentralModelImages()
      .then((r) => {
        if (!alive) return;
        const usable = !r.self && r.images.length > 0;
        setCentralAvailable(usable);
        setCentralExact(usable && r.images.some((i) => i.key === keyOf(manufacturer, model!)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canEdit, hasModel, manufacturer, model]);

  async function bringExact() {
    if (!hasModel) return;
    setUploading(true);
    try {
      await api.importModelImageFromCentral({ sourceManufacturer: manufacturer, sourceModel: model!, manufacturer, model: model! });
      setFailed(false);
      setVersion((v) => v + 1);
    } catch {
      /* si falla, se mantiene la ilustración */
    } finally {
      setUploading(false);
    }
  }

  const url = hasModel
    ? `/api/model-images/lookup?manufacturer=${encodeURIComponent(manufacturer)}&model=${encodeURIComponent(model!)}&v=${version}`
    : "";

  async function onFile(f: File) {
    if (!hasModel) return;
    setUploading(true);
    try {
      await api.uploadModelImage(manufacturer, model!, f);
      setFailed(false);
      setVersion((v) => v + 1);
    } catch {
      /* si falla, se mantiene la ilustración/foto anterior */
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="relative h-24 w-24 shrink-0">
      {hasModel && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={model ?? t("Impresora")}
          onError={() => setFailed(true)}
          className="h-24 w-24 rounded-xl border border-border bg-card object-contain p-1"
        />
      ) : (
        <PrinterIllustration mfp={mfp} className="h-24 w-24" />
      )}

      {canEdit && hasModel && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            title={t("Subir/cambiar foto del modelo")}
            className="absolute -bottom-1.5 -right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted shadow-soft transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {uploading ? (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path d="M21 12a9 9 0 1 1-6.2-8.6" strokeLinecap="round" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 16l4.5-4.5a2 2 0 0 1 2.8 0L16 16M14 14l1.5-1.5a2 2 0 0 1 2.8 0L20 14" />
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <circle cx="8.5" cy="9" r="1.5" />
              </svg>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
          {/* Reutilizar la foto de la central (solo si aún no hay foto local y
              este equipo no es la central). Si coincide exacto, la trae directo;
              si no, abre el selector para emparejar a mano. */}
          {failed && centralAvailable && (
            <button
              type="button"
              onClick={() => (centralExact ? bringExact() : setPicker(true))}
              disabled={uploading}
              title={centralExact ? t("Traer la foto de este modelo desde la central") : t("Elegir una foto de la biblioteca de la central")}
              className="absolute -bottom-1.5 -left-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-accent/50 bg-accent/10 text-accent shadow-soft transition hover:bg-accent/20 disabled:opacity-50"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
            </button>
          )}
        </>
      )}

      {picker && hasModel && (
        <CentralPhotoPicker
          targetManufacturer={manufacturer}
          targetModel={model!}
          onAssigned={() => { setFailed(false); setVersion((v) => v + 1); }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}
