# OIDs RICOH

Rama enterprise: `1.3.6.1.4.1.367`.

Documentación de la **Fase 7 (Soporte avanzado RICOH)** — agente de SNMP/Adapters.
Regla (secciones 12, 33 y 34): **primero OIDs estándar**; los OIDs privados son
**aditivos y opcionales**, se leen de forma **tolerante** (un OID ausente no
aborta nada) y **nunca se asume que un OID legible pueda escribirse**.

## Estándar primero (ya cubierto por StandardPrinterAdapter)

- Modelo/serial: Printer-MIB (`prtGeneralPrinterName`, `prtGeneralSerialNumber`).
- Consumibles: `prtMarkerSupplies*`.
- Contador total: `prtMarkerLifeCount`.

`RicohPrinterAdapter` **hereda** todo esto y solo lo **enriquece**: cada método
llama primero a `super.getX()` (estándar) y después intenta las lecturas RICOH.

## Estado de verificación

| Símbolo | Significado |
|---------|-------------|
| ✅ VERIFICADO | Confirmado por estándar abierto / IANA. |
| ⚠️ ASUMIDO | Placeholder plausible bajo la rama 367. **Debe validarse contra hardware real** antes de confiar en él. Los sufijos privados RICOH varían por modelo/generación y no todos están documentados públicamente. |

> Solo el prefijo enterprise `1.3.6.1.4.1.367` está ✅ VERIFICADO (IANA /
> sysObjectID). Todo lo que cuelga por debajo en esta fase es ⚠️ ASUMIDO.

## OIDs privados RICOH usados (definidos en `packages/snmp-core/src/oids.ts`)

### Base

| Clave | OID | Estado |
|-------|-----|--------|
| `RICOH.enterprise` | `1.3.6.1.4.1.367` | ✅ VERIFICADO |
| `RICOH.base` | `1.3.6.1.4.1.367.3.2.1` | ⚠️ ASUMIDO |

### Firmware

| Clave | OID | Estado |
|-------|-----|--------|
| `RICOH.firmwareVersion` | `1.3.6.1.4.1.367.3.2.1.1.1.6.0` | ⚠️ ASUMIDO |

Se expone como `PrinterInfo.firmware`. Solo se consulta si el estándar no trajo
firmware.

### Contadores por función (escalares) — ❌ DESHABILITADOS

> **Validado contra hardware real (familias IM/MP): estos OIDs NO son fiables.**
> El subárbol `367…19.5.1.9` es una tabla RICOH con decenas de índices cuyos
> valores se repiten (ej. `.9.2 == .9.3`, `.9.6 == .9.7`), de modo que el mapeo
> asumido a BN/color/copias/impresiones/escaneos/fax produce datos duplicados e
> incorrectos. El adaptador **ya NO lee estos contadores por función**; solo
> conserva el **TOTAL** del estándar abierto (`prtMarkerLifeCount`), que sí se
> verificó correcto. Para exponer contadores por función habría que mapearlos
> con la MIB oficial de RICOH por modelo/generación.


| Clave | OID | `CounterType` | Estado |
|-------|-----|---------------|--------|
| `RICOH.counters.total` | `…2.19.5.1.9.1` | `TOTAL` (respaldo) | ⚠️ ASUMIDO |
| `RICOH.counters.blackWhite` | `…2.19.5.1.9.2` | `BLACK_WHITE` | ⚠️ ASUMIDO |
| `RICOH.counters.color` | `…2.19.5.1.9.3` | `COLOR` | ⚠️ ASUMIDO |
| `RICOH.counters.copies` | `…2.19.5.1.9.4` | `COPIES` | ⚠️ ASUMIDO |
| `RICOH.counters.prints` | `…2.19.5.1.9.5` | `PRINTS` | ⚠️ ASUMIDO |
| `RICOH.counters.scans` | `…2.19.5.1.9.6` | `SCANS` | ⚠️ ASUMIDO |
| `RICOH.counters.fax` | `…2.19.5.1.9.7` | `FAX` | ⚠️ ASUMIDO |

Prefijo común: `1.3.6.1.4.1.367.3.2.1`. El `TOTAL` primario sigue viniendo del
estándar (`prtMarkerLifeCount`); `RICOH.counters.total` solo se usa como
respaldo si el estándar no lo entregó (evita duplicar `TOTAL`).

### Consumibles avanzados (nivel escalar 0-100)

| Clave | OID | `SupplyType` | Estado |
|-------|-----|--------------|--------|
| `RICOH.supplies.wasteTonerLevel` | `…2.24.1.1.5.1` | `WASTE_TONER` | ⚠️ ASUMIDO |
| `RICOH.supplies.drumLevel` | `…2.24.1.1.5.2` | `DRUM` | ⚠️ ASUMIDO |
| `RICOH.supplies.fuserLevel` | `…2.24.1.1.5.3` | `FUSER` | ⚠️ ASUMIDO |
| `RICOH.supplies.maintenanceKitLevel` | `…2.24.1.1.5.4` | `MAINTENANCE_KIT` | ⚠️ ASUMIDO |

Prefijo común: `1.3.6.1.4.1.367.3.2.1`. Se añaden a la lista estándar de
consumibles solo si el OID existe; en caso contrario se omiten (tolerancia).

## Fixtures de mock

- `fixtures/ricoh-im-c4500.ts` — fixture compartido. Extendido de forma
  **aditiva** con firmware + contadores por función. **No** incluye consumibles
  avanzados a propósito (otros consumidores esperan los 4 consumibles estándar).
- `fixtures/ricoh-im-c4500-advanced.ts` — extiende el anterior con los OIDs de
  consumibles avanzados para ejercitar `getSupplies` sin alterar el contrato del
  fixture base.

## A validar contra RICOH real (antes de confiar en los privados)

- Confirmar los sufijos exactos por familia/generación:
  - Familia **MP** (controladores GW/GWNX) vs familia **IM** (p.ej. IM C4500).
  - Impresoras A3 color vs A4 monocromo vs producción/large format.
- Verificar unidades de los contadores (páginas vs impresiones A4-equivalentes)
  y si el color/BN se reportan por separado o combinados.
- Verificar la escala real de los consumibles avanzados (¿0-100? ¿otra unidad /
  capacidad máxima?), y si el drum/fuser se reportan por color.
- Descartar OIDs de escritura: mantener todo **read-only** (sección 33).

## Checklist Fase 7 (sección 31)

- [x] Identificar MIBs/OIDs RICOH relevantes (rama 367; sufijos marcados ASUMIDO)
- [x] Crear RicohPrinterAdapter (enriquece al StandardPrinterAdapter)
- [x] Firmware
- [x] Contadores avanzados (por función: BW/color/copias/impresiones/escaneos/fax)
- [x] Consumibles avanzados (waste toner, drum, fuser, maintenance kit)
- [ ] Trays (bandejas avanzadas RICOH — pendiente; el estándar ya cubre lo básico)
- [ ] Maintenance data (datos de mantenimiento extendidos — pendiente)
- [ ] Device errors (errores privados RICOH — pendiente; el estándar cubre lo básico)
- [ ] Device capabilities (capacidades del dispositivo — pendiente)
- [ ] Probar múltiples generaciones/modelos RICOH (requiere hardware real)
