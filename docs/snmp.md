# Motor SNMP

## Versiones

- Soportado hoy: **SNMP v1 y v2c** (net-snmp).
- Futuro: v3 (autenticación/cifrado).

## Diseño

- `SnmpClient` (interfaz) con dos implementaciones:
  - `RealSnmpClient` — usa `net-snmp` (GET + subtree/walk).
  - `MockSnmpClient` — responde desde fixtures (`SNMP_MOCK=true`).
- `SnmpService` — capa de alto nivel: `getString/getNumber/getRaw/walk/walkIndexed`.
  Acumula errores por operación en vez de lanzarlos (tolerancia a fallos).
- `probe(ip, creds)` — orquesta el flujo de la sección 14 y devuelve `ProbeResult`.

## MIBs usadas (estándares abiertos primero)

| MIB | Uso |
|-----|-----|
| MIB-II / System | sysDescr, sysObjectID, sysUpTime, sysName, sysLocation |
| Printer-MIB (RFC 3805) | modelo, serial, consumibles, bandejas, contador total |
| HOST-RESOURCES-MIB | estado de impresión (`hrPrinterStatus`) |
| Interfaces | MAC (`ifPhysAddress`) |

Los OIDs están centralizados en `packages/snmp-core/src/oids.ts`.

## OIDs privados por fabricante

Se consultan **solo** tras detectar el fabricante y siempre de forma tolerante.
RICOH usa la rama `1.3.6.1.4.1.367`. Ver [ricoh-oids.md](ricoh-oids.md).
