/**
 * Persistencia de un ProbeResult en la base de datos.
 *
 * Traduce el resultado agregado del SNMP core al modelo relacional. Reemplaza
 * consumibles/contadores/bandejas actuales y añade una fila de historial.
 */
import type { ProbeResult } from "@pdm/types";
import { prisma } from "./db.js";
import { shouldRecordStatusHistory } from "./history/snapshot-policy.js";

function tonerOf(probe: ProbeResult, color: string): number | null {
  const s = probe.supplies.find((x) => x.color === color);
  return s?.percent ?? null;
}

export async function saveProbe(probe: ProbeResult, community: string, version: string) {
  const totalCounter = probe.counters.find((c) => c.type === "TOTAL")?.value ?? null;

  // Identidad ESTABLE por número de serie: evita duplicar la MISMA impresora
  // cuando cambia su IP (el upsert por IP crearía un registro nuevo). Si ya existe
  // un registro con este serial, se consolida (se mueve a la IP actual y se
  // eliminan residuos: otros registros del mismo equipo o cualquiera que ocupe
  // ahora esta IP). Luego el upsert por IP encaja con ese mismo registro.
  const serial = probe.info.serialNumber?.trim() || null;
  if (serial) {
    // Atómico: dos probes concurrentes de la misma impresora (o de la misma IP)
    // no deben intercalar el borrado/movimiento y chocar con la restricción
    // única de `ipAddress`.
    // Timeout/maxWait amplios: bajo descubrimientos/altas concurrentes, estas
    // transacciones interactivas se ENCOLAN sobre el único escritor de SQLite;
    // con el default (5s) una que espere detrás de otras revienta. Con más
    // margen esperan en vez de fallar (junto con busy_timeout de la BD).
    await prisma.$transaction(
      async (tx) => {
        const existing = await tx.printer.findFirst({ where: { serialNumber: serial } });
        if (!existing) return;
        await tx.printer.deleteMany({
          where: { NOT: { id: existing.id }, OR: [{ serialNumber: serial }, { ipAddress: probe.ip }] },
        });
        if (existing.ipAddress !== probe.ip) {
          await tx.printer.update({ where: { id: existing.id }, data: { ipAddress: probe.ip } });
        }
      },
      { timeout: 15_000, maxWait: 15_000 },
    );
  }

  const printer = await prisma.printer.upsert({
    where: { ipAddress: probe.ip },
    create: {
      name: probe.info.deviceName ?? probe.info.model ?? probe.ip,
      ipAddress: probe.ip,
      macAddress: probe.info.macAddress ?? null,
      hostname: probe.info.hostname ?? null,
      manufacturer: probe.info.manufacturer,
      model: probe.info.model ?? null,
      serialNumber: probe.info.serialNumber ?? null,
      firmware: probe.info.firmware ?? null,
      snmpVersion: version,
      // NOTA: cifrado real de community pendiente (sección 23) — placeholder.
      snmpCommunityEncrypted: community ? "***" : null,
      sysObjectId: probe.info.sysObjectId ?? null,
      status: probe.status.online,
      lastSeen: probe.reachable ? new Date() : null,
      uptimeSeconds: probe.info.uptimeSeconds ?? null,
      uptimeReadAt: probe.info.uptimeSeconds != null ? new Date() : null,
    },
    update: {
      macAddress: probe.info.macAddress ?? undefined,
      hostname: probe.info.hostname ?? undefined,
      manufacturer: probe.info.manufacturer,
      model: probe.info.model ?? undefined,
      serialNumber: probe.info.serialNumber ?? undefined,
      firmware: probe.info.firmware ?? undefined,
      sysObjectId: probe.info.sysObjectId ?? undefined,
      status: probe.status.online,
      lastSeen: probe.reachable ? new Date() : undefined,
      // Solo se actualiza si esta lectura trajo uptime (no lo borra si faltó).
      uptimeSeconds: probe.info.uptimeSeconds ?? undefined,
      uptimeReadAt: probe.info.uptimeSeconds != null ? new Date() : undefined,
    },
  });

  // Reemplazar snapshot de consumibles/contadores/bandejas.
  await prisma.printerSupply.deleteMany({ where: { printerId: printer.id } });
  if (probe.supplies.length) {
    await prisma.printerSupply.createMany({
      data: probe.supplies.map((s) => ({
        printerId: printer.id,
        name: s.name,
        type: s.type,
        color: s.color,
        level: s.level,
        maxCapacity: s.maxCapacity,
        percent: s.percent ?? null,
      })),
    });
  }

  await prisma.printerTray.deleteMany({ where: { printerId: printer.id } });
  if (probe.trays.length) {
    await prisma.printerTray.createMany({
      data: probe.trays.map((t) => ({
        printerId: printer.id,
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

  if (probe.counters.length) {
    await prisma.printerCounter.createMany({
      data: probe.counters.map((c) => ({
        printerId: printer.id,
        counterType: c.type,
        value: c.value,
      })),
    });
  }

  // Fila de historial (sección 18), muestreada por intervalo (default 1 h) salvo cambio de estado.
  if (await shouldRecordStatusHistory(prisma, printer.id, probe.status.online)) {
    await prisma.printerStatusHistory.create({
      data: {
        printerId: printer.id,
        status: probe.status.online,
        tonerBlack: tonerOf(probe, "BLACK"),
        tonerCyan: tonerOf(probe, "CYAN"),
        tonerMagenta: tonerOf(probe, "MAGENTA"),
        tonerYellow: tonerOf(probe, "YELLOW"),
        totalPages: totalCounter,
      },
    });
  }

  return getPrinter(printer.id);
}

export async function getPrinter(id: string) {
  return prisma.printer.findUnique({
    where: { id },
    include: { supplies: true, counters: true, trays: true, location: true, workUnit: true },
  });
}

export async function listPrinters() {
  return prisma.printer.findMany({
    include: {
      supplies: true,
      location: true,
      workUnit: true,
      // Últimos contadores (acotados) para que la tabla del dashboard muestre
      // el total de páginas sin cargar todo el historial. El frontend deduplica
      // al valor más reciente por tipo.
      counters: { orderBy: { collectedAt: "desc" }, take: 20 },
    },
    orderBy: { name: "asc" },
  });
}

export async function deletePrinter(id: string) {
  return prisma.printer.delete({ where: { id } });
}
