// Declaración ambiente mínima para `net-snmp` (el paquete no trae tipos).
// Cubre solo la superficie usada por el proyecto.
declare module "net-snmp" {
  export interface VarBind {
    oid: string;
    value: unknown;
    type?: number;
  }

  export interface SetVarBind {
    oid: string;
    type: number;
    value: unknown;
  }

  export interface Session {
    get(oids: string[], cb: (error: Error | null, varbinds: VarBind[]) => void): void;
    set(varbinds: SetVarBind[], cb: (error: Error | null, varbinds: VarBind[]) => void): void;
    subtree(
      oid: string,
      feedCb: (varbinds: VarBind[]) => void,
      doneCb: (error: Error | null) => void,
    ): void;
    close(): void;
  }

  export const Version1: number;
  export const Version2c: number;
  /** Tipos ASN.1 para SET (OctetString, IpAddress, Integer, …). */
  export const ObjectType: Record<string, number> & {
    Integer: number;
    OctetString: number;
    IpAddress: number;
    Gauge: number;
  };
  export function createSession(
    target: string,
    community: string,
    options?: Record<string, unknown>,
  ): Session;
  export function isVarbindError(vb: VarBind): boolean;
  export function varbindError(vb: VarBind): string;

  const _default: {
    Version1: number;
    Version2c: number;
    ObjectType: typeof ObjectType;
    createSession: typeof createSession;
    isVarbindError: typeof isVarbindError;
    varbindError: typeof varbindError;
  };
  export default _default;
}
