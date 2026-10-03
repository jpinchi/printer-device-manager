/**
 * Pruebas de la community SNMP por impresora (printer-community.ts).
 *
 * - Se guarda cifrada y nunca sale en getPrinter/listPrinters.
 * - El polling sondea con la community guardada, o con la del entorno si la
 *   impresora no tiene (o tiene el marcador "***" de versiones anteriores).
 *
 * IPs ficticias 10.96.0.x exclusivas de esta prueba; se limpian al final.
 * Se fija PDM_SECRET_KEY ANTES de importar para que la llave sea determinista
 * y no se cree ningún archivo `.pdm-secret.key` en el repo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ProbeResult, SnmpCredentials } from "@pdm/types";

type Mods = {
  db: typeof import("./db.js");
  repo: typeof import("./printers-repo.js");
  community: typeof import("./printer-community.js");
  secrets: typeof import("./secrets.js");
  cycle: typeof import("./polling/cycle.js");
  config: typeof import("./config.js");
  snmp: typeof import("@pdm/snmp-core");
};
let m: Mods;

const IP_PREFIX = "10.96.0.";
let defaultCommunity: string;

async function cleanup() {
  await m.db.prisma.printer.deleteMany({ where: { ipAddress: { startsWith: IP_PREFIX } } });
}

/** Probe simulado con un número de serie propio (saveProbe consolida por serie). */
async function mockProbe(ip: string, serial: string): Promise<ProbeResult> {
  const creds: SnmpCredentials = { version: "v2c", community: "x", timeoutMs: 1000, retries: 0 };
  const result = await m.snmp.probe(ip, creds, { mock: true });
  result.info.serialNumber = serial;
  return result;
}

beforeAll(async () => {
  process.env.PDM_SECRET_KEY = "clave-de-prueba-para-tests-1234567890";
  m = {
    db: await import("./db.js"),
    repo: await import("./printers-repo.js"),
    community: await import("./printer-community.js"),
    secrets: await import("./secrets.js"),
    cycle: await import("./polling/cycle.js"),
    config: await import("./config.js"),
    snmp: await import("@pdm/snmp-core"),
  };
  defaultCommunity = m.config.config.snmp.defaultCommunity;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await m.db.prisma.$disconnect();
});

describe("communityFor / encryptCommunity", () => {
  it("usa la community del entorno si no hay nada guardado", () => {
    expect(m.community.communityFor(null)).toBe(defaultCommunity);
    expect(m.community.communityFor("")).toBe(defaultCommunity);
  });

  it("trata el marcador '***' de versiones anteriores como 'sin community'", () => {
    expect(m.community.communityFor("***")).toBe(defaultCommunity);
  });

  it("cifra y descifra la community", () => {
    const stored = m.community.encryptCommunity("rw-secreta");
    expect(stored).not.toBeNull();
    expect(m.secrets.isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain("rw-secreta");
    expect(m.community.communityFor(stored)).toBe("rw-secreta");
  });

  it("no guarda nada si no se indicó community", () => {
    expect(m.community.encryptCommunity(undefined)).toBeNull();
    expect(m.community.encryptCommunity("")).toBeNull();
  });

  it("vuelve a la del entorno si el dato cifrado está corrupto", () => {
    expect(m.community.communityFor("enc.v1.AAAA.BBBB.CCCC")).toBe(defaultCommunity);
  });
});

describe("saveProbe guarda la community cifrada y no la expone", () => {
  const IP = `${IP_PREFIX}11`;

  it("al crear: la guarda cifrada y getPrinter/listPrinters no la devuelven", async () => {
    const saved = await m.repo.saveProbe(await mockProbe(IP, "TEST-COMM-1"), "secreta-123", "v2c");
    expect(saved).not.toBeNull();

    const raw = await m.db.prisma.printer.findUnique({ where: { ipAddress: IP } });
    expect(m.secrets.isEncrypted(raw?.snmpCommunityEncrypted)).toBe(true);
    expect(raw?.snmpCommunityEncrypted).not.toContain("secreta-123");

    expect(saved).not.toHaveProperty("snmpCommunityEncrypted");
    expect(await m.repo.getPrinter(saved!.id)).not.toHaveProperty("snmpCommunityEncrypted");
    const listed = (await m.repo.listPrinters()).find((p) => p.ipAddress === IP);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty("snmpCommunityEncrypted");

    expect(await m.repo.getPrinterCommunity(saved!.id)).toBe("secreta-123");
  });

  it("al re-sondear sin community conserva la que tenía", async () => {
    const saved = await m.repo.saveProbe(await mockProbe(IP, "TEST-COMM-1"), undefined, "v2c");
    expect(await m.repo.getPrinterCommunity(saved!.id)).toBe("secreta-123");
  });

  it("al volver a agregarla con otra community, la reemplaza", async () => {
    const saved = await m.repo.saveProbe(await mockProbe(IP, "TEST-COMM-1"), "nueva-456", "v2c");
    expect(await m.repo.getPrinterCommunity(saved!.id)).toBe("nueva-456");
  });

  it("sin community explícita, usa la del entorno", async () => {
    const saved = await m.repo.saveProbe(await mockProbe(`${IP_PREFIX}12`, "TEST-COMM-2"), undefined, "v2c");
    const raw = await m.db.prisma.printer.findUnique({ where: { id: saved!.id } });
    expect(raw?.snmpCommunityEncrypted).toBeNull();
    expect(await m.repo.getPrinterCommunity(saved!.id)).toBe(defaultCommunity);
  });
});

describe("runPollingCycle sondea con la community de cada impresora", () => {
  it("usa la guardada, y la del entorno si no hay o es el marcador antiguo", async () => {
    const withCommunity = `${IP_PREFIX}21`;
    const legacy = `${IP_PREFIX}22`;
    const none = `${IP_PREFIX}23`;
    await m.db.prisma.printer.createMany({
      data: [
        { name: "Con community", ipAddress: withCommunity, snmpCommunityEncrypted: m.community.encryptCommunity("rw-sede-norte") },
        { name: "Marcador antiguo", ipAddress: legacy, snmpCommunityEncrypted: "***" },
        { name: "Sin community", ipAddress: none },
      ],
    });

    const seen: Record<string, string> = {};
    await m.cycle.runPollingCycle(m.db.prisma, {
      mock: true,
      kinds: ["status"],
      where: { ipAddress: { in: [withCommunity, legacy, none] } },
      probeFn: async (ip, creds, opts) => {
        seen[ip] = creds.community;
        return m.snmp.probe(ip, creds, opts);
      },
    });

    expect(seen[withCommunity]).toBe("rw-sede-norte");
    expect(seen[legacy]).toBe(defaultCommunity);
    expect(seen[none]).toBe(defaultCommunity);
  });
});
