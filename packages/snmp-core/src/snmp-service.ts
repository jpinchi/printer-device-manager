/**
 * SNMPService — capa de alto nivel sobre el cliente SNMP.
 *
 * Corresponde a la interfaz descrita en la sección 9 del plan. Los adaptadores
 * lo usan para leer OIDs sin conocer el transporte (real vs mock) ni gestionar
 * sesiones. Acumula errores por operación en vez de lanzarlos (sección 34).
 */
import type { SnmpCredentials, ProbeError } from "@pdm/types";
import { RealSnmpClient, decodeOctetString, type SnmpClient, type VarBind } from "./snmp-client.js";
import { MockSnmpClient } from "./mock-client.js";

export interface SnmpServiceOptions {
  mock?: boolean;
}

export class SnmpService {
  private client: SnmpClient;
  readonly errors: ProbeError[] = [];

  constructor(
    readonly host: string,
    creds: SnmpCredentials,
    opts: SnmpServiceOptions = {},
  ) {
    this.client = opts.mock
      ? new MockSnmpClient(host)
      : new RealSnmpClient(host, creds);
  }

  /** Lee un OID escalar como string. Devuelve undefined si no está. */
  async getString(oid: string, operation = "get"): Promise<string | undefined> {
    const v = await this.getRaw(oid, operation);
    if (v === undefined || v === null) return undefined;
    if (Buffer.isBuffer(v)) return decodeOctetString(v);
    return String(v);
  }

  /** Lee un OID escalar como número. */
  async getNumber(oid: string, operation = "get"): Promise<number | undefined> {
    const v = await this.getRaw(oid, operation);
    if (v === undefined || v === null) return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }

  /** Lee el valor crudo de un OID escalar. */
  async getRaw(oid: string, operation = "get"): Promise<unknown> {
    try {
      const vb = await this.client.get([oid]);
      return vb.length ? vb[0].value : undefined;
    } catch (err) {
      this.recordError(operation, oid, err);
      return undefined;
    }
  }

  /** Walk de una columna; devuelve pares {oid, value}. */
  async walk(baseOid: string, operation = "walk"): Promise<VarBind[]> {
    try {
      return await this.client.walk(baseOid);
    } catch (err) {
      this.recordError(operation, baseOid, err);
      return [];
    }
  }

  /**
   * Walk que indexa por sufijo de índice de fila. Útil para unir columnas de
   * una tabla Printer-MIB (p.ej. descripción + nivel + capacidad).
   */
  async walkIndexed(
    baseOid: string,
    operation = "walk",
  ): Promise<Map<string, unknown>> {
    const rows = await this.walk(baseOid, operation);
    const map = new Map<string, unknown>();
    const prefix = baseOid.endsWith(".") ? baseOid : baseOid + ".";
    for (const { oid, value } of rows) {
      const index = oid.startsWith(prefix) ? oid.slice(prefix.length) : oid;
      map.set(index, value);
    }
    return map;
  }

  /** ¿El dispositivo respondió a un GET básico? (alcanzabilidad SNMP) */
  async isReachable(oid: string): Promise<boolean> {
    const vb = await this.client.get([oid]).catch(() => []);
    return vb.length > 0;
  }

  recordError(operation: string, oid: string | undefined, err: unknown): void {
    this.errors.push({
      operation,
      oid,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  close(): void {
    this.client.close();
  }
}
