"use client";

/**
 * Centro de ayuda / tutorial de la app.
 *
 * - Botón "?" en la barra superior que abre una guía con la explicación de cada
 *   sección de la app.
 * - Se abre AUTOMÁTICAMENTE la primera vez que alguien usa la app (bandera en
 *   localStorage), para que un usuario nuevo sepa cómo se usa todo.
 * - Se puede reabrir cuando se quiera desde el botón.
 *
 * Los textos van en español (idioma base) y se traducen con t().
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import { useI18n } from "@/lib/i18n";

const SEEN_KEY = "pdm.tutorial.v1";

interface GuideItem {
  icon: IconName;
  title: string;
  body: string;
}
interface GuideSection {
  heading: string;
  items: GuideItem[];
}

// Guía data-driven: cada sección agrupa las páginas del menú.
const GUIDE: GuideSection[] = [
  {
    heading: "Vista general",
    items: [
      { icon: "dashboard", title: "Dashboard", body: "Estado general de toda la flota: cuántas impresoras están en línea, fuera de línea y con alertas. Es tu punto de partida." },
      { icon: "panel", title: "Panel de control", body: "Tarjetas con métricas clave y accesos rápidos a las secciones que más se usan." },
    ],
  },
  {
    heading: "Dispositivos",
    items: [
      { icon: "printer", title: "Impresoras", body: "El inventario completo. Filtra por estado, busca por nombre, modelo o IP, y entra a cada impresora para ver su detalle (tóner, contadores, ubicación)." },
      { icon: "add", title: "Agregar impresora", body: "Registra una impresora nueva escribiendo su IP. El sistema la consulta por SNMP y completa modelo, número de serie y estado automáticamente." },
    ],
  },
  {
    heading: "Monitoreo",
    items: [
      { icon: "supplies", title: "Consumibles", body: "Niveles de tóner y otros suministros. Las barras se ponen en rojo cuando bajan del umbral configurado en Ajustes." },
      { icon: "counters", title: "Contadores", body: "Páginas impresas (total, color y negro) que cada impresora reporta por SNMP." },
      { icon: "alerts", title: "Alertas", body: "Avisos automáticos: tóner bajo, sin papel, atascos o impresora fuera de línea. Aquí ves qué necesita atención." },
      { icon: "history", title: "Historial", body: "Registro de eventos y cambios de estado en el tiempo, para auditar qué pasó y cuándo." },
    ],
  },
  {
    heading: "Red",
    items: [
      { icon: "discovery", title: "Descubrimiento", body: "Escanea un rango de red para encontrar impresoras nuevas por SNMP y agregarlas al inventario." },
      { icon: "online", title: "IPs disponibles", body: "Escanea un rango y muestra qué IPs están libres y cuáles ocupadas (con el modelo del equipo que responde). Útil antes de asignar una IP nueva." },
      { icon: "snmp", title: "Asignar IP (remoto)", body: "Cambia la IP de una impresora RICOH de forma remota por SNMP. El inventario se actualiza solo al aplicar el cambio (la impresora se reinicia)." },
      { icon: "snmp", title: "Ajustes SNMP", body: "Configura la comunidad SNMP (por defecto «public»), la versión y los tiempos de espera que el servidor usa para hablar con las impresoras." },
    ],
  },
  {
    heading: "Controladores",
    items: [
      { icon: "drivers", title: "Controladores e instalación remota", body: "Catálogo de drivers: sube el instalador (.inf/.exe/.zip) de cada modelo. Como administrador puedes instalarlo en OTRA PC del dominio de forma remota (sin WinRM, vía SMB+WMI) y, si eliges una impresora del inventario, además crea la cola para que aparezca lista." },
    ],
  },
  {
    heading: "Administración",
    items: [
      { icon: "locations", title: "Ubicaciones", body: "Define oficinas o áreas y asígnalas a las impresoras para saber dónde está cada equipo." },
      { icon: "image", title: "Fotos por modelo", body: "Sube una foto por modelo para reconocer visualmente cada impresora en la app." },
      { icon: "users", title: "Usuarios", body: "Gestiona cuentas y roles: Administrador, Técnico y Visor, cada uno con distintos permisos." },
      { icon: "settings", title: "Ajustes", body: "Preferencias del sistema: umbral de tóner bajo, intervalos de sondeo y otras opciones generales." },
    ],
  },
];

export function HelpCenter() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // El modal se monta vía portal en <body>: solo tras montar en cliente.
  useEffect(() => setMounted(true), []);

  // Auto-apertura la primera vez.
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      /* localStorage no disponible: no forzamos nada */
    }
  }, []);

  // Se puede abrir desde cualquier parte (p. ej. el botón "Ayuda" del menú
  // lateral) disparando el evento global `pdm:open-help`.
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener("pdm:open-help", openIt);
    return () => window.removeEventListener("pdm:open-help", openIt);
  }, []);

  function close() {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignorar */
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("Ayuda")}
        title={t("Ayuda y tutorial")}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition hover:border-accent hover:text-accent"
      >
        <Icon name="help" className="h-[18px] w-[18px]" />
      </button>

      {open && mounted && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-glow"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Encabezado */}
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">{t("Bienvenido a Printer Device Manager")}</h2>
                <p className="mt-1 text-sm text-muted">{t("Guía rápida de qué hace cada sección. Puedes volver a abrirla cuando quieras con el botón «?» de la barra superior.")}</p>
              </div>
              <button
                onClick={close}
                aria-label={t("Cerrar")}
                className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-sm text-muted transition hover:border-accent hover:text-accent"
              >
                ✕
              </button>
            </div>

            {/* Contenido con scroll */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {GUIDE.map((section) => (
                <div key={section.heading} className="mb-6 last:mb-0">
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {t(section.heading)}
                  </h3>
                  <ul className="space-y-2.5">
                    {section.items.map((item) => (
                      <li key={item.title} className="flex gap-3 rounded-xl border border-border/60 bg-panel/40 p-3">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                          <Icon name={item.icon} className="h-[18px] w-[18px]" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-100">{t(item.title)}</div>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted">{t(item.body)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <p className="mt-2 rounded-xl border border-border/60 bg-panel/40 p-3 text-xs leading-relaxed text-muted">
                <span className="font-medium text-slate-200">{t("Consejo:")}</span>{" "}
                {t("Busca el botón «?» junto a los títulos de cada página para una explicación breve de esa sección. Arriba a la derecha puedes cambiar el idioma (ES/EN) y el tema claro/oscuro.")}
              </p>

              {/* Recursos y soporte: guía en PDF + contacto */}
              <div className="mt-6">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {t("Recursos y soporte")}
                </h3>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {/* Descargar la guía en PDF */}
                  <a
                    href="/guia-instalacion-pdm.pdf"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 p-3 transition hover:border-accent hover:bg-accent/10"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                      <Icon name="drivers" className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100">{t("Guía de instalación y hub (PDF)")}</div>
                      <p className="mt-0.5 text-xs text-muted">
                        {t("Pasos con diagramas: instalar, iniciar sesión, montar el hub y delegar.")}
                      </p>
                    </div>
                  </a>

                  {/* Contacto de soporte */}
                  <a
                    href="mailto:soporte@example.local?subject=Soporte%20Printer%20Device%20Manager"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 rounded-xl border border-border/60 bg-panel/40 p-3 transition hover:border-accent"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <Icon name="alerts" className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100">{t("¿Dudas o problemas?")}</div>
                      <p className="mt-0.5 break-all text-xs text-muted">soporte@example.local</p>
                    </div>
                  </a>
                </div>
              </div>
            </div>

            {/* Pie */}
            <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
              <button onClick={close} className="btn">
                {t("Entendido")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
