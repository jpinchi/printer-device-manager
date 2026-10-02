# API — CONTRATO compartido

Base URL: `http://localhost:3000`

Este documento es un **contrato**. El agente de Frontend programa contra estas
firmas; el agente de Backend las implementa. Cambiar una firma requiere
coordinación con el orquestador.

## Convenciones

- JSON en request y response.
- Las **credenciales SNMP nunca se devuelven al cliente** (sección 23). El campo
  `snmpCommunityEncrypted` no se expone en las respuestas públicas.
- Errores: `{ "error": "mensaje" }` con código HTTP apropiado.

## Endpoints implementados (Oleada 0)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servidor y si está en modo mock. |
| GET | `/api/printers` | Lista el inventario (con consumibles y ubicación). |
| GET | `/api/printers/:id` | Detalle de una impresora. |
| POST | `/api/printers` | Consulta una IP por SNMP y la guarda. Body: `{ ip, community?, version? }`. |
| POST | `/api/printers/:id/poll` | Re-consulta y actualiza una impresora existente. |
| DELETE | `/api/printers/:id` | Elimina una impresora del inventario. |
| POST | `/api/discovery/scan` | Escanea un rango IP por SNMP. Body: `{ startIp, endIp }` o `{ cidr }`, más `community?`, `version?`, `concurrency?`. |
| GET | `/api/discovery/results` | Último resultado de escaneo (en memoria). |

### POST /api/discovery/scan — ejemplo

```json
// request
{ "startIp": "192.0.2.1", "endIp": "192.0.2.254", "community": "public", "version": "v2c" }

// response 200 (DiscoveryResult, SIN credenciales — sección 23.5)
{ "scannedIps": 254, "reachableCount": 47, "totalDevices": 32, "printersFound": 32,
  "byManufacturer": { "RICOH": 24, "HP": 4, "BROTHER": 2, "CANON": 1, "KYOCERA": 1 },
  "devices": [ { "ip": "192.0.2.51", "isPrinter": true, "manufacturer": "RICOH", "model": "RICOH IM C4500" } ],
  "durationMs": 8123 }
```

> En modo mock toda IP responde con el mismo fixture (mismo MAC/serial), así que
> el dedupe (sección 26) colapsa el rango a 1 dispositivo: `reachableCount` refleja
> las respuestas crudas y `totalDevices` el conteo tras deduplicar.

### POST /api/printers — ejemplo

```json
// request
{ "ip": "192.0.2.51", "community": "public", "version": "v2c" }

// response 201
{ "printer": { "id": "...", "model": "RICOH IM C4500", "status": "ONLINE", "supplies": [...] },
  "probe":   { "reachable": true, "isPrinter": true, "info": {...}, "supplies": [...], "errors": [] } }
```

## Alertas, Historial, Ubicaciones (Oleada 2 — implementados)

```
GET  /api/alerts?status=active|resolved|all&printerId=   # Fase 5
POST /api/alerts/:id/ack                                 # Fase 5
POST /api/alerts/:id/resolve                             # Fase 5

GET  /api/printers/:id/history?from&to&bucket=hour|day   # Fase 6 (estado)
GET  /api/printers/:id/history/counters                  # Fase 6
GET  /api/printers/:id/history/supplies                  # Fase 6
GET  /api/printers/:id/history/errors                    # Fase 6
GET  /api/printers/:id/history.csv?type=status|counters  # Fase 6 (export CSV)

GET  /api/locations                                      # Fase 3
POST /api/locations                                      # Fase 3
```

## Autenticación (Oleada 3 — implementada)

Autenticación local con hashing `scrypt` y tokens JWT-lite firmados con HMAC
(sin dependencias externas). El primer usuario registrado es Administrator; el
resto Viewer por defecto.

```
POST /api/auth/register   # { username, password } -> 201 { user }
POST /api/auth/login      # { username, password } -> 200 { token, user }
GET  /api/auth/me         # Authorization: Bearer <token> -> { user }
```

## Autorización por roles (lista, NO forzada aún)

Los middlewares `requireAuth` y `requireRole(...)` existen y están probados. La
aplicación sobre las rutas existentes está **desactivada por defecto** para no
romper el flujo de desarrollo/smoke; se activa deliberadamente cuando se decida.
Mapa recomendado (sección 24, jerarquía Administrator > Technician > Viewer):

| Rol mínimo | Rutas |
|------------|-------|
| Administrator | `POST /api/printers`, `DELETE /api/printers/:id`, `POST /api/discovery/scan`, `POST /api/locations` |
| Technician | `POST /api/printers/:id/poll`, `GET /api/discovery/results`, gestión de `/api/alerts` |
| Viewer (solo autenticado) | `GET /api/printers`, `GET /api/printers/:id`, `GET /api/printers/:id/history*`, `GET /api/locations` |

`GET /api/health` permanece público.

## Fabricantes soportados (Oleada 1 y 3)

Detección automática por `sysObjectID` y selección de adaptador: **RICOH**
(avanzado), **HP, Canon, Brother, Kyocera, Xerox, Lexmark** (estándar + firmware),
con `StandardPrinterAdapter` como fallback para cualquier otro.

## Tiempo real (Sección 19 — implementado)

WebSocket en `ws://<host>:3000/ws`. El servidor emite señales de cambio; los
datos siguen viajando por la API REST autenticada (el WS no lleva datos
sensibles). El frontend se suscribe y recarga automáticamente.

```
WS  /ws
# mensajes:
{ "type": "hello", "time": "..." }
{ "type": "printers:changed", "reason": "printer-added|printer-polled|printer-deleted|polling-cycle", "at": "..." }
```
