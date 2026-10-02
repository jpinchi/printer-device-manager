/**
 * Cliente SNMP de bajo nivel. Envuelve `net-snmp` en promesas y aplica
 * tolerancia a fallos por-OID (sección 34): un OID inexistente NO aborta la
 * consulta completa.
 */
import snmp, { type Session, type VarBind as SnmpVarBind } from "net-snmp";
import type { SnmpCredentials } from "@pdm/types";

export interface VarBind {
  oid: string;
  value: unknown;
}

/** Tipo ASN.1 de un valor a escribir por SNMP SET. */
export type SnmpSetType = "OctetString" | "IpAddress" | "Integer" | "Gauge";

/** Un varbind a escribir (SET). */
export interface SetVarBind {
  oid: string;
  type: SnmpSetType;
  value: string | number;
}

/** Resultado de un SNMP SET. */
export interface SetResult {
  ok: boolean;
  error: string | null;
}

export interface SnmpClient {
  /** GET de varios OIDs; devuelve solo los que respondieron con valor. */
  get(oids: string[]): Promise<VarBind[]>;
  /** WALK de un subárbol (columna). */
  walk(baseOid: string): Promise<VarBind[]>;
  /** SET de uno o varios OIDs (requiere community de escritura). */
  set(varbinds: SetVarBind[]): Promise<SetResult>;
  close(): void;
}

function versionConst(v: SnmpCredentials["version"]): number {
  if (v === "v1") return snmp.Version1;
  return snmp.Version2c; // v3 se añadirá en fase futura
}

/**
 * Decodifica un OCTET STRING de SNMP a texto. Muchas impresoras envían el texto
 * en Latin-1 (ISO-8859-1), no en UTF-8, así que "Tóner" llega como bytes que al
 * decodificar como UTF-8 producen el carácter de reemplazo "�". Estrategia:
 * intentar UTF-8; si aparece "�" (o bytes altos sueltos, típicos de Latin-1),
 * reintentar como Latin-1.
 */
export function decodeOctetString(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  if (utf8.includes("�")) return buf.toString("latin1");
  return utf8;
}

/** Convierte valores crudos de net-snmp a string/number utilizables. */
export function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    // Heurística: si es imprimible, string; si no, deja el buffer (p.ej. MAC).
    const str = decodeOctetString(value);
    // eslint-disable-next-line no-control-regex
    return /[\x00-\x08\x0e-\x1f]/.test(str) ? value : str;
  }
  if (typeof value === "bigint") return Number(value);
  return value;
}

export class RealSnmpClient implements SnmpClient {
  private session: Session;

  constructor(host: string, creds: SnmpCredentials) {
    this.session = snmp.createSession(host, creds.community, {
      version: versionConst(creds.version),
      timeout: creds.timeoutMs ?? 3000,
      retries: creds.retries ?? 1,
    });
  }

  get(oids: string[]): Promise<VarBind[]> {
    return new Promise((resolve) => {
      this.session.get(oids, (error: Error | null, varbinds: SnmpVarBind[]) => {
        if (error) {
          resolve([]);
          return;
        }
        const out: VarBind[] = [];
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue; // noSuchObject / noSuchInstance
          out.push({ oid: vb.oid, value: normalizeValue(vb.value) });
        }
        resolve(out);
      });
    });
  }

  walk(baseOid: string): Promise<VarBind[]> {
    return new Promise((resolve) => {
      const out: VarBind[] = [];
      this.session.subtree(
        baseOid,
        (varbinds: SnmpVarBind[]) => {
          for (const vb of varbinds) {
            if (snmp.isVarbindError(vb)) continue;
            out.push({ oid: vb.oid, value: normalizeValue(vb.value) });
          }
        },
        (_error: Error | null) => {
          // Un error al final del walk no invalida lo ya recolectado.
          resolve(out);
        },
      );
    });
  }

  set(varbinds: SetVarBind[]): Promise<SetResult> {
    const mapped = varbinds.map((vb) => ({
      oid: vb.oid,
      type: snmp.ObjectType[vb.type],
      value: vb.value,
    }));
    return new Promise((resolve) => {
      try {
        this.session.set(mapped, (error: Error | null, vbs: SnmpVarBind[]) => {
          if (error) {
            resolve({ ok: false, error: error.message });
            return;
          }
          for (const vb of vbs ?? []) {
            if (snmp.isVarbindError(vb)) {
              resolve({ ok: false, error: snmp.varbindError(vb) });
              return;
            }
          }
          resolve({ ok: true, error: null });
        });
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  close(): void {
    try {
      this.session.close();
    } catch {
      /* ignore */
    }
  }
}
