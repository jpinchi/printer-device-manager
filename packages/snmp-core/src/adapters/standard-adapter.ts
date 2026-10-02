/**
 * StandardPrinterAdapter — implementación basada en MIBs estándar abiertas
 * (Printer-MIB, HOST-RESOURCES-MIB, MIB-II). Es el FALLBACK para cualquier
 * fabricante y la base de la que heredan los adaptadores específicos.
 */
import type {
  Counter,
  Manufacturer,
  PrinterInfo,
  PrinterStatus,
  Supply,
  Tray,
  DeviceCondition,
} from "@pdm/types";
import type { PrinterAdapter } from "./printer-adapter.js";
import type { SnmpService } from "../snmp-service.js";
import { SYSTEM, PRINTER, HOST_RESOURCES, INTERFACES } from "../oids.js";
import {
  detectManufacturer,
  classifySupplyColor,
  classifySupplyType,
  supplyPercent,
  ticksToSeconds,
  formatMac,
  normalizeTrayCount,
  paperSizeFromDims,
  capacityUnitLabel,
} from "../parsers.js";

export class StandardPrinterAdapter implements PrinterAdapter {
  readonly manufacturer: Manufacturer = "UNKNOWN";

  async detect(
    _snmp: SnmpService,
    _sysObjectId?: string,
    _sysDescr?: string,
  ): Promise<boolean> {
    return true; // fallback universal
  }

  async getInfo(snmp: SnmpService): Promise<PrinterInfo> {
    const [sysDescr, sysObjectId, sysName, sysLocation, uptime, serial, printerName, macRaw] =
      await Promise.all([
        snmp.getString(SYSTEM.sysDescr, "getInfo:sysDescr"),
        snmp.getString(SYSTEM.sysObjectID, "getInfo:sysObjectID"),
        snmp.getString(SYSTEM.sysName, "getInfo:sysName"),
        snmp.getString(SYSTEM.sysLocation, "getInfo:sysLocation"),
        snmp.getNumber(SYSTEM.sysUpTime, "getInfo:sysUpTime"),
        snmp.getString(PRINTER.serialNumber, "getInfo:serial"),
        snmp.getString(PRINTER.printerName, "getInfo:printerName"),
        snmp.getRaw(INTERFACES.physAddress + ".1", "getInfo:mac"),
      ]);

    const manufacturer = detectManufacturer(sysObjectId, sysDescr);

    return {
      manufacturer,
      model: printerName ?? this.deriveModel(sysDescr),
      serialNumber: serial,
      deviceName: sysName,
      hostname: sysName,
      macAddress: formatMac(macRaw),
      location: sysLocation,
      description: sysDescr,
      uptimeSeconds: uptime !== undefined ? ticksToSeconds(uptime) : undefined,
      sysObjectId,
      sysDescr,
    };
  }

  async getSupplies(snmp: SnmpService): Promise<Supply[]> {
    const [descr, types, maxCap, levels] = await Promise.all([
      snmp.walkIndexed(PRINTER.suppliesDescription, "getSupplies:descr"),
      snmp.walkIndexed(PRINTER.suppliesType, "getSupplies:type"),
      snmp.walkIndexed(PRINTER.suppliesMaxCapacity, "getSupplies:max"),
      snmp.walkIndexed(PRINTER.suppliesLevel, "getSupplies:level"),
    ]);

    const supplies: Supply[] = [];
    for (const [index, rawName] of descr) {
      const name = String(rawName ?? "").trim() || `Supply ${index}`;
      const level = Number(levels.get(index) ?? -1);
      const maxCapacity = Number(maxCap.get(index) ?? -1);
      const typeCode = Number(types.get(index) ?? 0);
      const type = classifySupplyType(typeCode, name);
      let color = classifySupplyColor(name);
      // Impresora monocromo: el tóner único suele llamarse solo "Toner"/"Tóner"
      // (sin indicar color). Al ser de tipo TONER y sin color detectado, se
      // trata como NEGRO para que aparezca en la columna "Toner (K)".
      if (color === "OTHER" && type === "TONER") color = "BLACK";
      supplies.push({
        name,
        type,
        color,
        level,
        maxCapacity,
        percent: supplyPercent(level, maxCapacity),
      });
    }
    return supplies;
  }

  async getCounters(snmp: SnmpService): Promise<Counter[]> {
    const counters: Counter[] = [];
    // prtMarkerLifeCount — puede haber varios marcadores; tomamos el mayor
    // como total de páginas de vida del dispositivo.
    const life = await snmp.walk(PRINTER.markerLifeCount, "getCounters:life");
    const values = life
      .map((vb) => Number(vb.value))
      .filter((n) => Number.isFinite(n));
    if (values.length) {
      counters.push({ type: "TOTAL", value: Math.max(...values) });
    }
    return counters;
  }

  async getTrays(snmp: SnmpService): Promise<Tray[]> {
    const [descr, maxCap, level, media, feedDir, xFeedDir, dimUnit, capUnit] = await Promise.all([
      snmp.walkIndexed(PRINTER.inputDescription, "getTrays:descr"),
      snmp.walkIndexed(PRINTER.inputMaxCapacity, "getTrays:max"),
      snmp.walkIndexed(PRINTER.inputCurrentLevel, "getTrays:level"),
      snmp.walkIndexed(PRINTER.inputMediaName, "getTrays:media"),
      snmp.walkIndexed(PRINTER.inputMediaDimFeedDir, "getTrays:feedDir"),
      snmp.walkIndexed(PRINTER.inputMediaDimXFeedDir, "getTrays:xFeedDir"),
      snmp.walkIndexed(PRINTER.inputDimUnit, "getTrays:dimUnit"),
      snmp.walkIndexed(PRINTER.inputCapacityUnit, "getTrays:capUnit"),
    ]);

    const trays: Tray[] = [];
    for (const [index, rawName] of descr) {
      // Normaliza los centinelas negativos (−1/−2/−3) a "desconocido".
      const current = normalizeTrayCount(level.get(index));
      const capacity = normalizeTrayCount(maxCap.get(index));
      // Tamaño físico real derivado de las dimensiones; el "MediaName" pasa a
      // ser el TIPO de papel (no el tamaño, como se mostraba antes).
      const paperSize = paperSizeFromDims(feedDir.get(index), xFeedDir.get(index), dimUnit.get(index));
      const rawType = media.has(index) ? String(media.get(index)).trim() : "";

      trays.push({
        name: String(rawName ?? "").trim() || `Tray ${index}`,
        paperSize,
        paperType: rawType || undefined,
        capacity,
        currentLevel: current,
        capacityUnit: capacityUnitLabel(capUnit.get(index)),
        isEmpty: current === 0,
      });
    }
    return trays;
  }

  async getStatus(snmp: SnmpService): Promise<PrinterStatus> {
    const printerStatus = await snmp.walk(HOST_RESOURCES.printerStatus, "getStatus");
    const conditions: DeviceCondition[] = [];

    // hrPrinterStatus: 3=idle 4=printing 5=warmup
    const code = printerStatus.length ? Number(printerStatus[0].value) : undefined;
    if (code === 3) conditions.push("READY");
    else if (code === 4) conditions.push("PRINTING");

    return {
      online: "ONLINE", // si respondió SNMP, está online
      conditions: conditions.length ? conditions : ["READY"],
      raw: code !== undefined ? `hrPrinterStatus=${code}` : undefined,
    };
  }

  protected deriveModel(sysDescr?: string): string | undefined {
    if (!sysDescr) return undefined;
    // Primera línea / primeros tokens suelen contener el modelo.
    const firstSegment = sysDescr.split("/")[0].trim();
    return firstSegment || sysDescr;
  }
}
