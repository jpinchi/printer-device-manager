/**
 * Crea o promueve un usuario Administrator (bootstrap de autorización).
 *
 * La regla "primer usuario = Administrator" solo aplica en una BD vacía; con la
 * BD ya poblada, este script es la vía para obtener/asegurar un admin.
 *
 * Uso:
 *   npx tsx apps/server/src/cli/create-admin.ts <username> <password>
 *   # o por entorno:
 *   PDM_ADMIN_USER=admin PDM_ADMIN_PASS=... npx tsx apps/server/src/cli/create-admin.ts
 */
// Carga .env para que DATABASE_URL esté disponible al ejecutar el CLI suelto.
try {
  (process as NodeJS.Process & { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  /* .env opcional */
}
import { prisma } from "../db.js";
import { hashPassword } from "../auth/index.js";

async function main() {
  const username = (process.argv[2] ?? process.env.PDM_ADMIN_USER ?? "").trim();
  const password = process.argv[3] ?? process.env.PDM_ADMIN_PASS ?? "";

  if (!username || !password) {
    console.error("Uso: npx tsx apps/server/src/cli/create-admin.ts <username> <password>");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, role: "Administrator", active: true },
    create: { username, passwordHash, role: "Administrator", active: true },
  });

  console.log(`Administrator listo: ${user.username} (id ${user.id})`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
