"use client";

/** Alta manual de impresora por IP (sección 2). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function AddPrinterPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [ip, setIp] = useState("");
  const [community, setCommunity] = useState("public");
  const version = "v2c"; // única versión soportada
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(t("Consultando por SNMP…"));
    try {
      const r = await api.addPrinter({ ip: ip.trim(), community: community.trim(), version });
      setMsg(`${t("Agregada:")} ${r.printer?.model ?? ip}`);
      setTimeout(() => router.push("/devices"), 700);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Topbar title="Agregar impresora" help="Escribe la IP de la impresora; el sistema la consulta por SNMP y completa modelo, serie y estado automáticamente." />
      <main className="flex-1 p-6">
        <form onSubmit={submit} className="card max-w-lg space-y-4 p-6">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Dirección IP")}</label>
            <input className="input w-full" placeholder="192.0.2.51" value={ip} onChange={(e) => setIp(e.target.value)} autoFocus />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">Community</label>
              <input className="input w-full" value={community} onChange={(e) => setCommunity(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{t("Versión SNMP")}</label>
              <div className="input flex min-w-[150px] items-center text-slate-100">
                <span>v2c</span>
              </div>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            {t("v2c: estándar actual; consultas masivas más rápidas (GetBulk) y mejor manejo de errores. La community viaja en texto plano (no cifra); SNMP v3 (autenticación/cifrado) no está soportado en esta versión.")}
          </p>
          <div className="flex items-center gap-3">
            <button className="btn" disabled={busy}>{busy ? "…" : t("Agregar por SNMP")}</button>
            <Link href="/network/discovery" className="text-xs text-accent hover:underline">
              {t("¿Muchas impresoras? Usa Discovery →")}
            </Link>
          </div>
          {msg && <p className="text-xs text-muted">{msg}</p>}
        </form>
      </main>
    </>
  );
}
