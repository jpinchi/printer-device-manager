"use client";

/**
 * Selector de fotos de la BIBLIOTECA DE LA CENTRAL. Muestra las fotos por modelo
 * que ya tiene la central y permite ASIGNAR una al modelo de este inventario
 * (emparejamiento manual: la foto correcta aunque el nombre del modelo difiera).
 * Al elegir, la copia a este equipo (import-from-central) y avisa con onAssigned.
 *
 * Se renderiza en un PORTAL a <body>: el header/tarjetas tienen backdrop-filter,
 * que crea bloque contenedor para los `fixed` (ver ProfileMenu).
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ApiModelImage } from "@/lib/types";

export function CentralPhotoPicker({
  targetManufacturer,
  targetModel,
  onAssigned,
  onClose,
}: {
  targetManufacturer: string;
  targetModel: string;
  onAssigned: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ApiModelImage[]>([]);
  const [q, setQ] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listCentralModelImages()
      .then((r) => {
        if (!alive) return;
        setImages(r.images ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : t("No se pudo cargar la biblioteca de la central."));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [t]);

  const targetKey = `${targetManufacturer}|${targetModel}`.trim().toLowerCase();

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return images;
    return images.filter((i) => `${i.manufacturer} ${i.model}`.toLowerCase().includes(s));
  }, [images, q]);

  async function assign(img: ApiModelImage) {
    setBusyKey(img.key);
    setError(null);
    try {
      await api.importModelImageFromCentral({
        sourceManufacturer: img.manufacturer,
        sourceModel: img.model,
        manufacturer: targetManufacturer,
        model: targetModel,
      });
      onAssigned();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("No se pudo importar la foto."));
      setBusyKey(null);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border/70 p-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">{t("Elegir foto del modelo")}</h3>
            <p className="text-xs text-muted">
              {t("Elige la foto que corresponde a")} <span className="text-slate-200">{targetModel}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent">
            {t("Cerrar")}
          </button>
        </div>

        <div className="border-b border-border/60 p-3">
          <input
            className="input w-full"
            placeholder={t("Buscar por fabricante o modelo…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            spellCheck={false}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="py-8 text-center text-sm text-muted">{t("Cargando…")}</p>}
          {error && <p className="py-4 text-center text-sm text-danger">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">{t("La central no tiene fotos que coincidan.")}</p>
          )}
          {filtered.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {filtered.map((img) => (
                <button
                  key={img.key}
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => assign(img)}
                  title={`${img.manufacturer} · ${img.model}`}
                  className={`group relative flex flex-col items-center gap-2 rounded-xl border p-2 text-center transition hover:border-accent disabled:opacity-50 ${
                    img.key === targetKey ? "border-accent ring-1 ring-accent/40" : "border-border"
                  }`}
                >
                  {img.key === targetKey && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-medium text-accent">
                      {t("coincide")}
                    </span>
                  )}
                  <span className="flex h-24 w-24 items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={api.centralModelImageUrl(img.manufacturer, img.model)}
                      alt={img.model}
                      className="h-24 w-24 rounded-lg border border-border bg-card object-contain p-1"
                    />
                  </span>
                  <span className="w-full">
                    <span className="block truncate text-xs font-medium text-slate-100">{img.model}</span>
                    <span className="block truncate text-[10px] text-muted">{img.manufacturer}</span>
                  </span>
                  {busyKey === img.key && <span className="text-[10px] text-accent">{t("Importando…")}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
