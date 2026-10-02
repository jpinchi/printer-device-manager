/**
 * Scheduler del motor de polling (envoltura con temporizadores de Node).
 *
 * Mantiene un único temporizador base (`tickMs`) y, en cada tick, usa la lógica
 * PURA `selectDuePollers` para decidir qué pollers vencieron y ejecuta un ciclo
 * solo con esos tipos. Así cada tipo de dato respeta su propia frecuencia
 * (sección 16) sin necesidad de un timer por tipo.
 *
 * Usa solo `setInterval`/`setTimeout` nativos (sin dependencias tipo cron).
 */
import type { PrismaClient } from "@prisma/client";
import { pollingConfig } from "./config.js";
import type { PollingConfig } from "./config.js";
import { runPollingCycle } from "./cycle.js";
import type { LastRunMap } from "./selection.js";
import { selectDuePollers, markRan } from "./selection.js";

export interface PollingHandle {
  /** Detiene el temporizador. Idempotente. */
  stop(): void;
  /** Fuerza un tick inmediato (respeta los intervalos vencidos). */
  tickNow(): Promise<void>;
}

export interface StartPollingOptions {
  /** Configuración a usar (por defecto la del entorno). */
  config?: PollingConfig;
  /** Modo mock (por defecto lo decide `config.snmp.mock` dentro del ciclo). */
  mock?: boolean;
  /**
   * Callback tras cada ciclo que ejecutó pollers. Punto de enganche para
   * tiempo real (sección 19): permite difundir por WebSocket que el inventario
   * cambió sin acoplar el scheduler al transporte.
   */
  onCycle?: (report: { total: number; online: number; offline: number; failed: number }) => void;
}

/**
 * Arranca el scheduler de polling. Devuelve un handle para detenerlo.
 *
 * Nota: si un ciclo tarda más que el tick, los ticks solapados se descartan
 * (bandera `running`) para no acumular consultas SNMP.
 */
export function startPolling(
  prisma: PrismaClient,
  opts: StartPollingOptions = {},
): PollingHandle {
  const cfg = opts.config ?? pollingConfig;
  let lastRun: LastRunMap = {};
  let running = false;
  let stopped = false;

  async function tick(): Promise<void> {
    if (running || stopped) return; // evita solapamiento
    const now = Date.now();
    const due = selectDuePollers(now, lastRun, cfg.intervals);
    if (due.length === 0) return;

    running = true;
    try {
      const report = await runPollingCycle(prisma, { kinds: due, mock: opts.mock });
      lastRun = markRan(lastRun, due, now);
      console.log(
        `[polling] ciclo [${due.join(", ")}] → ${report.online} online, ` +
          `${report.offline} offline, ${report.failed} con error (de ${report.total})`,
      );
      // Enganche de tiempo real (sección 19): notificar que el inventario cambió.
      if (report.total > 0) opts.onCycle?.(report);
    } catch (err) {
      console.error("[polling] error en el ciclo:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), cfg.tickMs);
  // No mantener vivo el proceso solo por el polling (permite cierres limpios).
  timer.unref?.();

  console.log(
    `[polling] scheduler activo · tick=${cfg.tickMs}ms · ` +
      `status=${cfg.intervals.status}ms errors=${cfg.intervals.errors}ms ` +
      `supplies=${cfg.intervals.supplies}ms trays=${cfg.intervals.trays}ms ` +
      `counters=${cfg.intervals.counters}ms deviceInfo=${cfg.intervals.deviceInfo}ms`,
  );

  // Primer ciclo inmediato (todos los pollers vencen al arrancar).
  void tick();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      console.log("[polling] scheduler detenido");
    },
    tickNow: tick,
  };
}
