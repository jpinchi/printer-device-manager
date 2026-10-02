/**
 * CLI de demostración del motor de descubrimiento.
 *
 * Uso:
 *   SNMP_MOCK=true npx tsx packages/discovery/src/cli.ts 10.0.0.1 10.0.0.5
 *   SNMP_MOCK=true npx tsx packages/discovery/src/cli.ts 10.0.0.0/29
 *
 * En modo mock, TODA IP que no termine en ".254" responde como la RICOH de
 * fixture; las .254 salen offline. Sirve para validar el flujo completo sin
 * impresoras reales (sección 36).
 */
import type { SnmpCredentials } from "@pdm/types";
import { scanRange, InvalidRangeError } from "./index.js";

function usage(): void {
  console.log(
    [
      "Uso:",
      "  tsx packages/discovery/src/cli.ts <startIp> <endIp>",
      "  tsx packages/discovery/src/cli.ts <cidr>",
      "",
      "Ejemplo (modo mock):",
      "  SNMP_MOCK=true npx tsx packages/discovery/src/cli.ts 10.0.0.1 10.0.0.5",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  // Rango: un CIDR ("a.b.c.d/n") o un par (start end).
  const range =
    args.length === 1 ? args[0] : { start: args[0], end: args[1] };

  const mock = process.env.SNMP_MOCK === "true";
  const credentials: SnmpCredentials = {
    version: "v2c",
    community: process.env.SNMP_COMMUNITY ?? "public",
    timeoutMs: Number(process.env.SNMP_TIMEOUT_MS ?? 2000),
  };

  console.log("Network Discovery");
  console.log(`  Rango:        ${JSON.stringify(range)}`);
  console.log(`  SNMP:         ${credentials.version} (mock=${mock})`);
  console.log(`  Concurrencia: ${process.env.SCAN_CONCURRENCY ?? 16}`);
  console.log("  Escaneando...\n");

  try {
    const result = await scanRange(range, {
      credentials,
      mock,
      concurrency: Number(process.env.SCAN_CONCURRENCY ?? 16),
      timeoutMs: credentials.timeoutMs,
      onProgress: (d, total, dev) => {
        const tag = dev.reachable
          ? dev.isPrinter
            ? `${dev.manufacturer} ${dev.model ?? ""}`.trim()
            : "dispositivo (no impresora)"
          : "sin respuesta";
        console.log(`  [${d}/${total}] ${dev.ip.padEnd(15)} -> ${tag}`);
      },
    });

    console.log("\nScan completed\n");
    console.log(`${result.reachableCount} network devices discovered`);
    console.log(`${result.printersFound} printers found (tras dedupe)\n`);
    for (const [maker, count] of Object.entries(result.byManufacturer)) {
      console.log(`  ${count} ${maker}`);
    }
    if (mock && result.reachableCount > result.totalDevices) {
      console.log(
        `\n  Nota: en mock todas las IPs comparten el mismo fixture ` +
          `(mismo MAC/serial),\n  por lo que el dedupe (sección 26) las colapsa ` +
          `a ${result.totalDevices} dispositivo(s) único(s).`,
      );
    }
    console.log(
      `\n(IPs sondeadas: ${result.scannedIps}, respondieron: ${result.reachableCount}, ` +
        `únicos: ${result.totalDevices}, duración: ${result.durationMs} ms)`,
    );
  } catch (err) {
    if (err instanceof InvalidRangeError) {
      console.error(`Rango inválido: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
