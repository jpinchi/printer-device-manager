/**
 * Arranca el servidor unificado (API + WebSocket + frontend estático) en un
 * único puerto, accesible desde cualquier máquina de la LAN.
 *
 *   npm run serve                 → puerto 2626 (por defecto)
 *   PDM_PORT=2700 npm run serve   → puerto 2700
 *
 * Antes de la primera ejecución, compila el frontend:  npm run build:web
 * (o usa el atajo:  npm run start:lan  que compila y arranca).
 */
import { spawn } from "node:child_process";

const port = process.env.PDM_PORT || process.env.PORT || "2626";

const env = { ...process.env };
env.PORT = port;
env.HOST = env.HOST || "0.0.0.0"; // escuchar en todas las interfaces (LAN)

console.log(`\n▶ Printer Device Manager — servidor unificado`);
console.log(`  Local:   http://localhost:${port}`);
console.log(`  LAN:     http://<IP-de-esta-maquina>:${port}`);
console.log(`  (SNMP_MOCK=${env.SNMP_MOCK ?? "false"} · AUTH_ENFORCE=${env.AUTH_ENFORCE ?? "false"})\n`);

const child = spawn("npx", ["tsx", "apps/server/src/index.ts"], {
  stdio: "inherit",
  env,
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
