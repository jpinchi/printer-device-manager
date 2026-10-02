/**
 * CLI de diagnóstico — el flujo de la sección 41 aislado:
 *   IP de una RICOH -> SNMP GET -> Printer-MIB -> JSON
 *
 * Uso:
 *   npm run probe -- 192.0.2.51
 *   npm run probe -- 192.0.2.51 --community publico --version v2c
 *   SNMP_MOCK=true npm run probe -- 10.0.0.1     (sin hardware)
 */
import type { SnmpCredentials } from "@pdm/types";
import { probe } from "@pdm/snmp-core";
import { config } from "../config.js";

function parseArgs(argv: string[]) {
  const ip = argv[0];
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i += 2) {
    if (argv[i]?.startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1];
  }
  return { ip, flags };
}

async function main() {
  const { ip, flags } = parseArgs(process.argv.slice(2));
  if (!ip) {
    console.error("Uso: npm run probe -- <ip> [--community <c>] [--version v1|v2c]");
    process.exit(1);
  }

  const creds: SnmpCredentials = {
    version: (flags.version as SnmpCredentials["version"]) ?? config.snmp.defaultVersion,
    community: flags.community ?? config.snmp.defaultCommunity,
    timeoutMs: config.snmp.timeoutMs,
    retries: config.snmp.retries,
  };

  const result = await probe(ip, creds, { mock: config.snmp.mock });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.reachable ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
