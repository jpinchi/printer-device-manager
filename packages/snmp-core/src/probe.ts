/**
 * probe() — el NÚCLEO del proyecto (secciones 14, 37 y 41).
 *
 * Dada una IP y credenciales SNMP, ejecuta el flujo completo:
 *   alcanzable? -> sysDescr/sysObjectID -> ¿es impresora? -> fabricante ->
 *   adaptador -> recolectar info/consumibles/contadores/bandejas/estado -> JSON
 *
 * Es tolerante a fallos: un OID no soportado se registra en `errors` pero no
 * aborta el resto (sección 34).
 */
import type { ProbeResult, SnmpCredentials } from "@pdm/types";
import { SnmpService } from "./snmp-service.js";
import { SYSTEM, PRINTER } from "./oids.js";
import { detectManufacturer, looksLikePrinter } from "./parsers.js";
import { selectAdapter } from "./adapters/adapter-factory.js";

/** Recolectores individuales del probe (mapeables a los pollers por cadencia). */
export type ProbeCollector = "info" | "supplies" | "counters" | "trays" | "status";

export interface ProbeOptions {
  mock?: boolean;
  /**
   * Qué recolectores ejecutar. Por defecto TODOS. Los omitidos devuelven vacío
   * o su valor por defecto SIN leer sus OIDs/tablas por SNMP. Lo usa el polling
   * por cadencia (sección 16) para no recorrer, p. ej., la tabla de consumibles
   * en cada tick de 45s cuando su intervalo es de 5 min: solo se lee lo vencido.
   */
  collect?: ProbeCollector[];
}

export async function probe(
  ip: string,
  creds: SnmpCredentials,
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const snmp = new SnmpService(ip, creds, { mock: opts.mock });
  const queriedAt = new Date().toISOString();

  try {
    // 1. Alcanzabilidad SNMP (sysDescr básico)
    const sysDescr = await snmp.getString(SYSTEM.sysDescr, "probe:sysDescr");
    const reachable = sysDescr !== undefined;

    if (!reachable) {
      return {
        ip,
        reachable: false,
        isPrinter: false,
        info: { manufacturer: "UNKNOWN" },
        supplies: [],
        counters: [],
        trays: [],
        status: { online: "OFFLINE", conditions: ["UNKNOWN"] },
        errors: snmp.errors,
        queriedAt,
      };
    }

    // 2. Identidad
    const sysObjectId = await snmp.getString(SYSTEM.sysObjectID, "probe:sysObjectID");

    // 3. ¿Es impresora? (Printer-MIB presente o heurística de sysDescr)
    const serial = await snmp.getString(PRINTER.serialNumber, "probe:serial");
    const hasPrinterMib = serial !== undefined;
    const isPrinter = looksLikePrinter(sysDescr, hasPrinterMib);

    // 4. Detectar fabricante y seleccionar adaptador
    const manufacturer = detectManufacturer(sysObjectId, sysDescr);
    const adapter = selectAdapter(manufacturer);

    // 5. Recolectar SOLO lo pedido (cada bloque tolera sus propios fallos). Los
    //    recolectores omitidos no leen SNMP y devuelven su valor por defecto;
    //    el ciclo de polling solo persiste lo que pidió, así que no hay pérdida.
    const want = opts.collect ? new Set<ProbeCollector>(opts.collect) : null;
    const run = (k: ProbeCollector) => want === null || want.has(k);
    const [info, supplies, counters, trays, status] = await Promise.all([
      run("info") ? adapter.getInfo(snmp) : Promise.resolve({ manufacturer }),
      run("supplies") ? adapter.getSupplies(snmp) : Promise.resolve([]),
      run("counters") ? adapter.getCounters(snmp) : Promise.resolve([]),
      run("trays") ? adapter.getTrays(snmp) : Promise.resolve([]),
      run("status") ? adapter.getStatus(snmp) : Promise.resolve<ProbeResult["status"]>({ online: "ONLINE", conditions: [] }),
    ]);

    return {
      ip,
      reachable: true,
      isPrinter,
      info,
      supplies,
      counters,
      trays,
      status,
      errors: snmp.errors,
      queriedAt,
    };
  } finally {
    snmp.close();
  }
}
