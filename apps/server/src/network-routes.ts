/**
 * Utilidades de red (Technician+).
 *
 * POST /ip-scan  → barrido de ALCANZABILIDAD de un rango para saber qué IPs
 * están EN USO y cuáles LIBRES (para asignar una IP fija). Combina ICMP (ping),
 * la tabla ARP (más fiable en la subred local) y las impresoras ya conocidas.
 *
 * Es un heurístico de apoyo: un equipo con firewall puede no responder al ping;
 * la fuente de verdad definitiva sigue siendo el plan de IPs / DHCP de la red.
 */
import { Router } from "express";
import { execFile } from "node:child_process";
import { reverse as dnsReverse } from "node:dns/promises";
import { expandRange, InvalidRangeError, type IpRangeSpec } from "@pdm/discovery";
import { RealSnmpClient, type VarBind } from "@pdm/snmp-core";
import type { SnmpCredentials } from "@pdm/types";
import { prisma } from "./db.js";

export const networkRouter = Router();

// OIDs estándar (RFC1213 / IP-MIB) usados por la sonda de escritura SNMP.
const OID = {
  sysName: "1.3.6.1.2.1.1.5.0",
  sysDescr: "1.3.6.1.2.1.1.1.0",
  prtName: "1.3.6.1.2.1.43.5.1.1.16.1", // prtGeneralPrinterName → modelo real (ej. "IM 550")
  sysLocation: "1.3.6.1.2.1.1.6.0", // read-write en RFC1213 → objetivo del "no-op write"
  ipAdEntAddr: "1.3.6.1.2.1.4.20.1.1", // columna: valor = IP
  ipAdEntNetMask: "1.3.6.1.2.1.4.20.1.3", // columna: índice = IP, valor = máscara
  ipRouteDest: "1.3.6.1.2.1.4.21.1.1",
  ipRouteNextHop: "1.3.6.1.2.1.4.21.1.7", // índice = destino; el de dest 0.0.0.0 = gateway
  // Bloque TCP/IP privado de RICOH (verificado en IM-series). El registro de
  // config (.3/.4/.6) es ESCRIBIBLE; el espejo activo (.17) es de solo lectura.
  // Escribir la IP deja el cambio PENDIENTE: se aplica al reiniciar la impresora.
  ricohCfgIp: "1.3.6.1.4.1.367.3.2.1.7.2.1.3.0",
  ricohCfgMask: "1.3.6.1.4.1.367.3.2.1.7.2.1.4.0",
  ricohCfgGw: "1.3.6.1.4.1.367.3.2.1.7.2.1.6.0",
  ricohActiveIp: "1.3.6.1.4.1.367.3.2.1.7.2.1.17.0",
} as const;

/** Formatea un valor SNMP (Buffer de 4 bytes o string) como IPv4, o null. */
function toIp(value: unknown): string | null {
  if (Buffer.isBuffer(value) && value.length === 4) return Array.from(value).join(".");
  if (typeof value === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value;
  return null;
}

/** Sufijo IPv4 de un OID de columna (los últimos 4 octetos). */
function ipSuffix(oid: string, base: string): string | null {
  const rest = oid.startsWith(base + ".") ? oid.slice(base.length + 1) : "";
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(rest) ? rest : null;
}

function credsFor(community: string, version: unknown): SnmpCredentials {
  return {
    version: version === "v1" ? "v1" : "v2c",
    community,
    timeoutMs: 3000,
    retries: 1,
  };
}

const KNOWN_MFRS = ["RICOH", "Lanier", "Savin", "Hewlett-Packard", "HP", "Canon", "Brother", "Kyocera", "Xerox", "Lexmark", "Epson", "Konica", "Toshiba", "Sharp"];
/** Detecta el fabricante a partir de un texto (sysDescr/sysName), o null. */
function mfrFrom(text: string | null): string | null {
  if (!text) return null;
  for (const m of KNOWN_MFRS) {
    if (new RegExp(m.replace(/-/g, "\\-"), "i").test(text)) return m === "Hewlett-Packard" ? "HP" : m;
  }
  return null;
}

interface SnmpId {
  sysName: string | null;
  model: string | null;
  manufacturer: string | null;
  isPrinter: boolean;
}
/** Identifica en vivo por SNMP (rápido): nombre, modelo y si es impresora. */
async function snmpIdentify(ip: string, community: string, version: unknown): Promise<SnmpId> {
  const client = new RealSnmpClient(ip, { version: version === "v1" ? "v1" : "v2c", community, timeoutMs: 1000, retries: 0 });
  try {
    const vbs = await client.get([OID.sysName, OID.sysDescr, OID.prtName]);
    if (vbs.length === 0) return { sysName: null, model: null, manufacturer: null, isPrinter: false };
    const m = new Map(vbs.map((v: VarBind) => [v.oid, v.value]));
    const asStr = (o: string) => (m.has(o) && typeof m.get(o) === "string" ? (m.get(o) as string).trim() : null);
    const sysName = asStr(OID.sysName);
    const sysDescr = asStr(OID.sysDescr);
    const prt = asStr(OID.prtName);
    const hay = `${sysDescr ?? ""} ${sysName ?? ""}`;
    const isPrinter = !!prt || /printer|imagerunner|laserjet|officejet|ricoh|lanier|savin|kyocera|brother|lexmark|xerox|aficio|\bIM\s?\d|\bMP\s?C?\d|\bSP\s?\d/i.test(hay);
    return { sysName, model: prt || null, manufacturer: mfrFrom(sysDescr) ?? mfrFrom(sysName), isPrinter };
  } finally {
    client.close();
  }
}

const MAX_IPS = 512; // tope por escaneo (≈ /23) para mantenerlo responsivo

/** Hace ping a una IP (Windows). Devuelve true si hubo respuesta real (TTL=). */
function pingOne(ip: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "ping",
      ["-n", "1", "-w", String(timeoutMs), ip],
      { windowsHide: true, timeout: timeoutMs + 2000 },
      (_err, stdout) => resolve(/TTL=/i.test(String(stdout))),
    );
  });
}

/** Barre una lista de IPs con concurrencia limitada; devuelve las que respondieron. */
async function pingSweep(ips: string[], timeoutMs: number, concurrency: number): Promise<Set<string>> {
  const alive = new Set<string>();
  let idx = 0;
  const worker = async () => {
    while (idx < ips.length) {
      const ip = ips[idx++];
      if (await pingOne(ip, timeoutMs)) alive.add(ip);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ips.length) }, worker));
  return alive;
}

/** Ejecuta tareas async con concurrencia limitada, conservando el orden. */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/** DNS inverso (PTR): nombre del host, o null. */
async function reverseDns(ip: string): Promise<string | null> {
  try {
    const names = await dnsReverse(ip);
    return names[0] ?? null;
  } catch {
    return null;
  }
}

/** Nombre NetBIOS (Windows) del host: la entrada <00> UNIQUE de `nbtstat -A`. */
function netbiosName(ip: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("nbtstat", ["-A", ip], { windowsHide: true, timeout: 2500 }, (_err, stdout) => {
      const m = String(stdout).match(/^\s*([^\s<]+)\s*<00>\s+UNIQUE/im);
      resolve(m ? m[1].trim() : null);
    });
  });
}

/** Lee la tabla ARP: IP → MAC (solo entradas con MAC válida = en uso). */
function readArp(): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    execFile("arp", ["-a"], { windowsHide: true, timeout: 8000 }, (_err, stdout) => {
      const map = new Map<string, string>();
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.match(/(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})\s+(\w+)/);
        if (!m) continue;
        const mac = m[2].toUpperCase().replace(/-/g, ":");
        if (mac.startsWith("00:00:00") || mac === "FF:FF:FF:FF:FF:FF") continue; // inválidas/broadcast
        map.set(m[1], mac);
      }
      resolve(map);
    });
  });
}

// Guarda de exclusión: un solo escaneo a la vez. Un /ip-scan lanza cientos de
// procesos hijo (ping/nbtstat) y sockets SNMP; varios en paralelo agotarían los
// handles del host. El flag se libera cuando la respuesta termina o se cierra.
let ipScanRunning = false;
networkRouter.post("/ip-scan", async (req, res) => {
  if (ipScanRunning) {
    return res.status(429).json({ error: "Ya hay un escaneo en curso. Espera a que termine." });
  }
  ipScanRunning = true;
  const release = () => {
    ipScanRunning = false;
  };
  res.on("finish", release);
  res.on("close", release);

  const b = req.body ?? {};
  let ips: string[];
  try {
    const input = b.cidr
      ? String(b.cidr)
      : ({ start: String(b.start ?? ""), end: String(b.end ?? "") } as IpRangeSpec);
    ips = expandRange(input, { maxHosts: MAX_IPS });
  } catch (err) {
    const msg = err instanceof InvalidRangeError ? err.message : "Rango inválido";
    return res.status(400).json({ error: `${msg} (máx. ${MAX_IPS} IPs por escaneo).` });
  }
  if (ips.length === 0) return res.status(400).json({ error: "El rango no contiene direcciones." });

  const timeoutMs = Math.min(Number(b.timeoutMs ?? 600), 2000);

  // Impresoras conocidas dentro del rango.
  const printers = await prisma.printer.findMany({
    where: { ipAddress: { in: ips } },
    select: { ipAddress: true, name: true, model: true, location: { select: { name: true } } },
  });
  const printerByIp = new Map(printers.map((p) => [p.ipAddress, p]));

  const alive = await pingSweep(ips, timeoutMs, 32);
  const arp = await readArp();

  const entries = ips.map((ip) => {
    const printer = printerByIp.get(ip);
    const icmp = alive.has(ip);
    const mac = arp.get(ip) ?? null;
    const used = !!printer || icmp || !!mac;
    const via = printer ? "printer" : icmp ? "icmp" : mac ? "arp" : null;
    return {
      ip,
      used,
      via,
      mac,
      // ¿respondió algo EN VIVO? (ping o ARP; se completa con SNMP más abajo).
      // Una impresora del inventario que NO responde en vivo = IP reservada sin respuesta.
      respondedLive: icmp || !!mac,
      printerName: printer?.name ?? null,
      printerModel: printer?.model ?? null,
      printerLocation: printer?.location?.name ?? null,
      hostname: null as string | null,
      snmpName: null as string | null,
      snmpModel: null as string | null,
      snmpManufacturer: null as string | null,
      isPrinter: false,
    };
  });

  // Nombre del dispositivo que ocupa cada IP en uso: primero DNS inverso (PTR),
  // y para las que no resuelvan, NetBIOS (nbtstat) — así también sale el nombre
  // de PCs/servidores Windows, no solo de las impresoras conocidas.
  const usedEntries = entries.filter((e) => e.used);
  const dnsNames = await mapPool(usedEntries, 32, (e) => reverseDns(e.ip));
  usedEntries.forEach((e, i) => (e.hostname = dnsNames[i]));
  const noName = usedEntries.filter((e) => !e.hostname);
  const nb = await mapPool(noName, 16, (e) => netbiosName(e.ip));
  noName.forEach((e, i) => (e.hostname = nb[i]));

  // Identificación SNMP en vivo de cada IP en uso: detecta modelo y si es impresora,
  // aunque NO esté en el inventario (así una impresora reubicada muestra su modelo).
  const readCommunity = String(b.community ?? "public");
  const ids = await mapPool(usedEntries, 16, (e) => snmpIdentify(e.ip, readCommunity, b.version));
  usedEntries.forEach((e, i) => {
    e.snmpName = ids[i].sysName;
    e.snmpModel = ids[i].model;
    e.snmpManufacturer = ids[i].manufacturer;
    e.isPrinter = ids[i].isPrinter;
    if (ids[i].sysName || ids[i].model) e.respondedLive = true; // respondió por SNMP
  });

  const freeIps = entries.filter((e) => !e.used).map((e) => e.ip);
  res.json({
    scanned: ips.length,
    used: entries.length - freeIps.length,
    free: freeIps.length,
    freeIps,
    entries,
  });
});

/**
 * POST /snmp-write-probe — Etapa 1 (SIN RIESGO) del cambio de IP remoto.
 *
 * Comprueba, sobre UNA impresora, dos cosas sin tocar la configuración de red:
 *  1) Lee la config de red actual (IP/máscara/gateway) por SNMP de lectura.
 *  2) Prueba si la community de ESCRITURA (RW) funciona, haciendo un "no-op write":
 *     escribe en `sysLocation` (RFC1213, read-write) su MISMO valor actual. Si el
 *     agente acepta el SET, la community RW es válida y SNMP-write está habilitado;
 *     no se altera ningún dato de la impresora.
 *
 * Esto responde la pregunta que decide todo: ¿es posible escribir por SNMP en
 * estas RICOH? Solo si esto pasa tiene sentido intentar escribir la IP (Etapa 2).
 */
networkRouter.post("/snmp-write-probe", async (req, res) => {
  const b = req.body ?? {};
  const ip = String(b.ip ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return res.status(400).json({ error: "IP inválida." });
  }
  const readCommunity = String(b.community ?? "public");
  const writeCommunity = String(b.writeCommunity ?? "").trim();
  if (!writeCommunity) {
    return res.status(400).json({ error: "Falta la community de escritura (RW)." });
  }

  const reader = new RealSnmpClient(ip, credsFor(readCommunity, b.version));
  const writer = new RealSnmpClient(ip, credsFor(writeCommunity, b.version));
  try {
    // 1) Lectura de config actual.
    const scalars = await reader.get([OID.sysName, OID.sysLocation]);
    const byOid = new Map(scalars.map((v: VarBind) => [v.oid, v.value]));
    const reachable = scalars.length > 0;
    const sysName = typeof byOid.get(OID.sysName) === "string" ? (byOid.get(OID.sysName) as string) : null;
    const currentLoc = byOid.has(OID.sysLocation) ? String(byOid.get(OID.sysLocation) ?? "") : "";

    const addrRows = await reader.walk(OID.ipAdEntAddr);
    const maskRows = await reader.walk(OID.ipAdEntNetMask);
    const maskByIp = new Map<string, string | null>();
    for (const r of maskRows) {
      const key = ipSuffix(r.oid, OID.ipAdEntNetMask);
      if (key) maskByIp.set(key, toIp(r.value));
    }
    const addresses = addrRows
      .map((r: VarBind) => toIp(r.value) ?? ipSuffix(r.oid, OID.ipAdEntAddr))
      .filter((x): x is string => !!x && x !== "127.0.0.1")
      .map((ipv) => ({ ip: ipv, mask: maskByIp.get(ipv) ?? null }));

    // Gateway: en la tabla de rutas, el next-hop de la ruta a 0.0.0.0.
    let gateway: string | null = null;
    const hopRows = await reader.walk(OID.ipRouteNextHop);
    for (const r of hopRows) {
      if (ipSuffix(r.oid, OID.ipRouteNextHop) === "0.0.0.0") {
        const hop = toIp(r.value);
        gateway = hop && hop !== "0.0.0.0" ? hop : null;
        break;
      }
    }

    // 2) Prueba de escritura NO destructiva: sysLocation ← su valor actual.
    const write = await writer.set([{ oid: OID.sysLocation, type: "OctetString", value: currentLoc }]);

    res.json({
      ip,
      reachable,
      sysName,
      currentSysLocation: currentLoc,
      addresses,
      gateway,
      writeCommunityWorks: write.ok,
      writeError: write.error,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    reader.close();
    writer.close();
  }
});

/**
 * POST /assign-ip — Etapa 2: escribe la IP (RICOH) por SNMP. FLUJO EN DOS TIEMPOS.
 *
 * Escribe el registro de configuración TCP/IP de RICOH (.3/.4/.6). En las IM-series
 * verificadas esto NO cambia la IP en caliente: deja el cambio PENDIENTE y la
 * impresora sigue accesible en su IP actual. El cambio se aplica al REINICIAR la
 * impresora (apagar/encender o desde su web) — por eso la respuesta lo indica.
 *
 * Es una escritura de configuración de dispositivo → solo Administrator (authz).
 * Pensado para RICOH; en otros fabricantes los OIDs difieren.
 */
networkRouter.post("/assign-ip", async (req, res) => {
  const b = req.body ?? {};
  const ip = String(b.ip ?? "").trim(); // IP ACTUAL (donde responde ahora)
  const newIp = String(b.newIp ?? "").trim();
  const mask = b.mask ? String(b.mask).trim() : null;
  const gateway = b.gateway ? String(b.gateway).trim() : null;
  const writeCommunity = String(b.writeCommunity ?? "").trim();
  const readCommunity = String(b.community ?? "public");
  const isIp = (x: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x);

  if (!isIp(ip)) return res.status(400).json({ error: "IP actual inválida." });
  if (!isIp(newIp)) return res.status(400).json({ error: "IP nueva inválida." });
  if (mask && !isIp(mask)) return res.status(400).json({ error: "Máscara inválida." });
  if (gateway && !isIp(gateway)) return res.status(400).json({ error: "Gateway inválido." });
  if (!writeCommunity) return res.status(400).json({ error: "Falta la community de escritura (RW)." });
  if (newIp === ip) return res.status(400).json({ error: "La IP nueva es igual a la actual." });

  const reader = new RealSnmpClient(ip, credsFor(readCommunity, b.version));
  const writer = new RealSnmpClient(ip, credsFor(writeCommunity, b.version));
  try {
    // Confirmar que responde y que este es el bloque RICOH escribible.
    const pre = await reader.get([OID.ricohCfgIp, OID.ricohActiveIp, OID.sysName]);
    if (pre.length === 0) {
      return res.status(422).json({ error: `Sin respuesta SNMP en ${ip}.` });
    }
    const preMap = new Map(pre.map((v: VarBind) => [v.oid, toIp(v.value)]));
    const beforeConfig = preMap.get(OID.ricohCfgIp) ?? null;
    if (!beforeConfig) {
      return res.status(422).json({
        error: "Esta impresora no expone el registro TCP/IP de RICOH (.367.3.2.1.7.2.1.3.0); no puedo asignar la IP por SNMP en este modelo.",
      });
    }

    // Escribir máscara/gateway (si se piden) y la IP. La IP al final.
    const wrote: Record<string, boolean> = {};
    const errors: string[] = [];
    if (mask) {
      const r = await writer.set([{ oid: OID.ricohCfgMask, type: "IpAddress", value: mask }]);
      wrote.mask = r.ok; if (!r.ok) errors.push(`máscara: ${r.error}`);
    }
    if (gateway) {
      const r = await writer.set([{ oid: OID.ricohCfgGw, type: "IpAddress", value: gateway }]);
      wrote.gateway = r.ok; if (!r.ok) errors.push(`gateway: ${r.error}`);
    }
    const rIp = await writer.set([{ oid: OID.ricohCfgIp, type: "IpAddress", value: newIp }]);
    wrote.ip = rIp.ok; if (!rIp.ok) errors.push(`IP: ${rIp.error}`);

    if (!rIp.ok) {
      return res.status(422).json({
        error: `La escritura de la IP fue rechazada (${rIp.error}). No se aplicó ningún cambio.`,
      });
    }

    // Releer el registro de config y la IP activa para confirmar el estado pendiente.
    const post = await reader.get([OID.ricohCfgIp, OID.ricohActiveIp]);
    const postMap = new Map(post.map((v: VarBind) => [v.oid, toIp(v.value)]));
    const afterConfig = postMap.get(OID.ricohCfgIp) ?? null;
    const activeIp = postMap.get(OID.ricohActiveIp) ?? null;
    const pending = afterConfig === newIp && activeIp !== newIp;

    // Auto-actualizar el inventario: si hay una impresora registrada con la IP
    // actual, apuntar su registro a la IP nueva (evita el "fantasma" en el escáner).
    // Nota: hasta el reinicio la impresora sigue respondiendo en la IP vieja, así
    // que el polling puede fallar en ese intervalo — es esperado.
    let inventoryUpdated = false;
    let inventoryError: string | null = null;
    const updateInventory = b.updateInventory !== false;
    if (updateInventory) {
      try {
        const upd = await prisma.printer.updateMany({ where: { ipAddress: ip }, data: { ipAddress: newIp } });
        inventoryUpdated = upd.count > 0;
      } catch (e) {
        inventoryError = e instanceof Error ? e.message : String(e);
      }
    }

    res.json({
      ip,
      newIp,
      mask,
      gateway,
      wrote,
      errors: errors.length ? errors : null,
      before: { configIp: beforeConfig, activeIp: preMap.get(OID.ricohActiveIp) ?? null },
      after: { configIp: afterConfig, activeIp },
      pending,
      inventoryUpdated,
      inventoryError,
      note: pending
        ? `IP escrita como ${newIp} (pendiente). La impresora sigue accesible en ${activeIp ?? ip}. Reinicia la impresora (apagar/encender o desde su web) para aplicar el cambio.`
        : afterConfig === newIp && activeIp === newIp
          ? `IP aplicada en caliente: ${newIp}.`
          : `La IP se escribió pero el registro no refleja ${newIp}; revisar manualmente.`,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    reader.close();
    writer.close();
  }
});
