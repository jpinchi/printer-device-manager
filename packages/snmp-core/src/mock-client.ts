/**
 * Cliente SNMP simulado (fixtures). Se usa con SNMP_MOCK=true.
 *
 * - Cualquier IP que termine en ".254" se comporta como offline (sin respuesta).
 * - Si se inyecta un `fixture` explícito, se usa ese (tests de adaptador).
 * - Si NO se inyecta fixture, se resuelve por host contra `HOST_FIXTURES`
 *   (Fase 8: permite que probe() en modo mock simule distintos fabricantes por
 *   host). Cualquier host no listado cae al fixture RICOH por defecto, de modo
 *   que el comportamiento previo (RICOH por defecto, .254 offline) se conserva.
 */
import type { SnmpClient, VarBind } from "./snmp-client.js";
import { ricohImC4500Fixture } from "./fixtures/ricoh-im-c4500.js";
import { hpLaserJetFixture } from "./fixtures/hp-laserjet.js";
import { canonImageRunnerFixture } from "./fixtures/canon-imagerunner.js";
import { brotherMfcFixture } from "./fixtures/brother-mfc.js";
import { kyoceraTaskalfaFixture } from "./fixtures/kyocera-taskalfa.js";
import { xeroxVersaLinkFixture } from "./fixtures/xerox-versalink.js";
import { lexmarkCxFixture } from "./fixtures/lexmark-cx.js";

/**
 * Registro host → fixture (ADITIVO). Solo aplica cuando NO se inyecta un
 * fixture explícito. Estos hosts convencionales dejan probar probe() end-to-end
 * en modo mock para cada fabricante. Cualquier otro host usa RICOH por defecto.
 */
export const HOST_FIXTURES: Record<string, Record<string, unknown>> = {
  "10.0.0.11": hpLaserJetFixture,
  "10.0.0.16": canonImageRunnerFixture,
  "10.0.0.24": brotherMfcFixture,
  "10.0.0.13": kyoceraTaskalfaFixture,
  "10.0.0.25": xeroxVersaLinkFixture,
  "10.0.0.64": lexmarkCxFixture,
};

export class MockSnmpClient implements SnmpClient {
  private readonly table: Record<string, unknown>;
  private readonly offline: boolean;

  constructor(host: string, fixture?: Record<string, unknown>) {
    this.offline = host.endsWith(".254");
    // Prioridad: fixture inyectado > registro por host > RICOH por defecto.
    this.table = fixture ?? HOST_FIXTURES[host] ?? ricohImC4500Fixture;
  }

  async get(oids: string[]): Promise<VarBind[]> {
    if (this.offline) return [];
    const out: VarBind[] = [];
    for (const oid of oids) {
      if (oid in this.table) out.push({ oid, value: this.table[oid] });
    }
    return out;
  }

  async walk(baseOid: string): Promise<VarBind[]> {
    if (this.offline) return [];
    const prefix = baseOid.endsWith(".") ? baseOid : baseOid + ".";
    return Object.entries(this.table)
      .filter(([oid]) => oid === baseOid || oid.startsWith(prefix))
      .map(([oid, value]) => ({ oid, value }));
  }

  async set(): Promise<{ ok: boolean; error: string | null }> {
    // El mock simula escritura correcta sin persistir nada.
    return this.offline ? { ok: false, error: "mock offline" } : { ok: true, error: null };
  }

  close(): void {
    /* no-op */
  }
}
