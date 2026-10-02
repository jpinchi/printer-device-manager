"use client";

/**
 * Al navegar (cambia la ruta o los parámetros de query), lleva la página al
 * inicio. Garantiza que toda pantalla se abra desde arriba, sin heredar el
 * scroll de la lista anterior. Usa useSearchParams, así que se monta dentro de
 * un <Suspense> (ver layout).
 */
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function ScrollToTop() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    // El scroll vive en la columna de contenido (#app-scroll), que tiene su
    // propio overflow; el sidebar queda fijo. Se hace fallback a la ventana.
    const el = document.getElementById("app-scroll");
    if (el) el.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, search]);

  return null;
}
