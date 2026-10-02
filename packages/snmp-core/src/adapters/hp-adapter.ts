/**
 * HpPrinterAdapter — soporte HP (Fase 8, secciones 11 y 32).
 *
 * Hereda TODO el comportamiento estándar (Printer-MIB / HOST-RESOURCES /
 * MIB-II) del StandardPrinterAdapter. Solo sobreescribe:
 *   - `manufacturer` = "HP"
 *   - `detect()` por número de empresa del sysObjectID (11), con fallback al
 *     texto de sysDescr (patrón RICOH).
 *
 * Enriquecimiento privado MÍNIMO y TOLERANTE: intenta rellenar el firmware con
 * un OID privado HP SOLO si el estándar no lo trajo. El OID es ASUMIDO (ver
 * oids.ts); si el modelo no lo expone, se conserva intacto el resultado
 * estándar. No se añaden enriquecimientos frágiles adicionales.
 */
import type { Manufacturer, PrinterInfo } from "@pdm/types";
import { StandardPrinterAdapter } from "./standard-adapter.js";
import type { SnmpService } from "../snmp-service.js";
import { enterpriseNumberOf } from "../parsers.js";
import { HP } from "../oids.js";

export class HpPrinterAdapter extends StandardPrinterAdapter {
  override readonly manufacturer: Manufacturer = "HP";

  override async detect(
    _snmp: SnmpService,
    sysObjectId?: string,
    sysDescr?: string,
  ): Promise<boolean> {
    if (enterpriseNumberOf(sysObjectId) === 11) return true;
    const d = (sysDescr ?? "").toUpperCase();
    return d.includes("HEWLETT") || /\bHP\b/.test(d) || d.includes("LASERJET");
  }

  override async getInfo(snmp: SnmpService): Promise<PrinterInfo> {
    const info = await super.getInfo(snmp);
    if (info.firmware && info.firmware.trim()) return info;

    const firmware = await snmp.getString(HP.firmwareVersion, "hp:getInfo:firmware");
    if (firmware && firmware.trim()) {
      return { ...info, firmware: firmware.trim() };
    }
    return info;
  }
}
