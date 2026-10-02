# Arquitectura

Resumen de la arquitectura implementada. El plan maestro completo está en
[../Printer_Device_Manager_Development_Plan.md](../Printer_Device_Manager_Development_Plan.md).

## Flujo vertical (Oleada 0)

```
Frontend (dashboard mínimo / futuro Next.js)
        │ REST
        ▼
apps/server (Express)
        │
        ├── probe(ip, creds)  ──►  packages/snmp-core
        │                            ├── SnmpService (real | mock)
        │                            ├── selectAdapter() → Standard | Ricoh
        │                            └── OIDs (Printer-MIB, HOST-RESOURCES, MIB-II)
        │
        └── printers-repo  ──►  Prisma  ──►  SQLite
```

## Decisiones tomadas en la Fundación

- **Monorepo con npm workspaces** + `tsx` para ejecutar TypeScript sin build.
- **Express** (no NestJS) para el slice vertical: el objetivo de las secciones
  37/41 es probar el flujo con mínima ceremonia. Migrar a NestJS es opcional y
  no bloquea a los agentes, porque la lógica vive en `@pdm/snmp-core`.
- **Modo mock** (`SNMP_MOCK=true`) con fixtures: permite desarrollar y testear
  sin impresoras reales (sección 36).
- **Arquitectura de adaptadores** (sección 11): los OIDs no viven en el servicio;
  cada fabricante es una implementación de `PrinterAdapter`.
- **Tolerancia a fallos** (sección 34): un OID no soportado se registra en
  `errors` sin abortar el probe.

## Separación por dominios (para los agentes)

Ver [AGENTS.md](AGENTS.md). Cada agente es dueño de un conjunto de carpetas y
consume los contratos, nunca los reescribe.
