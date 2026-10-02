/**
 * Restablece la contraseña de CUALQUIER cuenta desde la propia máquina de la
 * central (rescate). Cubre el caso crítico: el ÚNICO administrador olvidó su
 * contraseña y nadie puede entrar a restablecerla desde la UI.
 *
 * Debe ejecutarse EN la central (donde vive la BD canónica). Marca la cuenta
 * para cambio obligatorio en el próximo login. Si no se indica contraseña, se
 * genera una temporal y se imprime (una sola vez) para comunicársela al usuario.
 *
 * Uso:
 *   npx tsx apps/server/src/cli/reset-password.ts <username> [nuevaContraseña]
 *   # o por entorno:
 *   PDM_RESET_USER=admin PDM_RESET_PASS=... npx tsx apps/server/src/cli/reset-password.ts
 */
// Carga .env para que DATABASE_URL esté disponible al ejecutar el CLI suelto.
try {
  (process as NodeJS.Process & { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  /* .env opcional */
}
import { prisma } from "../db.js";
import { adminResetPassword } from "../auth/service.js";

async function main() {
  const username = (process.argv[2] ?? process.env.PDM_RESET_USER ?? "").trim();
  const newPassword = process.argv[3] ?? process.env.PDM_RESET_PASS ?? "";

  if (!username) {
    console.error("Uso: npx tsx apps/server/src/cli/reset-password.ts <username> [nuevaContraseña]");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No existe el usuario '${username}'.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const { tempPassword } = await adminResetPassword({
    userId: user.id,
    newPassword: newPassword || undefined,
  });

  console.log(`Contraseña restablecida para '${username}'. Deberá cambiarla en el próximo inicio de sesión.`);
  if (tempPassword) {
    console.log("");
    console.log(`  Contraseña temporal:  ${tempPassword}`);
    console.log("");
    console.log("Comunícala al usuario por un canal seguro. No se volverá a mostrar.");
  } else {
    console.log("Se aplicó la contraseña indicada.");
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
