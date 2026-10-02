/**
 * Printer Device Manager — proceso principal de Electron.
 *
 * Estrategia: la app de escritorio ARRANCA el mismo servidor Express (frontend +
 * API + WebSocket) en localhost y abre una ventana apuntando a él. Así se reutiliza
 * todo el backend sin cambios y, de paso, el equipo puede seguir entrando por
 * navegador a http://IP:PUERTO (sigue siendo servidor de LAN).
 *
 * - Dev (no empaquetado): lanza `scripts/serve-lan.mjs` (tsx) desde el repo.
 * - Empaquetado: ejecuta el servidor ya "bundleado" (resources/server/index.cjs)
 *   con la BD y el secreto en la carpeta de datos del usuario (escribible).
 */
const { app, BrowserWindow, Menu, shell, dialog, session, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Puerto preferido (2626). Si ya está ocupado —p. ej. esta máquina también corre
// el servidor central de la LAN— se busca el siguiente libre para no chocar.
const PREFERRED_PORT = Number(process.env.PDM_DESKTOP_PORT || 2626);
let PORT = PREFERRED_PORT;
let HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
let APP_URL = `http://127.0.0.1:${PORT}`;

/** true si NADA responde en 127.0.0.1:port (puerto libre para nuestro server). */
function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (free) => {
      socket.destroy();
      resolve(free);
    };
    socket.on("connect", () => done(false)); // algo respondió → ocupado
    socket.on("error", () => done(true)); // ECONNREFUSED → libre
    socket.setTimeout(1200, () => done(true));
  });
}

/** Busca el primer puerto libre a partir del preferido (hasta +20). */
async function pickPort(preferred) {
  for (let p = preferred; p < preferred + 20; p++) {
    if (await isPortFree(p)) return p;
  }
  return preferred; // fallback (dejará que el server reporte el error de bind)
}

let serverProc = null;
let mainWindow = null;

/** Un único valor por instalación: se genera y persiste en la carpeta de datos. */
function getOrCreateSecret() {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "session-secret.txt");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* no existe aún */
  }
  const secret = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}

/** Espera a que el servidor responda 200 en /api/health (con timeout). */
function waitForHealth(timeoutMs = 40000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(HEALTH_URL, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) return reject(new Error("El servidor no respondió a tiempo."));
      setTimeout(tick, 700);
    };
    tick();
  });
}

/** Arranca el servidor backend como proceso hijo. */
function startServer() {
  const userData = app.getPath("userData");
  const dbPath = path.join(userData, "pdm.db");

  const env = {
    ...process.env,
    PORT: String(PORT),
    PDM_PORT: String(PORT),
    HOST: "0.0.0.0",
    AUTH_ENFORCE: "true",
    POLLING_ENABLED: "true", // monitoreo automático + evaluación de alertas por ciclo
    SESSION_SECRET: getOrCreateSecret(),
  };

  if (app.isPackaged) {
    // Empaquetado: BD en carpeta de usuario + servidor bundleado.
    env.DATABASE_URL = `file:${dbPath.replace(/\\/g, "/")}`;
    // Datos persistentes (drivers subidos, etc.) en %APPDATA%, NO en la carpeta
    // de instalación: así sobreviven a las actualizaciones de la app.
    env.PDM_DATA_DIR = userData;
    // Login de "cuenta única": el Desktop valida las credenciales contra la
    // central (una misma cuenta sirve en todas las máquinas). Tras el primer
    // login exitoso la credencial se cachea localmente para poder entrar aunque
    // la central quede inaccesible. Configurable por si otra sede usa su
    // propia central.
    env.PDM_CENTRAL_URL = process.env.PDM_CENTRAL_URL || "http://192.0.2.24:2626";
    const resources = process.resourcesPath;
    env.PDM_WEB_OUT = path.join(resources, "web"); // frontend estático empaquetado
    // Runtime de Prisma enviado en resources/server/vendor → resoluble por require.
    env.NODE_PATH = path.join(resources, "server", "vendor");
    ensurePackagedDb(resources, dbPath);
    const serverEntry = path.join(resources, "server", "index.cjs");
    // Ejecuta el bundle con el propio Node de Electron (ELECTRON_RUN_AS_NODE).
    serverProc = spawn(process.execPath, [serverEntry], {
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      cwd: path.join(resources, "server"),
      stdio: "inherit",
    });
  } else {
    // Dev: reutiliza serve-lan.mjs (tsx) y el .env del repo (BD + secreto reales).
    const repoRoot = path.resolve(__dirname, "..", "..");
    delete env.SESSION_SECRET; // en dev, el .env del repo ya lo aporta
    serverProc = spawn("node", [path.join(repoRoot, "scripts", "serve-lan.mjs")], {
      env,
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
    });
  }

  serverProc.on("exit", (code) => {
    serverProc = null;
    if (code && code !== 0 && !app.isQuitting) {
      dialog.showErrorBox("Servidor detenido", `El servidor terminó con código ${code}.`);
    }
  });
}

/** En empaquetado, crea la BD del usuario a partir de la plantilla si no existe. */
function ensurePackagedDb(resources, dbPath) {
  if (fs.existsSync(dbPath)) return;
  const template = path.join(resources, "db-template", "pdm.db");
  try {
    if (fs.existsSync(template)) fs.copyFileSync(template, dbPath);
  } catch (e) {
    dialog.showErrorBox("Base de datos", "No se pudo inicializar la base de datos: " + e.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0b1120",
    title: "Printer Device Manager",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Abre enlaces externos en el navegador del sistema, no en la app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith(APP_URL)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Enlaces que NAVEGAN la ventana (sin target="_blank"): p. ej. `mailto:` del
  // botón "¿Dudas o problemas?" o `tel:`. La navegación interna del SPA usa
  // history API y NO dispara will-navigate, así que aquí solo llegan enlaces a
  // otros protocolos / sitios externos → se abren en la app del sistema (correo,
  // navegador) en vez de romper la ventana.
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith(APP_URL)) return;
    e.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.loadURL(APP_URL);
  mainWindow.on("closed", () => (mainWindow = null));
}

/**
 * Auto-actualización (electron-updater, proveedor "generic").
 *
 * La app consulta el feed del servidor central (definido en package.json →
 * build.publish) para saber si hay una versión más nueva. Si la hay, la descarga
 * en segundo plano y ofrece reiniciar para instalarla; si el usuario pospone, se
 * instala al cerrar. Solo en producción (empaquetado); en dev no hace nada.
 */
let autoUpdater = null; // instancia de electron-updater (solo en producción)
let manualCheck = false; // el usuario pidió el chequeo → mostrar diálogos de resultado

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    console.warn("[update] electron-updater no disponible:", e.message);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    console.warn("[update] error:", err && err.message ? err.message : String(err));
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Buscar actualizaciones",
        message: "No se pudo comprobar si hay actualizaciones.",
        detail: "Verifica la conexión con el servidor e inténtalo de nuevo.",
      });
    }
  });
  autoUpdater.on("update-available", (info) => {
    console.log("[update] versión disponible:", info.version);
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Buscar actualizaciones",
        message: `Hay una versión nueva (${info.version}).`,
        detail: "Se está descargando; te avisaremos cuando esté lista para instalar.",
      });
    }
  });
  autoUpdater.on("update-not-available", () => {
    console.log("[update] la app está al día");
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Buscar actualizaciones",
        message: "Ya tienes la última versión.",
      });
    }
  });
  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Reiniciar e instalar", "Después"],
      defaultId: 0,
      cancelId: 1,
      title: "Actualización disponible",
      message: `Se descargó la versión ${info.version}.`,
      detail: "La aplicación se reiniciará para aplicar la actualización. Tus datos se conservan.",
    });
    if (response === 0) {
      app.isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });

  checkForUpdates(); // al abrir
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000); // y cada 6 horas
}

/** Dispara un chequeo. `manual=true` cuando lo pide el usuario (muestra resultado). */
function checkForUpdates(manual = false) {
  if (!autoUpdater) {
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Buscar actualizaciones",
        message: "Las actualizaciones automáticas solo están disponibles en la app instalada.",
      });
    }
    return;
  }
  if (manual) manualCheck = true;
  autoUpdater
    .checkForUpdates()
    .catch((e) => console.warn("[update] chequeo falló:", e && e.message ? e.message : e));
}

function buildMenu() {
  const template = [
    {
      label: "Archivo",
      submenu: [
        { label: "Recargar", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() },
        { label: "Abrir en el navegador", click: () => shell.openExternal(APP_URL) },
        { type: "separator" },
        { label: "Buscar actualizaciones…", click: () => checkForUpdates(true) },
        { type: "separator" },
        { role: "quit", label: "Salir" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { role: "resetZoom", label: "Zoom normal" },
        { role: "zoomIn", label: "Acercar" },
        { role: "zoomOut", label: "Alejar" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Pantalla completa" },
        { label: "Herramientas de desarrollo", accelerator: "F12", click: () => mainWindow?.webContents.toggleDevTools() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Instancia única: si ya hay una abierta, enfoca esa y sale.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Identidad de la app para Windows: sin esto los toasts nativos pueden no
    // aparecer o salir sin el nombre/ícono correcto. Debe coincidir con el appId.
    if (process.platform === "win32") app.setAppUserModelId("com.pdm.printerdevicemanager");

    // Puente para la interfaz: versión actual + búsqueda de actualizaciones.
    ipcMain.handle("pdm:version", () => app.getVersion());
    ipcMain.handle("pdm:check-updates", () => {
      checkForUpdates(true);
      return true;
    });

    // Elegir puerto libre (evita chocar con un servidor central en el mismo equipo).
    PORT = await pickPort(PREFERRED_PORT);
    HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
    APP_URL = `http://127.0.0.1:${PORT}`;
    if (PORT !== PREFERRED_PORT) {
      console.log(`[desktop] puerto ${PREFERRED_PORT} ocupado → usando ${PORT}`);
    }

    buildMenu();
    // Permitir notificaciones nativas del SO (la app corre en localhost, contexto
    // seguro); el resto de permisos se deniegan por defecto.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "notifications"));
    try {
      startServer();
      await waitForHealth();
      createWindow();
      setupAutoUpdate();
    } catch (e) {
      dialog.showErrorBox("No se pudo iniciar", String(e && e.message ? e.message : e));
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    if (serverProc) {
      try {
        serverProc.kill();
      } catch {
        /* ya terminó */
      }
    }
  });
}
