/**
 * Funciones de actualización DIRIGIDA de la BD para el polling.
 *
 * `saveProbe()` de `printers-repo.ts` persiste un ProbeResult completo (y añade
 * una fila de historial cada vez). El motor de polling, en cambio, consulta
 * cada tipo de dato con distinta frecuencia (sección 16), por lo que necesita
 * escribir solo el "trozo" que vence en cada ciclo y evitar así inflar
 * contadores/historial en los pollers rápidos.
 *
 * Este archivo pertenece al dominio Backend/Polling. NO reescribe
 * `printers-repo.ts`; ofrece escrituras granulares equivalentes.
 */
import type { PrismaClient } from "@prisma/client";
import type { ProbeResult } from "@pdm/types";
import { shouldRecordStatusHistory } from "../history/snapshot-policy.js";

/** Toner (porcentaje) de un color en el probe, o null si no está. */
function tonerOf(probe: ProbeResult, color: string): number | null {
  const s = probe.supplies.find((x) => x.color === color);
  return s?.percent ?? null;
}

/**
 * Actualiza estado ONLINE + `lastSeen` y añade una fila de historial de estado
 * (sección 18/28). Es la escritura del StatusPoller/ErrorPoller.
 */
export async function updatePrinterStatus(
  prisma: PrismaClient,
  printerId: string,
  probe: ProbeResult,
  now: Date = new Date(),
): Promise<void> {
  const totalPages = probe.counters.find((c) => c.type === "TOTAL")?.value ?? null;

  await prisma.printer.update({
    where: { id: printerId },
    data: {
      status: probe.status.online,
      lastSeen: probe.reachable ? now : undefined,
    },
  });

  // Snapshot como máximo una vez por intervalo (por defecto 1 h), salvo cambio de estado.
  if (await shouldRecordStatusHistory(prisma, printerId, probe.status.online, now)) {
    await prisma.printerStatusHistory.create({
      data: {
        printerId,
        status: probe.status.online,
        tonerBlack: tonerOf(probe, "BLACK"),
        tonerCyan: tonerOf(probe, "CYAN"),
        tonerMagenta: tonerOf(probe, "MAGENTA"),
        tonerYellow: tonerOf(probe, "YELLOW"),
        totalPages,
      },
    });
  }
}

/**
 * Marca la impresora OFFLINE (detección automática, sección 28) y añade una
 * fila de historial. No toca `lastSeen`: se conserva la última vez que
 * respondió realmente.
 */
export async function markPrinterOffline(
  prisma: PrismaClient,
  printerId: string,
): Promise<void> {
  await prisma.printer.update({
    where: { id: printerId },
    data: { status: "OFFLINE" },
  });

  // El cambio a OFFLINE se registra siempre; repeticiones se agrupan por intervalo.
  if (await shouldRecordStatusHistory(prisma, printerId, "OFFLINE")) {
    await prisma.printerStatusHistory.create({
      data: { printerId, status: "OFFLINE" },
    });
  }
}

/** Reemplaza el snapshot de consumibles (SupplyPoller). */
export async function updatePrinterSupplies(
  prisma: PrismaClient,
  printerId: string,
  probe: ProbeResult,
): Promise<void> {
  await prisma.printerSupply.deleteMany({ where: { printerId } });
  if (probe.supplies.length) {
    await prisma.printerSupply.createMany({
      data: probe.supplies.map((s) => ({
        printerId,
        name: s.name,
        type: s.type,
        color: s.color,
        level: s.level,
        maxCapacity: s.maxCapacity,
        percent: s.percent ?? null,
      })),
    });
  }
}

/** Reemplaza el snapshot de bandejas (TrayPoller). */
export async function updatePrinterTrays(
  prisma: PrismaClient,
  printerId: string,
  probe: ProbeResult,
): Promise<void> {
  await prisma.printerTray.deleteMany({ where: { printerId } });
  if (probe.trays.length) {
    await prisma.printerTray.createMany({
      data: probe.trays.map((t) => ({
        printerId,
        trayName: t.name,
        paperSize: t.paperSize ?? null,
        paperType: t.paperType ?? null,
        capacity: t.capacity ?? null,
        currentLevel: t.currentLevel ?? null,
        capacityUnit: t.capacityUnit ?? null,
        isEmpty: t.isEmpty,
      })),
    });
  }
}

/**
 * Añade lecturas de contadores (CounterPoller). Cada lectura es una fila nueva
 * con su `collectedAt`, para poder graficar consumo en el tiempo (sección 18).
 */
export async function updatePrinterCounters(
  prisma: PrismaClient,
  printerId: string,
  probe: ProbeResult,
): Promise<void> {
  if (probe.counters.length) {
    await prisma.printerCounter.createMany({
      data: probe.counters.map((c) => ({
        printerId,
        counterType: c.type,
        value: c.value,
      })),
    });
  }
}

/** Actualiza los campos de información del dispositivo (DeviceInformationPoller). */
export async function updatePrinterInfo(
  prisma: PrismaClient,
  printerId: string,
  probe: ProbeResult,
): Promise<void> {
  await prisma.printer.update({
    where: { id: printerId },
    data: {
      manufacturer: probe.info.manufacturer,
      model: probe.info.model ?? undefined,
      serialNumber: probe.info.serialNumber ?? undefined,
      firmware: probe.info.firmware ?? undefined,
      hostname: probe.info.hostname ?? undefined,
      macAddress: probe.info.macAddress ?? undefined,
      sysObjectId: probe.info.sysObjectId ?? undefined,
      uptimeSeconds: probe.info.uptimeSeconds ?? undefined,
      uptimeReadAt: probe.info.uptimeSeconds != null ? new Date() : undefined,
    },
  });
}
