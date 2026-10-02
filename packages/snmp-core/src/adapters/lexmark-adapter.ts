/**
 * LexmarkPrinterAdapter — soporte Lexmark (Fase 8, secciones 11 y 32).
 *
 * Hereda TODO el comportamiento estándar del StandardPrinterAdapter. Solo
 * sobreescribe `manufacturer` = "LEXMARK" y `detect()` por número de empresa
 * del sysObjectID (641), con fallback al texto de sysDescr (patrón RICOH).
 *
 * Enriquecimiento privado MÍNIMO y TOLERANTE: intenta rellenar el firmware con
 * un OID privado Lexmark SOLO si el estándar no lo trajo. El OID es ASUMIDO
 * (ver oids.ts); si el modelo no lo expone, se conserva intacto lo estándar.
 */
import type { Manufacturer, PrinterInfo } from "@pdm/types";
import { StandardPrinterAdapter } from "./standard-adapter.js";
import type { SnmpService } from "../snmp-service.js";
import { enterpriseNumberOf } from "../parsers.js";
import { LEXMARK } from "../oids.js";

export class LexmarkPrinterAdapter extends StandardPrinterAdapter {
  override readonly manufacturer: Manufacturer = "LEXMARK";

  override async detect(
    _snmp: SnmpService,
    sysObjectId?: string,
    sysDescr?: string,
  ): Promise<boolean> {
    if (enterpriseNumberOf(sysObjectId) === 641) return true;
    return (sysDescr ?? "").toUpperCase().includes("LEXMARK");
  }

  override async getInfo(snmp: SnmpService): Promise<PrinterInfo> {
    const info = await super.getInfo(snmp);
    if (info.firmware && info.firmware.trim()) return info;

    const firmware = await snmp.getString(LEXMARK.firmwareVersion, "lexmark:getInfo:firmware");
    if (firmware && firmware.trim()) {
      return { ...info, firmware: firmware.trim() };
    }
    return info;
  }
}
