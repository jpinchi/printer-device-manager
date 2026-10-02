/**
 * RicohPrinterAdapter — soporte prioritario para RICOH (secciones 12 y 31).
 *
 * Hereda TODO el comportamiento del StandardPrinterAdapter y lo ENRIQUECE con
 * lecturas de OIDs privados RICOH (rama 1.3.6.1.4.1.367). Patrón obligatorio de
 * la Fase 7:
 *
 *   1. Llamar primero a `super.getX()` para obtener el resultado estándar.
 *   2. Intentar leer los OIDs privados RICOH de forma TOLERANTE (si el modelo
 *      no los soporta, el SnmpService devuelve undefined y NO se aborta nada).
 *   3. Devolver el resultado estándar ENRIQUECIDO; si un OID RICOH falla, se
 *      conserva intacto lo estándar (regla de oro, secciones 12/33/34).
 *
 * Los OIDs privados son ADITIVOS y OPCIONALES. Nunca se asume que un OID
 * legible pueda escribirse (sección 33). Los sufijos concretos están marcados
 * como ASUMIDO en oids.ts y deben validarse contra hardware real.
 */
import type {
  Counter,
  CounterType,
  Manufacturer,
  PrinterInfo,
  Supply,
  SupplyType,
} from "@pdm/types";
import { StandardPrinterAdapter } from "./standard-adapter.js";
import type { SnmpService } from "../snmp-service.js";
import { enterpriseNumberOf, supplyPercent } from "../parsers.js";
import { RICOH } from "../oids.js";

export class RicohPrinterAdapter extends StandardPrinterAdapter {
  override readonly manufacturer: Manufacturer = "RICOH";

  override async detect(
    _snmp: SnmpService,
    sysObjectId?: string,
    sysDescr?: string,
  ): Promise<boolean> {
    if (enterpriseNumberOf(sysObjectId) === 367) return true;
    const d = (sysDescr ?? "").toUpperCase();
    return d.includes("RICOH") || d.includes("LANIER") || d.includes("SAVIN");
  }

  /**
   * Info estándar + firmware RICOH (privado). Si el OID de firmware no existe,
   * se devuelve la info estándar sin tocar.
   */
  override async getInfo(snmp: SnmpService): Promise<PrinterInfo> {
    const info = await super.getInfo(snmp);

    // Solo consultamos el privado si el estándar no trajo firmware.
    if (info.firmware && info.firmware.trim()) return info;

    const firmware = await snmp.getString(
      RICOH.firmwareVersion,
      "ricoh:getInfo:firmware",
    );
    if (firmware && firmware.trim()) {
      return { ...info, firmware: firmware.trim() };
    }
    return info;
  }

  /**
   * Contadores RICOH mapeados por NOMBRE desde la tabla `…19.5.1` (VERIFICADO
   * contra hardware real IM/MP). Se une la columna de nombre (.5) con la de
   * valor (.9) y se traduce cada nombre conocido a nuestro CounterType. Si el
   * modelo no expone la tabla, se conserva solo el TOTAL del estándar abierto.
   */
  override async getCounters(snmp: SnmpService): Promise<Counter[]> {
    const counters = await super.getCounters(snmp); // TOTAL estándar (prtMarkerLifeCount)

    const names = await snmp.walkIndexed(RICOH.counterTable.nameColumn, "ricoh:counters:names");
    const values = await snmp.walkIndexed(RICOH.counterTable.valueColumn, "ricoh:counters:values");
    if (names.size === 0) {
      // Modelo sin la tabla RICOH: respaldo del TOTAL si el estándar no lo dio.
      if (!counters.some((c) => c.type === "TOTAL")) {
        const total = await snmp.getNumber(RICOH.counterTotalBackup, "ricoh:counters:total");
        if (total !== undefined && Number.isFinite(total)) counters.push({ type: "TOTAL", value: total });
      }
      return counters;
    }

    // Índice nombre → valor.
    const byName = new Map<string, number>();
    for (const [row, rawName] of names) {
      const name = String(rawName ?? "").trim();
      const value = Number(values.get(row));
      if (name && Number.isFinite(value)) byName.set(name, value);
    }
    const sum = (...ns: string[]) => ns.reduce((a, n) => a + (byName.get(n) ?? 0), 0);
    const upsert = (type: CounterType, value: number | undefined) => {
      if (value === undefined || !Number.isFinite(value)) return;
      const idx = counters.findIndex((c) => c.type === type);
      if (idx >= 0) counters[idx] = { type, value };
      else counters.push({ type, value });
    };

    upsert("TOTAL", byName.get("Counter: Machine Total"));
    upsert("COPIES", byName.get("Counter:Copy:Total"));
    upsert("PRINTS", byName.get("Counter:Print:Total"));
    upsert("FAX", byName.get("Counter:FAX:Total"));
    upsert("SCANS", byName.get("Counter:Transmission:Total"));
    upsert("DUPLEX", byName.get("No. of Printed Sides in Duplex"));

    const bw = sum(
      "Counter:Copy:Black & White",
      "Counter:Print:Black & White",
      "Counter:FAX:Black & White",
    );
    if (bw > 0) upsert("BLACK_WHITE", bw);
    const color = sum("Counter:Copy:Full Color", "Counter:Print:Full Color");
    if (color > 0) upsert("COLOR", color);

    return counters;
  }

  /**
   * Consumibles estándar (4 tóneres, etc.) + consumibles avanzados RICOH que
   * Printer-MIB no siempre expone: waste toner, drum, fuser, maintenance kit.
   * Cada uno es un nivel escalar 0-100 y se añade solo si el OID existe.
   */
  override async getSupplies(snmp: SnmpService): Promise<Supply[]> {
    const supplies = await super.getSupplies(snmp);

    const advanced: Array<{ name: string; type: SupplyType; oid: string }> = [
      { name: "Waste Toner Bottle", type: "WASTE_TONER", oid: RICOH.supplies.wasteTonerLevel },
      { name: "Drum Unit", type: "DRUM", oid: RICOH.supplies.drumLevel },
      { name: "Fuser Unit", type: "FUSER", oid: RICOH.supplies.fuserLevel },
      { name: "Maintenance Kit", type: "MAINTENANCE_KIT", oid: RICOH.supplies.maintenanceKitLevel },
    ];

    for (const item of advanced) {
      const level = await snmp.getNumber(item.oid, `ricoh:getSupplies:${item.type}`);
      // OID ausente / no soportado por el modelo: se tolera y se omite.
      if (level === undefined || !Number.isFinite(level)) continue;

      // El nivel RICOH ya viene normalizado 0-100 → capacidad de referencia 100.
      const maxCapacity = 100;
      supplies.push({
        name: item.name,
        type: item.type,
        color: "OTHER",
        level,
        maxCapacity,
        percent: supplyPercent(level, maxCapacity),
      });
    }

    return supplies;
  }
}
