/**
 * CONTRATO: interfaz de adaptador de impresora (sección 11).
 *
 * Añadir soporte para un fabricante nuevo = crear una implementación de esta
 * interfaz, SIN tocar el núcleo. El orquestador congela esta firma; los agentes
 * de fabricantes (RICOH, HP, Canon...) implementan contra ella.
 */
import type {
  Counter,
  Manufacturer,
  PrinterInfo,
  PrinterStatus,
  Supply,
  Tray,
} from "@pdm/types";
import type { SnmpService } from "../snmp-service.js";

export interface PrinterAdapter {
  readonly manufacturer: Manufacturer;

  /** ¿Este adaptador es aplicable al dispositivo ya consultado? */
  detect(snmp: SnmpService, sysObjectId?: string, sysDescr?: string): Promise<boolean>;

  getInfo(snmp: SnmpService): Promise<PrinterInfo>;
  getSupplies(snmp: SnmpService): Promise<Supply[]>;
  getCounters(snmp: SnmpService): Promise<Counter[]>;
  getTrays(snmp: SnmpService): Promise<Tray[]>;
  getStatus(snmp: SnmpService): Promise<PrinterStatus>;
}
