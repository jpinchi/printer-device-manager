/**
 * Ilustración vectorial (estilizada) de una impresora / multifunción, temática
 * (usa tokens de color del tema). `mfp` añade la unidad de escáner + alimentador
 * superior típica de las multifunción (RICOH IM, etc.).
 *
 * No es la foto real del fabricante (no hay una fuente estándar por SNMP); es un
 * gráfico consistente para identificar el equipo de un vistazo.
 */
export function PrinterIllustration({ mfp = true, className = "h-24 w-24" }: { mfp?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 96 96" className={className} role="img" aria-label={mfp ? "Multifunción" : "Impresora"}>
      {/* Unidad superior (escáner + alimentador) solo en multifunción */}
      {mfp && (
        <>
          {/* Alimentador de documentos (ADF) */}
          <rect x="24" y="10" width="48" height="9" rx="2.5" className="fill-panel stroke-border" strokeWidth="1.6" />
          <path d="M30 10.5 h30" className="stroke-border" strokeWidth="1.4" opacity="0.7" />
          {/* Cristal / cuerpo del escáner */}
          <rect x="19" y="18" width="58" height="16" rx="3" className="fill-card stroke-border" strokeWidth="1.8" />
          <rect x="24" y="23" width="30" height="6" rx="1.5" className="fill-bg" opacity="0.6" />
        </>
      )}

      {/* Papel de salida asomando */}
      <rect x="30" y={mfp ? 30 : 22} width="36" height="12" rx="1.5" fill="#ffffff" className="stroke-border" strokeWidth="1.2" />
      <path d={`M35 ${mfp ? 34 : 26} h26 M35 ${mfp ? 37 : 29} h20`} className="stroke-slate-400" strokeWidth="1.2" opacity="0.6" />

      {/* Cuerpo principal */}
      <rect x="14" y={mfp ? 34 : 26} width="68" height="34" rx="4" className="fill-card stroke-border" strokeWidth="1.8" />

      {/* Ranura de salida */}
      <rect x="22" y={mfp ? 44 : 36} width="52" height="6" rx="2" className="fill-bg" opacity="0.7" />

      {/* Panel de control (pantalla) */}
      <rect x="58" y={mfp ? 52 : 44} width="17" height="11" rx="2" className="fill-accent" />
      <rect x="60.5" y={mfp ? 54 : 46} width="12" height="3" rx="1" fill="#ffffff" opacity="0.65" />

      {/* Indicador / botón */}
      <circle cx="24" cy={mfp ? 57.5 : 49.5} r="2.4" className="fill-ok" />

      {/* Bandeja de papel inferior */}
      <rect x="18" y="64" width="60" height="18" rx="3" className="fill-panel stroke-border" strokeWidth="1.8" />
      <rect x="34" y="70" width="28" height="4" rx="2" className="fill-border" />
    </svg>
  );
}
