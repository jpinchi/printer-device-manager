import { PrismaClient } from "@prisma/client";

// Carga .env ANTES de leer DATABASE_URL (por si db.ts se importa antes que config).
try {
  (process as NodeJS.Process & { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  /* .env opcional */
}

/**
 * URL de datos endurecida para SQLite:
 *  - `connection_limit=1`: SQLite es de UN solo escritor; un pool de 1 evita la
 *    contención interna que provocaba "database is locked" / cuelgues.
 *  - `socket_timeout=15`: más margen del engine antes de abortar una consulta
 *    (el "Socket timeout" del incidente era con el default corto).
 * Solo se aplica si hay DATABASE_URL; si no, se deja el default del esquema.
 */
function hardenedUrl(): string | undefined {
  const base = process.env.DATABASE_URL;
  if (!base) return undefined;
  const params: string[] = [];
  if (!/[?&]connection_limit=/.test(base)) params.push("connection_limit=1");
  if (!/[?&]socket_timeout=/.test(base)) params.push("socket_timeout=15");
  if (params.length === 0) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${params.join("&")}`;
}

const url = hardenedUrl();

/** Cliente Prisma único para toda la app. */
export const prisma = new PrismaClient({
  ...(url ? { datasources: { db: { url } } } : {}),
  log: ["error", "warn"],
});

/**
 * Aplica PRAGMAs de robustez a SQLite. Idempotente; llamar UNA vez al arrancar.
 *  - WAL: lectores concurrentes NO bloquean a los escritores (y viceversa);
 *    queda grabado en el archivo de la BD.
 *  - busy_timeout: si el archivo está bloqueado, el escritor ESPERA hasta 10s en
 *    vez de fallar al instante. Esto es lo que evita el cuelgue del incidente.
 *  - synchronous=NORMAL: seguro con WAL y mucho más rápido que FULL.
 *  - wal_autocheckpoint: recorta el WAL periódicamente para que no crezca.
 */
export async function initDb(): Promise<void> {
  const pragmas = [
    "PRAGMA journal_mode=WAL;",
    "PRAGMA busy_timeout=10000;",
    "PRAGMA synchronous=NORMAL;",
    "PRAGMA foreign_keys=ON;",
    "PRAGMA wal_autocheckpoint=1000;",
  ];
  for (const p of pragmas) {
    try {
      // $queryRawUnsafe (no $executeRawUnsafe): varios PRAGMA DEVUELVEN un valor
      // (p. ej. journal_mode=WAL → "wal") y executeRaw los rechaza con "Execute
      // returned results", con lo que WAL NO se aplicaba en BD nuevas (Desktop).
      await prisma.$queryRawUnsafe(p);
    } catch (e) {
      console.error("[db] PRAGMA falló:", p, e instanceof Error ? e.message : e);
    }
  }
}

/** Columnas actuales de una tabla (name → notnull). Vacío si la tabla no existe. */
async function tableColumns(table: string): Promise<Map<string, { notnull: number }>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string; notnull: number | bigint }>>(
    `PRAGMA table_info('${table}')`,
  );
  return new Map(rows.map((r) => [r.name, { notnull: Number(r.notnull) }]));
}

/**
 * Migración de esquema EN RUNTIME (idempotente). Prisma no migra la BD del
 * usuario en producción, y el instalador solo trae una plantilla para BD NUEVAS;
 * al ACTUALIZAR, la BD existente conserva el esquema viejo. Aquí se añaden las
 * columnas que falten para que el código nuevo no rompa (p. ej. el login: sin
 * `recoveryCodeHash`/`mustChangePassword`, `authenticate`/`mirrorUser` daban 500).
 * Se ejecuta al arrancar, después de initDb. Nunca lanza: registra y sigue.
 */
export async function ensureSchema(): Promise<void> {
  try {
    // --- User: columnas añadidas para la recuperación de contraseña ---------
    const user = await tableColumns("User");
    if (user.size > 0) {
      if (!user.has("recoveryCodeHash")) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "recoveryCodeHash" TEXT`);
        console.log("[db] migración: User.recoveryCodeHash añadida");
      }
      if (!user.has("mustChangePassword")) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT 0`);
        console.log("[db] migración: User.mustChangePassword añadida");
      }
    }

    // --- ModelImage: bytes en BD + bandera de asignación --------------------
    const mi = await tableColumns("ModelImage");
    if (mi.size > 0) {
      if (!mi.has("data")) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "ModelImage" ADD COLUMN "data" BLOB`);
        console.log("[db] migración: ModelImage.data añadida");
      }
      if (!mi.has("assigned")) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "ModelImage" ADD COLUMN "assigned" BOOLEAN NOT NULL DEFAULT 1`);
        console.log("[db] migración: ModelImage.assigned añadida");
      }
      // filePath pasó de NOT NULL a NULLABLE. SQLite no permite alterar NOT NULL
      // in-place → se reconstruye la tabla (ya con data/assigned presentes).
      const fp = mi.get("filePath");
      if (fp && fp.notnull === 1) {
        await rebuildModelImageFilePathNullable();
        console.log("[db] migración: ModelImage.filePath ahora acepta NULL");
      }
    }

    // --- WorkUnit (tabla nueva) + Printer.workUnitId ------------------------
    // Sin estos, `include: { workUnit: true }` en el listado de impresoras da
    // 500 en una BD que venga de antes de esta función.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "WorkUnit" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WorkUnit_name_key" ON "WorkUnit"("name")`);
    const printer = await tableColumns("Printer");
    if (printer.size > 0 && !printer.has("workUnitId")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Printer" ADD COLUMN "workUnitId" TEXT`);
      console.log("[db] migración: Printer.workUnitId añadida");
    }
  } catch (e) {
    console.error("[db] ensureSchema:", e instanceof Error ? e.message : e);
  }
}

/** Reconstruye ModelImage para que filePath acepte NULL (rebuild seguro de SQLite). */
async function rebuildModelImageFilePathNullable(): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys=OFF");
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "ModelImage_new" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "key" TEXT NOT NULL,
        "manufacturer" TEXT NOT NULL,
        "model" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "data" BLOB,
        "filePath" TEXT,
        "mimeType" TEXT NOT NULL,
        "fileSize" INTEGER NOT NULL,
        "assigned" BOOLEAN NOT NULL DEFAULT 1,
        "updatedAt" DATETIME NOT NULL
      )`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ModelImage_new" ("id","key","manufacturer","model","fileName","data","filePath","mimeType","fileSize","assigned","updatedAt")
       SELECT "id","key","manufacturer","model","fileName","data","filePath","mimeType","fileSize","assigned","updatedAt" FROM "ModelImage"`,
    );
    await prisma.$executeRawUnsafe(`DROP TABLE "ModelImage"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ModelImage_new" RENAME TO "ModelImage"`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "ModelImage_key_key" ON "ModelImage"("key")`);
  } finally {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys=ON");
  }
}

/**
 * Comprueba que la BD RESPONDE (SELECT 1) con un timeout corto. Devuelve true/false;
 * nunca lanza. Sirve para un /health que refleje el estado real (detecta cuelgues).
 */
export async function pingDb(timeoutMs = 2500): Promise<boolean> {
  try {
    await Promise.race([
      prisma.$queryRawUnsafe("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("db-timeout")), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}
