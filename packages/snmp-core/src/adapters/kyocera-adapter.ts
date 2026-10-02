/**
 * KyoceraPrinterAdapter — soporte Kyocera (Fase 8, secciones 11 y 32).
 *
 * Hereda TODO el comportamiento estándar del StandardPrinterAdapter. Solo
 * sobreescribe `manufacturer` = "KYOCERA" y `detect()` por número de empresa
 * del sysObjectID (1347), con fallback al texto de sysDescr (patrón RICOH).
 *
 * Enriquecimiento privado MÍNIMO y TOLERANTE: intenta rellenar el firmware con
 * un OID privado Kyocera SOLO si el estándar no lo trajo. El OID es ASUMIDO
 * (ver oids.ts); si el modelo no lo expone, se conserva intacto lo estándar.
 */
import type { Manufacturer, PrinterInfo } from "@pdm/types";
import { StandardPrinterAdapter } from "./standard-adapter.js";
import type { SnmpService } from "../snmp-service.js";
import { enterpriseNumberOf } from "../parsers.js";
import { KYOCERA } from "../oids.js";

export class KyoceraPrinterAdapter extends StandardPrinterAdapter {
  override readonly manufacturer: Manufacturer = "KYOCERA";

  override async detect(
    _snmp: SnmpService,
    sysObjectId?: string,
    sysDescr?: string,
  ): Promise<boolean> {
    if (enterpriseNumberOf(sysObjectId) === 1347) return true;
    return (sysDescr ?? "").toUpperCase().includes("KYOCERA");
  }

  override async getInfo(snmp: SnmpService): Promise<PrinterInfo> {
    const info = await super.getInfo(snmp);
    if (info.firmware && info.firmware.trim()) return info;

    const firmware = await snmp.getString(KYOCERA.firmwareVersion, "kyocera:getInfo:firmware");
    if (firmware && firmware.trim()) {
      return { ...info, firmware: firmware.trim() };
    }
    return info;
  }
}
