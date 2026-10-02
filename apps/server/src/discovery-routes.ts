/**
 * Rutas de descubrimiento de red (Fase 2). Integra el motor `@pdm/discovery`.
 *
 * `POST /api/discovery/scan`  — escanea un rango IP (start/end o CIDR) por SNMP.
 * `GET  /api/discovery/results` — devuelve el último resultado en memoria.
 *
 * Las credenciales SNMP NO se devuelven al cliente (sección 23.5): `scanRange`
 * ya entrega un `DiscoveryResult` plano sin community.
 */
import { Router } from "express";
import type { SnmpCredentials } from "@pdm/types";
import { scanRange, type DiscoveryResult, type RangeInput } from "@pdm/discovery";
import { config } from "./config.js";

export const discoveryRouter = Router();

// Último resultado en memoria (persistir en BD es trabajo de una fase posterior).
let lastResult: DiscoveryResult | null = null;

discoveryRouter.post("/scan", async (req, res) => {
  const { startIp, endIp, cidr, community, version, concurrency } = req.body ?? {};

  // range: cadena CIDR, o { start, end }.
  const range: RangeInput = cidr
    ? String(cidr)
    : { start: String(startIp ?? ""), end: String(endIp ?? "") };

  const credentials: SnmpCredentials = {
    version: version ?? config.snmp.defaultVersion,
    community: community ?? config.snmp.defaultCommunity,
    timeoutMs: config.snmp.timeoutMs,
    retries: config.snmp.retries,
  };

  try {
    lastResult = await scanRange(range, {
      credentials,
      mock: config.snmp.mock,
      // Acotado: evita que un cliente pida miles de sesiones SNMP simultáneas.
      concurrency: Math.min(typeof concurrency === "number" ? concurrency : 16, 64),
      timeoutMs: config.snmp.timeoutMs,
    });
    res.json(lastResult);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

discoveryRouter.get("/results", (_req, res) => {
  res.json(
    lastResult ?? {
      scannedIps: 0,
      reachableCount: 0,
      totalDevices: 0,
      printersFound: 0,
      byManufacturer: {},
      devices: [],
      durationMs: 0,
    },
  );
});
