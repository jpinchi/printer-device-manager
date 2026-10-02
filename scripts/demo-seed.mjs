// @ts-nocheck
/**
 * demo-seed.mjs — Siembra una base de datos de DEMOSTRACIÓN con datos de ejemplo
 * INVENTADOS (ninguno real) para generar las capturas del README.
 *
 * Uso:
 *   DATABASE_URL="file:/ruta/absoluta/demo.db" node scripts/demo-seed.mjs
 *
 * Si el archivo de la BD no existe, se copia el esquema vacío desde
 * apps/desktop/resources/db-template/pdm.db. Es idempotente: vacía las tablas de
 * inventario antes de sembrar, así se puede re-ejecutar sin duplicar.
 *
 * NO contiene datos reales (ni IPs, ni nombres, ni organizaciones reales).
 */
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

// 1) Resolver el archivo de BD desde DATABASE_URL (file:...).
const url = process.env.DATABASE_URL || "";
const rawPath = url.replace(/^file:/, "");
if (!rawPath) {
  console.error("Falta DATABASE_URL (p. ej. file:/ruta/demo.db).");
  process.exit(1);
}
// Para rutas absolutas creamos la carpeta; las relativas las resuelve Prisma
// (relativas a prisma/schema.prisma), así que no las tocamos aquí.
if (isAbsolute(rawPath)) mkdirSync(dirname(rawPath), { recursive: true });

// 2) Asegurar el esquema en esa BD (idempotente; crea el archivo si no existe).
//    Usa el esquema real (prisma/schema.prisma), no una plantilla, para que
//    funcione en un clon limpio.
const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
  cwd: repo, shell: true, stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
if (push.status !== 0) {
  console.error("No se pudo preparar el esquema de la BD (prisma db push).");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

// --- Datos de ejemplo (inventados) -----------------------------------------
const LOCATIONS = [
  ["Oficina Central", "Edificio principal, pisos 1–5"],
  ["Sucursal Norte", "Zona industrial, nave 2"],
  ["Sucursal Sur", "Plaza comercial, local 14"],
  ["Centro de Datos", "Sala fría, acceso restringido"],
  ["Almacén", "Logística y despacho"],
];

const WORK_UNITS = [
  ["Administración", "Gerencia y recepción"],
  ["Ventas", "Mostrador y atención al cliente"],
  ["Soporte TI", "Mesa de ayuda e infraestructura"],
  ["Contabilidad", "Finanzas y facturación"],
  ["Recursos Humanos", "Personal y nómina"],
];

// color = BLACK | CYAN | MAGENTA | YELLOW ; mono = solo BLACK
const mono = (k) => [["BLACK", k]];
const color = (k, c, m, y) => [
  ["BLACK", k], ["CYAN", c], ["MAGENTA", m], ["YELLOW", y],
];

const PRINTERS = [
  // name, ip, manufacturer, model, serial, status, location, workUnit, toners, total, mfp
  ["RICOH-CENTRAL-01", "192.168.10.11", "RICOH", "IM C4500", "RC45-0001-AX", "ONLINE", "Oficina Central", "Administración", color(82, 64, 71, 58), 184210, true],
  ["RICOH-CENTRAL-02", "192.168.10.12", "RICOH", "IM 4000", "RM40-0002-BX", "ONLINE", "Oficina Central", "Contabilidad", mono(47), 96120, true],
  ["HP-VENTAS-01", "192.168.10.21", "HP", "LaserJet Enterprise M507", "HPM507-7781", "ONLINE", "Oficina Central", "Ventas", mono(14), 58340, false],
  ["CANON-VENTAS-02", "192.168.10.22", "CANON", "imageRUNNER 2635i", "CIR2635-5521", "ONLINE", "Sucursal Norte", "Ventas", color(63, 9, 40, 55), 142890, true],
  ["BROTHER-RH-01", "192.168.20.31", "BROTHER", "MFC-L8900CDW", "BRL8900-3340", "ONLINE", "Sucursal Norte", "Recursos Humanos", color(91, 77, 80, 6), 31540, true],
  ["LEXMARK-TI-01", "192.168.20.32", "LEXMARK", "MX622adhe", "LXMX622-1180", "ONLINE", "Centro de Datos", "Soporte TI", mono(73), 210450, true],
  ["XEROX-SUR-01", "192.168.30.41", "XEROX", "VersaLink C405", "XVC405-9032", "OFFLINE", "Sucursal Sur", "Administración", color(38, 52, 12, 44), 77630, true],
  ["KYOCERA-SUR-02", "192.168.30.42", "KYOCERA", "ECOSYS M3645idn", "KYM3645-6610", "ONLINE", "Sucursal Sur", "Ventas", mono(57), 88240, true],
  ["HP-ALMACEN-01", "192.168.40.51", "HP", "LaserJet Pro M404dn", "HPM404-2093", "ONLINE", "Almacén", "Soporte TI", mono(29), 44120, false],
  ["RICOH-ADMIN-03", "192.168.10.13", "RICOH", "IM C3000", "RC30-0003-CX", "ONLINE", "Oficina Central", "Administración", color(66, 71, 69, 73), 120980, true],
  ["CANON-TI-03", "192.168.20.33", "CANON", "imageRUNNER C3226i", "CIR3226-4417", "ONLINE", "Centro de Datos", "Soporte TI", color(19, 48, 51, 50), 99410, true],
  ["BROTHER-CONTA-02", "192.168.10.24", "BROTHER", "HL-L6400DW", "BRL6400-7725", "OFFLINE", "Oficina Central", "Contabilidad", mono(85), 63870, false],
  ["LEXMARK-VENTAS-03", "192.168.30.43", "LEXMARK", "CX730de", "LXCX730-2256", "ONLINE", "Sucursal Sur", "Ventas", color(54, 61, 8, 67), 51200, true],
  ["KYOCERA-ADMIN-04", "192.168.10.14", "KYOCERA", "TASKalfa 3554ci", "KYT3554-9981", "ONLINE", "Oficina Central", "Recursos Humanos", color(72, 80, 76, 83), 156700, true],
];

async function main() {
  // Limpiar inventario previo (idempotente). Orden: hijos → padres.
  await prisma.printerEvent.deleteMany({});
  await prisma.printerCounter.deleteMany({});
  await prisma.printerSupply.deleteMany({});
  await prisma.printerTray.deleteMany({});
  await prisma.printerStatusHistory.deleteMany({});
  await prisma.printer.deleteMany({});
  await prisma.workUnit.deleteMany({});
  await prisma.location.deleteMany({});

  const locId = {};
  for (const [name, description] of LOCATIONS) {
    const row = await prisma.location.create({ data: { name, description } });
    locId[name] = row.id;
  }
  const wuId = {};
  for (const [name, description] of WORK_UNITS) {
    const row = await prisma.workUnit.create({ data: { name, description } });
    wuId[name] = row.id;
  }

  const now = new Date();
  for (const [name, ip, manufacturer, model, serial, status, loc, wu, toners, total, mfp] of PRINTERS) {
    const p = await prisma.printer.create({
      data: {
        name, ipAddress: ip, manufacturer, model, serialNumber: serial,
        hostname: name.toLowerCase(), macAddress: randMac(),
        snmpVersion: "v2c", status,
        firmware: `${manufacturer} FW ${1 + (serial.length % 4)}.${serial.length % 9}`,
        lastSeen: status === "ONLINE" ? now : new Date(now.getTime() - 36e5 * 6),
        uptimeSeconds: status === "ONLINE" ? 3600 * (24 + (total % 72)) : null,
        uptimeReadAt: status === "ONLINE" ? now : null,
        locationId: locId[loc], workUnitId: wuId[wu],
      },
    });

    for (const [c, pct] of toners) {
      await prisma.printerSupply.create({
        data: {
          printerId: p.id, name: `Tóner ${c.toLowerCase()}`, type: "TONER",
          color: c, level: pct, maxCapacity: 100, percent: pct,
        },
      });
    }

    await prisma.printerCounter.create({
      data: { printerId: p.id, counterType: "TOTAL", value: total },
    });
    if (mfp) {
      await prisma.printerCounter.create({ data: { printerId: p.id, counterType: "COPIES", value: Math.round(total * 0.18) } });
      await prisma.printerCounter.create({ data: { printerId: p.id, counterType: "SCANS", value: Math.round(total * 0.27) } });
    }

    await prisma.printerTray.create({
      data: { printerId: p.id, trayName: "Bandeja 1", paperSize: "Letter", paperType: "Normal", capacity: 500, currentLevel: 120 + (total % 360), capacityUnit: "hojas" },
    });

    // Alertas de ejemplo: tóner bajo (≤20%) y equipos fuera de línea.
    const lowest = Math.min(...toners.map(([, v]) => v));
    if (lowest <= 20) {
      await prisma.printerEvent.create({
        data: { printerId: p.id, severity: "WARNING", type: "TONER_LOW", message: `Tóner bajo (${lowest}%) en ${model}`, source: "demo" },
      });
    }
    if (status === "OFFLINE") {
      await prisma.printerEvent.create({
        data: { printerId: p.id, severity: "ERROR", type: "OFFLINE", message: `Sin respuesta SNMP en ${ip}`, source: "demo" },
      });
    }
  }

  const counts = {
    ubicaciones: LOCATIONS.length,
    unidades: WORK_UNITS.length,
    impresoras: PRINTERS.length,
  };
  console.log("Datos de ejemplo sembrados:", counts);
}

function randMac() {
  const h = () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase();
  return ["00", "1B", h(), h(), h(), h()].join(":");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
