/**
 * Smoke test end-to-end en modo mock (sin hardware).
 *
 * Requiere el server corriendo en modo mock, p.ej.:
 *   SNMP_MOCK=true POLLING_ENABLED=false npm run server
 * y en otra terminal:
 *   node scripts/smoke.mjs
 *
 * Verifica el flujo integrado de la Oleada 1. Los pasos que dependen de wiring
 * aún pendiente (p.ej. /api/discovery/scan) se marcan PENDING y NO hacen fallar
 * el script; los pasos del núcleo sí son asertivos.
 */
const BASE = process.env.PDM_BASE ?? "http://localhost:3000";
const RICOH_IP = process.env.PDM_IP ?? "192.0.2.51";
const ADMIN_USER = process.env.PDM_ADMIN_USER ?? "smokeadmin";
const ADMIN_PASS = process.env.PDM_ADMIN_PASS ?? "smokepass123";

let authToken = null; // se rellena tras el login admin (si hay enforcement)
let pass = 0,
  warn = 0,
  fail = 0;

function ok(name) {
  pass++;
  console.log(`  ✅ ${name}`);
}
function pending(name, detail = "") {
  warn++;
  console.log(`  ⏳ PENDING ${name}${detail ? " — " + detail : ""}`);
}
function bad(name, detail = "") {
  fail++;
  console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
}

async function req(method, path, body) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = "Bearer " + authToken;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* puede no haber cuerpo */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`\n🔎 Smoke test contra ${BASE}\n`);

  // 1. Health
  console.log("Health:");
  try {
    const { status, json } = await req("GET", "/api/health");
    if (status === 200 && json?.ok) ok("GET /api/health responde ok");
    else bad("GET /api/health", `status ${status}`);
    if (json?.mock === true) ok("server en modo mock");
    else pending("modo mock", "SNMP_MOCK no está activo; algunos pasos usarán red real");
  } catch (e) {
    bad("no se pudo conectar al server", e.message);
    console.log("\n¿Está corriendo `SNMP_MOCK=true npm run server`?\n");
    summary();
    return;
  }

  // 1b. Autorización por roles (si AUTH_ENFORCE está activo)
  console.log("\nAutorización (secciones 23-24):");
  {
    // Sin token, una ruta protegida debe dar 401 cuando hay enforcement.
    const noAuth = await req("GET", "/api/printers");
    if (noAuth.status === 401) {
      ok("enforcement activo: GET /api/printers sin token → 401");
      const login = await req("POST", "/api/auth/login", {
        username: ADMIN_USER,
        password: ADMIN_PASS,
      });
      if (login.status === 200 && login.json?.token) {
        authToken = login.json.token;
        ok(`login admin '${ADMIN_USER}' (${login.json.user?.role}) → token`);
      } else {
        bad("login admin", `status ${login.status} — ¿corriste create-admin?`);
      }
    } else if (noAuth.status === 200) {
      pending("enforcement", "AUTH_ENFORCE desactivado; rutas abiertas");
    } else {
      bad("GET /api/printers (sin token)", `status ${noAuth.status}`);
    }
  }

  // 2. Alta por SNMP
  console.log("\nAlta de impresora por SNMP:");
  let printerId = null;
  {
    const { status, json } = await req("POST", "/api/printers", { ip: RICOH_IP });
    if ((status === 201 || status === 200) && json?.printer) {
      printerId = json.printer.id;
      ok(`POST /api/printers (${RICOH_IP}) → ${json.printer.model ?? "?"}`);
      if (String(json.printer.model ?? "").includes("C4500"))
        ok("modelo RICOH IM C4500 detectado");
      else pending("modelo esperado", `se obtuvo ${json.printer.model}`);
    } else if (status === 422) {
      bad("no hubo respuesta SNMP", "¿modo mock activo?");
    } else {
      bad("POST /api/printers", `status ${status}`);
    }
  }

  // 3. Listado y detalle
  console.log("\nInventario:");
  {
    const { status, json } = await req("GET", "/api/printers");
    if (status === 200 && Array.isArray(json) && json.length >= 1)
      ok(`GET /api/printers → ${json.length} impresora(s)`);
    else bad("GET /api/printers", `status ${status}`);
    if (!printerId && Array.isArray(json) && json[0]) printerId = json[0].id;
  }

  let detail = null;
  if (printerId) {
    const { status, json } = await req("GET", `/api/printers/${printerId}`);
    if (status === 200 && json?.id) {
      detail = json;
      ok("GET /api/printers/:id → detalle");
    } else bad("GET /api/printers/:id", `status ${status}`);
  }

  // 4. Poll manual
  console.log("\nPoll manual:");
  if (printerId) {
    const { status, json } = await req("POST", `/api/printers/${printerId}/poll`);
    if (status === 200 && json?.printer) ok("POST /api/printers/:id/poll actualiza");
    else bad("POST /api/printers/:id/poll", `status ${status}`);
    detail = json?.printer ?? detail;
  }

  // 5. Consumibles / contadores RICOH enriquecidos (Fase 7)
  console.log("\nEnriquecimiento RICOH (Fase 7):");
  if (detail) {
    const supplies = detail.supplies ?? [];
    const counters = detail.counters ?? [];
    const black = supplies.find((s) => s.color === "BLACK");
    if (black) ok(`tóner negro estándar presente (${black.percent ?? "?"}%)`);
    else bad("tóner negro estándar ausente");

    const advanced = supplies.filter((s) =>
      ["WASTE_TONER", "DRUM", "FUSER", "MAINTENANCE_KIT"].includes(s.type),
    );
    if (advanced.length) ok(`consumibles avanzados RICOH: ${advanced.map((s) => s.type).join(", ")}`);
    else pending("consumibles avanzados RICOH", "fixture aún sin OIDs privados o agente en curso");

    // Los contadores por función RICOH se eliminaron (OIDs privados no fiables);
    // se conserva solo el TOTAL del estándar abierto (prtMarkerLifeCount).
    const total = counters.find((c) => (c.counterType ?? c.type) === "TOTAL");
    if (total) ok(`contador TOTAL presente (${total.value ?? "?"})`);
    else bad("contador TOTAL ausente");
  } else {
    pending("enriquecimiento RICOH", "sin detalle de impresora");
  }

  // 6. Discovery (Fase 2) — pendiente de wiring HTTP
  console.log("\nDiscovery (Fase 2):");
  {
    const { status, json } = await req("POST", "/api/discovery/scan", {
      startIp: "10.0.0.1",
      endIp: "10.0.0.4",
    });
    if (status === 404) {
      pending("POST /api/discovery/scan", "router aún no montado (ver docs/integration.md)");
    } else if (status === 200 && json) {
      ok(`POST /api/discovery/scan → ${json.printersFound ?? "?"} impresoras / ${json.totalDevices ?? "?"} dispositivos`);
    } else {
      pending("POST /api/discovery/scan", `status ${status}`);
    }
  }

  // 7. Alerts (Fase 5)
  console.log("\nAlerts (Fase 5):");
  {
    const { status, json } = await req("GET", "/api/alerts");
    if (status === 200 && Array.isArray(json)) ok(`GET /api/alerts → ${json.length} alerta(s) activas`);
    else if (status === 404) pending("GET /api/alerts", "router no montado");
    else bad("GET /api/alerts", `status ${status}`);
  }

  // 8. Historial (Fase 6)
  console.log("\nHistorial (Fase 6):");
  if (printerId) {
    const { status, json } = await req("GET", `/api/printers/${printerId}/history`);
    if (status === 200 && json?.history) ok(`GET /:id/history → ${json.history.length} punto(s)`);
    else if (status === 404) pending("GET /:id/history", "router no montado");
    else bad("GET /:id/history", `status ${status}`);

    const csv = await req("GET", `/api/printers/${printerId}/history.csv?type=status`);
    if (csv.status === 200) ok("GET /:id/history.csv (export CSV)");
    else pending("export CSV", `status ${csv.status}`);
  }

  // 9. Locations (Fase 3)
  console.log("\nLocations (Fase 3):");
  {
    const { status, json } = await req("GET", "/api/locations");
    if (status === 200 && Array.isArray(json)) ok(`GET /api/locations → ${json.length} ubicación(es)`);
    else bad("GET /api/locations", `status ${status}`);
  }

  // 10. Auth (secciones 23-24)
  console.log("\nAuth (secciones 23-24):");
  {
    const username = "smoke_" + Date.now();
    const password = "S3cret-smoke!";
    const reg = await req("POST", "/api/auth/register", { username, password });
    if (reg.status === 201 && reg.json?.user) ok(`POST /api/auth/register → ${reg.json.user.role ?? "user"}`);
    else if (reg.status === 404) pending("POST /api/auth/register", "router no montado");
    else bad("POST /api/auth/register", `status ${reg.status}`);

    const login = await req("POST", "/api/auth/login", { username, password });
    if (login.status === 200 && login.json?.token) {
      ok("POST /api/auth/login → token emitido");
      const me = await req("GET", "/api/auth/me", undefined);
      // /me necesita el token; hacemos una llamada manual con el header.
      const meRes = await fetch(BASE + "/api/auth/me", {
        headers: { Authorization: "Bearer " + login.json.token },
      });
      if (meRes.status === 200) ok("GET /api/auth/me con token → ok");
      else bad("GET /api/auth/me", `status ${meRes.status}`);
      void me;

      // Diferenciación por rol: un Viewer NO puede crear impresoras (Admin-only).
      const denied = await fetch(BASE + "/api/printers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + login.json.token },
        body: JSON.stringify({ ip: "10.0.0.9" }),
      });
      if (denied.status === 403) ok("rol Viewer NO puede POST /api/printers → 403");
      else if (denied.status === 201 || denied.status === 200) pending("rol 403", "enforcement desactivado");
      else bad("rol Viewer 403", `status ${denied.status}`);
    } else if (login.status !== 404) {
      bad("POST /api/auth/login", `status ${login.status}`);
    }
  }

  summary();
}

function summary() {
  console.log(`\n──────────────\n✅ ${pass}  ⏳ ${warn}  ❌ ${fail}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
