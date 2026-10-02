/** Barra de porcentaje para un consumible (tóner/tinta). */
"use client";
import { supplyBarColor, tonerTone } from "@/lib/format";
import { useTheme } from "@/hooks/useTheme";

export function SupplyBar({
  color,
  percent,
  showValue = true,
}: {
  color: string;
  percent: number | null;
  showValue?: boolean;
}) {
  const theme = useTheme();
  const pct = percent == null ? null : Math.max(0, Math.min(100, percent));
  // Color por nivel (rojo crítico / ámbar bajo / neutro), consistente en la app.
  const tone = tonerTone(pct);
  return (
    <div className="flex items-center gap-2">
      <div
        className={`h-2 w-full min-w-[80px] overflow-hidden rounded-full bg-border ${tone.ring}`}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct ?? 0}%`,
            background: pct == null ? "transparent" : supplyBarColor(color, theme),
          }}
        />
      </div>
      {showValue && (
        <span
          className={`w-10 shrink-0 text-right text-xs tabular-nums ${
            tone.flag ? `font-semibold ${tone.text}` : "text-muted"
          }`}
        >
          {pct == null ? "—" : `${pct}%`}
        </span>
      )}
    </div>
  );
}
