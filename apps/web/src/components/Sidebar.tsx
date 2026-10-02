"use client";

/**
 * Navegación lateral (sección 6 del plan).
 * Dashboard · Devices · Monitoring · Network · Administration.
 */
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon, Logo, type IconName } from "./icons";
import { DesktopUpdater } from "./DesktopUpdater";
import { useI18n } from "@/lib/i18n";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

// Las etiquetas van en ESPAÑOL (idioma base) y se traducen en el render con t().
const NAV: NavGroup[] = [
  {
    title: "",
    items: [
      { href: "/", label: "Dashboard", icon: "dashboard" },
      { href: "/panel", label: "Panel de control", icon: "panel" },
    ],
  },
  {
    title: "Dispositivos",
    items: [
      { href: "/devices", label: "Impresoras", icon: "printer" },
      { href: "/devices?status=ONLINE", label: "En línea", icon: "online" },
      { href: "/devices?status=OFFLINE", label: "Fuera de línea", icon: "offline" },
      { href: "/devices/add", label: "Agregar impresora", icon: "add" },
    ],
  },
  {
    title: "Monitoreo",
    items: [
      { href: "/monitoring/supplies", label: "Consumibles", icon: "supplies" },
      { href: "/monitoring/counters", label: "Contadores", icon: "counters" },
      { href: "/monitoring/alerts", label: "Alertas", icon: "alerts" },
      { href: "/monitoring/history", label: "Historial", icon: "history" },
      { href: "/monitoring/reports", label: "Reportes", icon: "report" },
    ],
  },
  {
    title: "Red",
    items: [
      { href: "/network/discovery", label: "Descubrimiento", icon: "discovery" },
      { href: "/network/ip-scan", label: "IPs disponibles", icon: "online" },
      { href: "/network/ip-assign", label: "Asignar IP (remoto)", icon: "snmp" },
      { href: "/network/snmp", label: "Ajustes SNMP", icon: "snmp" },
    ],
  },
  {
    title: "Controladores",
    items: [{ href: "/drivers", label: "Controladores", icon: "drivers" }],
  },
  {
    title: "Administración",
    items: [
      { href: "/administration/locations", label: "Ubicaciones", icon: "locations" },
      { href: "/administration/work-units", label: "Unidades de trabajo", icon: "workunit" },
      { href: "/administration/model-images", label: "Fotos por modelo", icon: "image" },
      { href: "/administration/users", label: "Usuarios", icon: "users" },
      { href: "/administration/settings", label: "Ajustes", icon: "settings" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  const norm = (p: string) => {
    const s = (p || "/").replace(/\/+$/, "");
    return s === "" ? "/" : s;
  };
  const currentPath = norm(pathname);
  const currentStatus = searchParams.get("status");

  const isActive = (href: string) => {
    const [rawPath, rawQuery] = href.split("?");
    const itemPath = norm(rawPath);
    if (itemPath !== currentPath) return false;
    if (itemPath === "/devices") {
      const itemStatus = new URLSearchParams(rawQuery ?? "").get("status");
      return (itemStatus ?? null) === (currentStatus ?? null);
    }
    return true;
  };

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border/70 bg-panel/80 backdrop-blur-md md:flex">
      {/* Marca */}
      <div className="flex items-center gap-3 border-b border-border/70 px-5 py-4">
        <Logo className="h-9 w-9 drop-shadow-[0_4px_12px_rgba(56,189,248,0.4)]" />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-slate-100">
            Printer Device
          </div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent/80">
            Manager
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((group, gi) => (
          <div key={gi} className="mb-5">
            {group.title && (
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {t(group.title)}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
                        active
                          ? "bg-accent/10 font-medium text-accent"
                          : "text-slate-300 hover:translate-x-0.5 hover-elev hover:text-slate-100"
                      }`}
                    >
                      {/* Barra indicadora de activo */}
                      <span
                        className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-accent to-accent2 transition-all duration-300 ${
                          active ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <Icon
                        name={item.icon}
                        className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                          active ? "text-accent" : "text-slate-400 group-hover:text-slate-100"
                        }`}
                      />
                      {t(item.label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Botón de Ayuda: abre el centro de ayuda (guía, tips, PDF y contacto). */}
      <div className="border-t border-border/70 px-3 py-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("pdm:open-help"))}
          className="group flex w-full items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm font-medium text-accent transition-all duration-200 hover:border-accent hover:bg-accent/10"
        >
          <Icon name="help" className="h-[18px] w-[18px] shrink-0" />
          {t("Ayuda y guía")}
        </button>
      </div>

      <div className="border-t border-border/70 px-5 py-3 text-[10px] text-slate-500">
        {t("SNMP · Tiempo real")}
      </div>
      <DesktopUpdater />
    </aside>
  );
}
