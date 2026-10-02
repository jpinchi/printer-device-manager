# Runbook de integración — Oleada 1

Pasos que ejecuta el **orquestador** cuando aterrizan los 3 agentes (Discovery,
Polling, RICOH avanzado). Objetivo: ensamblar sin romper contratos y verificar
todo el monorepo junto.

> Regla mientras haya agentes activos: **no editar `apps/server/src/index.ts`**
> (dominio del agente de Polling). Los snippets de abajo se aplican SOLO cuando
> los agentes hayan terminado.

## Estado de dependencias de integración

| Pieza | Estado |
|-------|--------|
| Hook del scheduler de polling en `index.ts` | ✅ Ya integrado por el agente de Polling (`startPolling(prisma)` tras `app.listen`, protegido por `POLLING_ENABLED`). |
| Enriquecimiento RICOH en el flujo | ✅ Automático — `probe()` ya usa `selectAdapter()` que devuelve `RicohPrinterAdapter`; no requiere wiring. |
| Endpoints de Discovery (`/api/discovery/*`) | ⏳ Pendiente — aplicar snippet tras confirmar la API de `@pdm/discovery`. |
| `docs/api.md` (mover endpoints de "planificados" a "implementados") | ⏳ Pendiente. |

## Al aterrizar cada agente

### Discovery (Fase 2)
1. Leer su reporte y confirmar los **exports reales** de `@pdm/discovery` (parser
   de rangos, función de escaneo, dedupe, tipo de resultado). Reconciliar el
   snippet del router con esas firmas.
2. Crear `apps/server/src/discovery-routes.ts` (ver snippet) y montarlo en
   `index.ts` con una edición mínima.
3. Mover `POST /api/discovery/scan` y `GET /api/discovery/results` de
   "planificados" a "implementados" en `docs/api.md`.
4. Enganchar en el dashboard mínimo un botón de "Scan" (opcional; el frontend
   completo es Oleada 2).

### Polling (Fase 4)
1. Verificar que existe `runPollingCycle()` (pasada única, testeable) y
   `startPolling()` (scheduler). Confirmar que respeta `POLLING_ENABLED` y los
   intervalos de `.env.example`.
2. Confirmar que **NO** cambió `prisma/schema.prisma` (contrato congelado). Si
   pidió un campo nuevo, evaluarlo como cambio de contrato coordinado.
3. Comprobar detección Online/Offline y `lastSeen`.

### RICOH avanzado (Fase 7)
1. Confirmar que `tests/probe.test.ts` (suite existente) sigue verde: el
   enriquecimiento debe ser **aditivo**.
2. Revisar `docs/ricoh-oids.md`: separar OIDs verificados de los asumidos.
3. **Firmware y contadores por función** SÍ están en el fixture compartido
   `ricoh-im-c4500.ts` → aparecen en el mock por defecto. Los **consumibles
   avanzados** (waste toner, drum, fuser, maintenance kit) se aislaron en
   `ricoh-im-c4500-advanced.ts` para no romper el escaneo de Discovery (que
   espera 4 consumibles estándar). Por eso, en el mock por defecto, el smoke
   marca los consumibles avanzados como PENDING; para ejercitarlos hace falta
   un `SnmpService`/probe que use el fixture `-advanced`. Considerar un
   `SNMP_MOCK_FIXTURE=advanced` en integración si se quiere verlos vía HTTP.

## Snippet: router de Discovery (aplicar tras confirmar la API real)

`apps/server/src/discovery-routes.ts` (firmas confirmadas por el reporte del agente):

```ts
import { Router } from "express";
import type { SnmpCredentials } from "@pdm/types";
// API pública real de @pdm/discovery (confirmada):
import { scanRange, type DiscoveryResult } from "@pdm/discovery";
import { config } from "./config.js";

export const discoveryRouter = Router();

// Último resultado en memoria (persistir en BD es trabajo posterior).
let lastResult: DiscoveryResult | null = null;

discoveryRouter.post("/scan", async (req, res) => {
  const { startIp, endIp, cidr, community, version, concurrency } = req.body ?? {};
  const credentials: SnmpCredentials = {
    version: version ?? config.snmp.defaultVersion,
    community: community ?? config.snmp.defaultCommunity,
    timeoutMs: config.snmp.timeoutMs,
    retries: config.snmp.retries,
  };
  try {
    // range: { start, end } o una cadena CIDR. credentials va DENTRO de options.
    const range = cidr ? cidr : { start: startIp, end: endIp };
    lastResult = await scanRange(range, {
      credentials,
      mock: config.snmp.mock,
      concurrency: concurrency ?? 16,
      timeoutMs: config.snmp.timeoutMs,
    });
    res.json(lastResult); // ya sin credenciales (sección 23.5)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

discoveryRouter.get("/results", (_req, res) => {
  res.json(lastResult ?? { devices: [], printersFound: 0, totalDevices: 0 });
});
```

> **Nota mock (del reporte de Discovery):** el fixture devuelve el mismo MAC/serial
> para toda IP, así que el dedupe (sección 26) colapsa el rango a **1 dispositivo**.
> Por eso `DiscoveryResult` expone `reachableCount` (antes de dedupe) y
> `totalDevices` (después). Con hardware real cada equipo tiene identidad propia.

Edición mínima en `index.ts` (una vez Polling haya terminado):

```ts
import { discoveryRouter } from "./discovery-routes.js";
// ...después de app.use(express.json()):
app.use("/api/discovery", discoveryRouter);
```

## Verificación global (tras el merge de los 3)

```bash
# 1. Tipos de TODO el monorepo juntos
npx tsc -p tsconfig.base.json --noEmit

# 2. Suite completa
npx vitest run

# 3. Smoke test end-to-end en modo mock (arranca el server aparte primero)
SNMP_MOCK=true POLLING_ENABLED=false npm run server   # en una terminal
node scripts/smoke.mjs                                 # en otra
```

`scripts/smoke.mjs` ejercita: health → alta por SNMP → detalle → (discovery scan
cuando esté montado) → poll manual → verifica campos RICOH enriquecidos. Las
partes aún no cableadas están marcadas como `PENDING` y no hacen fallar el script.

## Rollback / seguridad
- Todo el andamiaje nuevo (router, smoke) es **aditivo**; si algo falla, se
  desmonta quitando el `app.use("/api/discovery", ...)`.
- No se toca ningún contrato en la integración. Cambios de contrato = decisión
  del orquestador, no de un agente.
