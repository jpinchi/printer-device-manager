/**
 * Catálogo de drivers de impresora (A+B+C).
 *
 *  A) Metadatos por modelo con enlace oficial de descarga.
 *  B) Instalador ALOJADO en el servidor (subida/descarga de archivos).
 *  C) Instalación en el HOST Windows del servidor (pnputil para .inf, ejecutar
 *     el .exe con flags silenciosos). Solo Administrator; solo afecta a ESTE
 *     equipo (no a las PClientes remotas).
 *
 * La ruta absoluta del archivo (`filePath`) NUNCA se expone al cliente.
 */
import { Router } from "express";
import multer from "multer";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "./db.js";

export const driversRouter = Router();

/**
 * Carpeta donde se guardan los instaladores subidos.
 *
 * DEBE ser una ubicación PERSISTENTE. En la app de escritorio, `PDM_DATA_DIR`
 * apunta a la carpeta de datos del usuario (%APPDATA%); si se guardaran en el
 * cwd (dentro de la instalación) se BORRARÍAN en cada actualización, dejando
 * la BD con registros que apuntan a archivos inexistentes. En el servidor
 * central (sin PDM_DATA_DIR) se usa el cwd del repo, como siempre.
 */
const DRIVERS_DIR = path.resolve(process.env.PDM_DATA_DIR || process.cwd(), "drivers");

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await fs.mkdir(DRIVERS_DIR, { recursive: true });
    cb(null, DRIVERS_DIR);
  },
  filename: (_req, file, cb) => {
    // Prefijo único + nombre original saneado.
    const safe = file.originalname.replace(/[^\w.\- ]+/g, "_");
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500 MB

/** Forma pública (sin exponer la ruta absoluta del archivo). */
function toPublic(d: {
  id: string;
  manufacturer: string;
  models: string;
  name: string;
  os: string;
  version: string | null;
  url: string | null;
  fileName: string | null;
  filePath: string | null;
  fileSize: number | null;
  installArgs: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const ext = d.fileName ? path.extname(d.fileName).toLowerCase() : "";
  return {
    id: d.id,
    manufacturer: d.manufacturer,
    models: d.models,
    name: d.name,
    os: d.os,
    version: d.version,
    url: d.url,
    fileName: d.fileName,
    fileSize: d.fileSize,
    hasFile: !!d.filePath,
    installArgs: d.installArgs,
    notes: d.notes,
    // Instalable en el host si hay archivo .inf/.exe/.zip (Windows).
    installable: !!d.filePath && (ext === ".inf" || ext === ".exe" || ext === ".zip"),
    fileKind: ext.replace(".", "") || null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

// --- Listar ----------------------------------------------------------------
driversRouter.get("/", async (_req, res) => {
  const rows = await prisma.driverPackage.findMany({ orderBy: [{ manufacturer: "asc" }, { name: "asc" }] });
  res.json(rows.map(toPublic));
});

// --- Crear metadatos -------------------------------------------------------
driversRouter.post("/", async (req, res) => {
  const b = req.body ?? {};
  const manufacturer = String(b.manufacturer ?? "").trim();
  const models = String(b.models ?? "").trim();
  const name = String(b.name ?? "").trim();
  if (!manufacturer || !models || !name) {
    return res.status(400).json({ error: "Faltan campos: fabricante, modelos y nombre son obligatorios" });
  }
  const created = await prisma.driverPackage.create({
    data: {
      manufacturer,
      models,
      name,
      os: String(b.os ?? "Windows"),
      version: b.version ? String(b.version) : null,
      url: b.url ? String(b.url) : null,
      installArgs: b.installArgs ? String(b.installArgs) : null,
      notes: b.notes ? String(b.notes) : null,
    },
  });
  res.status(201).json(toPublic(created));
});

// --- Editar metadatos ------------------------------------------------------
driversRouter.patch("/:id", async (req, res) => {
  const b = req.body ?? {};
  try {
    const updated = await prisma.driverPackage.update({
      where: { id: req.params.id },
      data: {
        manufacturer: b.manufacturer != null ? String(b.manufacturer).trim() : undefined,
        models: b.models != null ? String(b.models).trim() : undefined,
        name: b.name != null ? String(b.name).trim() : undefined,
        os: b.os != null ? String(b.os) : undefined,
        version: b.version !== undefined ? (b.version ? String(b.version) : null) : undefined,
        url: b.url !== undefined ? (b.url ? String(b.url) : null) : undefined,
        installArgs: b.installArgs !== undefined ? (b.installArgs ? String(b.installArgs) : null) : undefined,
        notes: b.notes !== undefined ? (b.notes ? String(b.notes) : null) : undefined,
      },
    });
    res.json(toPublic(updated));
  } catch {
    res.status(404).json({ error: "Driver no encontrado" });
  }
});

// --- Subir instalador ------------------------------------------------------
driversRouter.post("/:id/file", upload.single("file"), async (req, res) => {
  const id = String(req.params.id);
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Falta el archivo (campo 'file')" });
  const existing = await prisma.driverPackage.findUnique({ where: { id } });
  if (!existing) {
    await fs.unlink(file.path).catch(() => {});
    return res.status(404).json({ error: "Driver no encontrado" });
  }
  // Reemplaza el archivo anterior si lo había.
  if (existing.filePath) await fs.unlink(existing.filePath).catch(() => {});
  const updated = await prisma.driverPackage.update({
    where: { id },
    data: { fileName: file.originalname, filePath: file.path, fileSize: file.size },
  });
  res.json(toPublic(updated));
});

// --- Descargar instalador --------------------------------------------------
driversRouter.get("/:id/download", async (req, res) => {
  const d = await prisma.driverPackage.findUnique({ where: { id: req.params.id } });
  if (!d?.filePath) return res.status(404).json({ error: "Este driver no tiene archivo alojado" });
  res.download(d.filePath, d.fileName ?? "driver");
});

// --- Instalar en el HOST del servidor (Windows) ----------------------------
driversRouter.post("/:id/install", async (req, res) => {
  if (process.platform !== "win32") {
    return res.status(400).json({ error: "La instalación solo está disponible en el host Windows del servidor." });
  }
  const d = await prisma.driverPackage.findUnique({ where: { id: req.params.id } });
  if (!d?.filePath) return res.status(400).json({ error: "Este driver no tiene un instalador alojado." });

  const ext = path.extname(d.fileName ?? d.filePath).toLowerCase();
  if (![".inf", ".exe", ".zip"].includes(ext)) {
    return res.status(400).json({ error: "Solo se pueden instalar automáticamente archivos .inf, .exe o .zip." });
  }

  // Impresora opcional del inventario: además del driver, se crea su cola (puerto
  // TCP/IP + Add-Printer) en ESTA máquina, para que quede lista para imprimir.
  const printerId = String((req.body ?? {}).printerId ?? "").trim();
  let printer: { ip: string; model: string; name: string } | null = null;
  if (printerId) {
    const pr = await prisma.printer.findUnique({ where: { id: printerId }, select: { ipAddress: true, model: true, name: true } });
    if (!pr) return res.status(400).json({ error: "La impresora del inventario no existe." });
    printer = { ip: pr.ipAddress, model: String(pr.model ?? "").trim(), name: (pr.name || pr.model || pr.ipAddress).trim() };
  }

  // Estrategia: se genera un script .ps1 que corre ELEVADO (Start-Process
  // -Verb RunAs → un único UAC) y que CAPTURA toda la salida de pnputil/instalador
  // en un LOG que luego leemos (así vemos el motivo real de un fallo). Los .inf se
  // instalan UNO A UNO — los paquetes RICOH traen INFs auxiliares que, con
  // comodín, hacen fallar todo; aquí basta con que UNO se añada correctamente.
  const q = (s: string) => s.replace(/'/g, "''");
  const argList = (d.installArgs ?? "").split(" ").filter(Boolean);
  // -ArgumentList NO admite un array vacío: se OMITE cuando no hay flags.
  const psArgSwitch = argList.length ? ` -ArgumentList @(${argList.map((a) => `'${q(a)}'`).join(",")})` : "";
  const extractDir = path.join(DRIVERS_DIR, "extracted", d.id);
  const scriptPath = path.join(DRIVERS_DIR, `_install-${d.id}.ps1`);
  const logPath = path.join(DRIVERS_DIR, `_install-${d.id}.log`);

  // Cuerpo del script elevado (ya corre como administrador). El driver install
  // marca $driverOk (NO sale); luego, si se pidió impresora, se agrega la cola;
  // al final se reporta el resultado combinado (ANYOK).
  const body: string[] = [
    "$ErrorActionPreference='Continue'",
    `$log='${q(logPath)}'`,
    "'' | Set-Content -LiteralPath $log",
    "function Log($m){ $m | Add-Content -LiteralPath $log }",
    "$driverOk=$false; $pdmInfDir=$null",
    "try {",
    `  Unblock-File -LiteralPath '${q(d.filePath)}' -ErrorAction SilentlyContinue`,
  ];

  const installInfsLoop = [
    "  foreach ($inf in $infs) {",
    "    Log ('=== ' + $inf.FullName + ' ===')",
    "    $o = & pnputil.exe /add-driver $inf.FullName /install 2>&1 | Out-String",
    "    Log $o",
    "    Log ('EXIT=' + $LASTEXITCODE)",
    "    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 3010) { $driverOk=$true }",
    "  }",
  ];

  if (ext === ".inf") {
    body.push(
      `  $infs = @(Get-Item -LiteralPath '${q(d.filePath)}')`,
      `  $pdmInfDir = Split-Path -Parent '${q(d.filePath)}'`,
      ...installInfsLoop,
    );
  } else if (ext === ".exe") {
    const dir = path.dirname(d.filePath);
    body.push(
      `  Log ('RUN EXE ${q(path.basename(d.filePath))}')`,
      `  $p = Start-Process -FilePath '${q(d.filePath)}'${psArgSwitch} -WorkingDirectory '${q(dir)}' -Wait -PassThru`,
      "  Log ('EXE_EXIT=' + $p.ExitCode)",
      "  if ($p.ExitCode -eq 0) { $driverOk=$true }",
    );
  } else {
    // .zip → extraer y PREFERIR los .inf vía pnputil (silencioso, SIN internet).
    // Los asistentes GUI de RICOH (RV_SETUP.exe / driver_web_installer.exe) son
    // instaladores EN LÍNEA que fallan sin conexión ("Cannot connect with the
    // server"). Solo si el paquete NO trae ningún .inf se cae al asistente .exe.
    body.push(
      `  $dest='${q(extractDir)}'`,
      "  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }",
      `  Expand-Archive -LiteralPath '${q(d.filePath)}' -DestinationPath $dest -Force`,
      "  Get-ChildItem -Path $dest -Recurse -File | Unblock-File -ErrorAction SilentlyContinue",
      "  $infs = @(Get-ChildItem -Path $dest -Recurse -Filter *.inf)",
      "  Log ('INFS=' + $infs.Count)",
      "  if ($infs.Count -gt 0) {",
      "    $pdmInfDir = $dest",
      ...installInfsLoop.map((l) => "  " + l),
      "  } else {",
      "    $exe = Get-ChildItem -Path $dest -Recurse -Include *setup*.exe,*install*.exe,RV_SETUP.exe | Select-Object -First 1",
      "    if (-not $exe) { $exe = Get-ChildItem -Path $dest -Recurse -Filter *.exe | Select-Object -First 1 }",
      "    if (-not $exe) { Log 'ERR=El ZIP no contiene ningún .inf ni .exe instalable.' }",
      "    elseif ($true) {",
      "      Log ('RUN EXE ' + $exe.FullName)",
      `      $p = Start-Process -FilePath $exe.FullName${psArgSwitch} -WorkingDirectory $exe.DirectoryName -Wait -PassThru`,
      "      Log ('EXE_EXIT=' + $p.ExitCode)",
      "      if ($p.ExitCode -eq 0) { $driverOk=$true }",
      "    }",
      "  }",
    );
  }

  body.push("} catch { Log ('EXC=' + $_.Exception.Message); $driverOk=$false }");
  body.push("Log ('DRIVER_OK=' + $driverOk)");

  // Agregar la impresora (cola) del inventario, si se pidió. Sin impresora, el
  // éxito es solo el del driver.
  body.push("$printerOk=$true");
  if (printer) {
    body.push(
      "if ($driverOk) {",
      "  try {",
      `    $pip='${q(printer.ip)}'; $pmodel='${q(printer.model)}'; $pname='${q(printer.name)}'`,
      "    $port='IP_'+$pip",
      "    if(-not (Get-PrinterPort -Name $port -ErrorAction SilentlyContinue)){ Add-PrinterPort -Name $port -PrinterHostAddress $pip; Log ('PUERTO '+$port+' creado') } else { Log ('PUERTO '+$port+' ya existía') }",
      "    $drvName=$null; $srcInf=$null; $anyName=$null; $anyInf=$null",
      "    if($pdmInfDir){ foreach($inf in @(Get-ChildItem -Path $pdmInfDir -Recurse -Filter *.inf)){ $ms=Select-String -LiteralPath $inf.FullName -Pattern ('\"([^\"]*'+[Regex]::Escape($pmodel)+'[^\"]*)\"') -AllMatches -ErrorAction SilentlyContinue; foreach($line in $ms){ foreach($mm in $line.Matches){ $nm=$mm.Groups[1].Value; if(-not $anyName){ $anyName=$nm; $anyInf=$inf.FullName }; if(($nm -like 'RICOH*') -and (-not $drvName)){ $drvName=$nm; $srcInf=$inf.FullName } } } } }",
      "    if(-not $drvName){ $drvName=$anyName; $srcInf=$anyInf }",
      "    if(-not $drvName){ Log ('SIN_NOMBRE_DRIVER_EN_INF modelo='+$pmodel); $printerOk=$false }",
      "    else {",
      "      Log ('DRIVER_NAME='+$drvName)",
      "      if(-not (Get-PrinterDriver -Name $drvName -ErrorAction SilentlyContinue)){ try{ Add-PrinterDriver -Name $drvName -ErrorAction Stop; Log 'Add-PrinterDriver OK' }catch{ Add-PrinterDriver -Name $drvName -InfPath $srcInf -ErrorAction Stop; Log 'Add-PrinterDriver (InfPath) OK' } }",
      "      if(-not (Get-Printer -Name $pname -ErrorAction SilentlyContinue)){ Add-Printer -Name $pname -DriverName $drvName -PortName $port; Log ('IMPRESORA agregada: '+$pname) } else { Log ('IMPRESORA ya existía: '+$pname) }",
      "      $printerOk=$true",
      "    }",
      "  } catch { Log ('ADDPRINTER_ERR='+$_.Exception.Message); $printerOk=$false }",
      "} else { $printerOk=$false }",
    );
  }

  body.push("$ok = ($driverOk -and $printerOk)");
  body.push("Log ('ANYOK=' + $ok)");
  body.push("if ($ok) { exit 0 } else { exit 1 }");

  // Lanzador (NO elevado) que eleva el script → un solo aviso de UAC. Se escribe
  // como .ps1 aparte para evitar comillas anidadas: la ruta del script (con
  // ESPACIOS, "C:\Printer Device Manager\…") se pasa a -File entrecomillada
  // dentro de un ArgumentList de un solo string (si se pasa como array,
  // Start-Process no la entrecomilla y el PowerShell elevado no la encuentra →
  // no se ejecuta nada).
  const wrapperPath = path.join(DRIVERS_DIR, `_wrap-${d.id}.ps1`);
  const wrapperBody = [
    `$sp = '${q(scriptPath)}'`,
    // La consola de PowerShell elevada se lanza OCULTA (-WindowStyle Hidden en
    // el proceso y en sus argumentos). El UAC sigue apareciendo (obligatorio) y,
    // si el instalador es un asistente GUI, su propia ventana sí se muestra.
    '$a = \'-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "\' + $sp + \'"\'',
    "$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList $a",
    "Write-Output ('WRAP=' + $p.ExitCode)",
  ].join("\r\n");

  try {
    await fs.mkdir(DRIVERS_DIR, { recursive: true });
    await fs.writeFile(scriptPath, "\uFEFF" + body.join("\r\n"), "utf8");
    await fs.writeFile(wrapperPath, "\uFEFF" + wrapperBody, "utf8");
  } catch (e) {
    return res.status(500).json({ error: "No se pudo preparar el instalador: " + (e as Error).message });
  }

  execFile(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", wrapperPath],
    { windowsHide: true, timeout: 15 * 60_000 },
    async (_err, stdout) => {
      const wrapOut = String(stdout ?? "");
      let logText = "";
      try {
        logText = await fs.readFile(logPath, "utf8");
      } catch {
        /* sin log */
      }
      await fs.unlink(scriptPath).catch(() => {});
      await fs.unlink(wrapperPath).catch(() => {});

      const cancelled = /cancel|operation was canceled|el usuario/i.test(wrapOut) && !logText;
      const anyOk = /ANYOK=True/i.test(logText);
      const message = cancelled
        ? "Se canceló el permiso de administrador (UAC). Vuelve a intentarlo y acepta el aviso."
        : anyOk
          ? printer
            ? `Driver instalado y la impresora "${printer.name}" quedó lista en este equipo.`
            : "Driver instalado correctamente en este equipo."
          : logText
            ? "La instalación no se completó. Abre «Ver detalle» para ver el motivo."
            : "No se pudo ejecutar la instalación (¿se rechazó el aviso de administrador?).";

      res.json({
        ok: anyOk,
        code: anyOk ? 0 : 1,
        stdout: logText.slice(-8000),
        stderr: cancelled ? wrapOut.slice(0, 2000) : "",
        message,
      });
    },
  );
});

// --- Eliminar --------------------------------------------------------------
driversRouter.delete("/:id", async (req, res) => {
  const d = await prisma.driverPackage.findUnique({ where: { id: req.params.id } });
  if (!d) return res.status(404).json({ error: "Driver no encontrado" });
  if (d.filePath) await fs.unlink(d.filePath).catch(() => {});
  // Limpia también la carpeta extraída de un ZIP, si existía.
  await fs.rm(path.join(DRIVERS_DIR, "extracted", d.id), { recursive: true, force: true }).catch(() => {});
  await prisma.driverPackage.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
