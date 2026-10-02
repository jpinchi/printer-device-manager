/**
 * Instalación remota de drivers en PCs Windows SIN WinRM: usa el recurso
 * administrativo `admin$` (SMB) para copiar el instalador y WMI sobre DCOM para
 * ejecutarlo, autenticando con credenciales de administrador de dominio.
 *
 *  POST /probe   → Etapa 1 (SIN RIESGO): prueba SMB (admin$) + WMI (DCOM) contra
 *                  un equipo destino. No instala nada.
 *  POST /install → Etapa 2: copia el driver por admin$ y lo ejecuta por WMI.
 *
 * Seguridad:
 *  - Solo Administrator (authz).
 *  - La contraseña llega por-petición y se pasa al PowerShell por VARIABLE DE
 *    ENTORNO; el script construye un PSCredential (objeto) → NUNCA va en la línea
 *    de comandos ni en logs; el .ps1 temporal se borra al terminar.
 *  - Ejecuta como admin en el equipo remoto: función de IT autorizada. En redes
 *    con EDR, coordinar con seguridad (lista blanca de la app/cuenta).
 */
import { Router } from "express";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { prisma } from "./db.js";
import { safeForwardUrl, fetchWithTimeout } from "./safe-url.js";
import { encryptSecret, decryptSecret } from "./secrets.js";

export const remoteInstallRouter = Router();

const isHost = (s: string) => /^[A-Za-z0-9._-]{1,255}$/.test(s);

// --- DELEGACIÓN A UN HUB ----------------------------------------------------
// Cuando hay un "hub" configurado (un servidor que SÍ puede autenticar al
// dominio, p. ej. el central), el probe/install NO corren localmente: se
// reenvían al hub, que los ejecuta y devuelve el resultado. Así un Desktop en
// una estación bloqueada por política de dominio igual puede instalar remoto.
// La config vive en un JSON de la carpeta de datos (NO en la BD → sin migración).
const HUB_FILE = path.join(process.env.PDM_DATA_DIR || process.cwd(), "delegation.json");
interface HubConfig {
  hubUrl?: string;
  hubUser?: string;
  hubPassword?: string;
}
async function readHub(): Promise<HubConfig> {
  try {
    const cfg = JSON.parse(await fs.readFile(HUB_FILE, "utf8")) as HubConfig;
    // La contraseña se guarda cifrada en reposo; se descifra para usarla. Los
    // archivos antiguos en texto plano se leen igual (migración transparente).
    if (cfg.hubPassword) cfg.hubPassword = decryptSecret(cfg.hubPassword);
    return cfg;
  } catch {
    return {};
  }
}
async function writeHub(cfg: HubConfig): Promise<void> {
  // Cifra la contraseña antes de tocar el disco (AES-256-GCM, ver secrets.ts).
  const onDisk: HubConfig = { ...cfg };
  if (onDisk.hubPassword) onDisk.hubPassword = encryptSecret(onDisk.hubPassword);
  await fs.writeFile(HUB_FILE, JSON.stringify(onDisk, null, 2), { encoding: "utf8", mode: 0o600 });
}
/** Autentica contra el hub y devuelve un token del app. */
async function hubLogin(h: HubConfig): Promise<string> {
  // Revalida el destino en cada uso (defensa en profundidad) y aplica timeout.
  const base = safeForwardUrl(h.hubUrl);
  if (!base) throw new Error("la URL del hub no es válida o no está permitida");
  const r = await fetchWithTimeout(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: h.hubUser, password: h.hubPassword }),
  });
  if (!r.ok) throw new Error(`no se pudo autenticar con el hub (HTTP ${r.status})`);
  const data = (await r.json()) as { token?: string };
  if (!data.token) throw new Error("el hub no devolvió token");
  return data.token;
}
/** Reenvía una petición JSON al hub (con login previo). */
async function hubProxy(h: HubConfig, method: string, apiPath: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const base = safeForwardUrl(h.hubUrl);
  if (!base) throw new Error("la URL del hub no es válida o no está permitida");
  const token = await hubLogin(h);
  const r = await fetchWithTimeout(`${base}${apiPath}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await r.json();
  } catch {
    /* sin cuerpo JSON */
  }
  return { status: r.status, body: parsed };
}

// Config del hub: GET (enmascara la contraseña) / PATCH (guardar o limpiar).
remoteInstallRouter.get("/hub", async (_req, res) => {
  const h = await readHub();
  res.json({ enabled: !!h.hubUrl, hubUrl: h.hubUrl ?? "", hubUser: h.hubUser ?? "", hasPassword: !!h.hubPassword });
});
remoteInstallRouter.patch("/hub", async (req, res) => {
  const b = req.body ?? {};
  const cur = await readHub();
  let hubUrl = cur.hubUrl;
  if (b.hubUrl !== undefined) {
    const raw = String(b.hubUrl || "").trim();
    if (!raw) {
      await writeHub({});
      return res.json({ enabled: false, hubUrl: "", hubUser: "", hasPassword: false });
    }
    // Valida el destino: solo http(s) a un host de la red (no link-local/metadata).
    const safe = safeForwardUrl(raw);
    if (!safe) {
      return res.status(400).json({ error: "URL del hub inválida o no permitida (usa http(s):// a un host de la red)." });
    }
    hubUrl = safe;
  }
  if (!hubUrl) {
    await writeHub({});
    return res.json({ enabled: false, hubUrl: "", hubUser: "", hasPassword: false });
  }
  const next: HubConfig = {
    hubUrl,
    hubUser: b.hubUser !== undefined ? String(b.hubUser || "").trim() : cur.hubUser,
    hubPassword: typeof b.hubPassword === "string" && b.hubPassword.length > 0 ? b.hubPassword : cur.hubPassword,
  };
  await writeHub(next);
  res.json({ enabled: true, hubUrl: next.hubUrl, hubUser: next.hubUser ?? "", hasPassword: !!next.hubPassword });
});

// Catálogo del hub (para poblar los selectores del card en modo delegación).
remoteInstallRouter.get("/hub/drivers", async (_req, res) => {
  const h = await readHub();
  if (!h.hubUrl) return res.status(400).json({ error: "No hay hub configurado." });
  try {
    const r = await hubProxy(h, "GET", "/api/drivers");
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(502).json({ error: "Hub: " + (e as Error).message });
  }
});
remoteInstallRouter.get("/hub/printers", async (_req, res) => {
  const h = await readHub();
  if (!h.hubUrl) return res.status(400).json({ error: "No hay hub configurado." });
  try {
    const r = await hubProxy(h, "GET", "/api/printers");
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(502).json({ error: "Hub: " + (e as Error).message });
  }
});

/** Ejecuta un .ps1 con env (credenciales por env, nunca argv). */
function runPs(script: string, env: Record<string, string>, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    (async () => {
      const file = path.join(os.tmpdir(), `pdm-remote-${crypto.randomBytes(6).toString("hex")}.ps1`);
      const extra: string[] = [];
      try {
        await fs.writeFile(file, "\uFEFF" + script, "utf8");
      } catch (e) {
        return resolve({ stdout: "", stderr: "No se pudo preparar el script: " + (e as Error).message });
      }
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file],
        { windowsHide: true, timeout: timeoutMs, env: { ...process.env, ...env }, maxBuffer: 8 * 1024 * 1024 },
        async (_err, stdout, stderr) => {
          await fs.unlink(file).catch(() => {});
          for (const f of extra) await fs.unlink(f).catch(() => {});
          resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        },
      );
    })();
  });
}

/** Última línea JSON impresa por el script. */
function parseResult(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("{")) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        /* seguir */
      }
    }
  }
  return null;
}

/** Cabecera común: construye el PSCredential desde env (sin exponerlo en argv). */
const CRED = [
  "$sec=ConvertTo-SecureString $env:PDM_RPW -AsPlainText -Force",
  "$cred=New-Object System.Management.Automation.PSCredential($env:PDM_RUSER,$sec)",
].join("\r\n");

/**
 * Cierra cualquier sesión SMB previa hacia el host antes de conectar con NUESTRAS
 * credenciales. Windows NO permite dos conexiones al mismo servidor con usuarios
 * distintos y rechaza la segunda con "The user name or password is incorrect"
 * (error 1326). Esto es frecuente cuando la operación corre desde una PC de uso
 * diario (versión Desktop) que ya tiene una sesión abierta al destino. Silencioso:
 * si no hay sesión previa, `net use /delete` simplemente no hace nada.
 */
const DROP_SMB = [
  "try{ cmd /c ('net use \\\\'+$h+'\\admin$ /delete /y') 2>$null | Out-Null }catch{}",
  "try{ cmd /c ('net use \\\\'+$h+'\\IPC$ /delete /y') 2>$null | Out-Null }catch{}",
].join("\r\n");

/**
 * Si el host es una IP, resuelve el NOMBRE del equipo y lo usa. Conectarse por IP
 * fuerza NTLM (Kerberos necesita el nombre/SPN); si el dominio restringe NTLM, la
 * conexión por IP se rechaza como "user name or password is incorrect" aunque las
 * credenciales sean válidas. Conectando por nombre se usa Kerberos y funciona.
 */
const RESOLVE_HOST = [
  "if($h -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$'){",
  // Solo se acepta el nombre resuelto si es un hostname SEGURO: el PTR/NetBIOS lo
  // controla el equipo destino y podría devolver caracteres de shell (&,|,') que
  // se concatenan en `net use`. Validar evita inyección de comandos.
  "  try{ $rn=[System.Net.Dns]::GetHostEntry($h).HostName; if($rn -and ($rn -ne $h) -and ($rn -match '^[A-Za-z0-9._-]+$')){ $h=$rn } }catch{}",
  "}",
].join("\r\n");

// --- Etapa 1: sonda (SMB admin$ + WMI/DCOM), sin instalar --------------------
remoteInstallRouter.post("/probe", async (req, res) => {
  const b = req.body ?? {};
  const host = String(b.host ?? "").trim();
  const username = String(b.username ?? "").trim();
  const password = String(b.password ?? "");
  if (!isHost(host)) return res.status(400).json({ error: "Nombre o IP del equipo inválido." });
  if (!username) return res.status(400).json({ error: "Falta el usuario administrador (dominio\\usuario)." });
  if (!password) return res.status(400).json({ error: "Falta la contraseña." });

  // Delegación: si hay hub, él ejecuta el probe (él sí autentica al dominio).
  const hub = await readHub();
  if (hub.hubUrl) {
    try {
      const r = await hubProxy(hub, "POST", "/api/remote-install/probe", { host, username, password });
      return res.status(r.status).json(r.body);
    } catch (e) {
      return res.status(502).json({ error: "No se pudo delegar al hub: " + (e as Error).message });
    }
  }

  // Sin hub: se ejecuta LOCALMENTE (requiere host Windows).
  if (process.platform !== "win32") {
    return res.status(400).json({ error: "Solo desde un host Windows, o configura un hub de delegación." });
  }

  const script = [
    "$ErrorActionPreference='Stop'",
    "$o=[ordered]@{reachable=$false;smbOk=$false;wmiOk=$false;authOk=$false;name=$null;os=$null;userForm=$null;error=$null}",
    "$h=$env:PDM_RHOST",
    RESOLVE_HOST,
    CRED,
    "try{ if(Test-Connection -ComputerName $h -Count 1 -Quiet -ErrorAction SilentlyContinue){$o.reachable=$true} }catch{}",
    DROP_SMB,
    // Formatos de usuario a probar: el dado y, si es DOMINIO\usuario, también usuario@FQDN.
    "$u=$env:PDM_RUSER; $forms=@($u)",
    "if($u.Contains('\\') -and $env:USERDNSDOMAIN){ $forms += ($u.Split('\\')[-1]+'@'+$env:USERDNSDOMAIN) }",
    "elseif((-not $u.Contains('@')) -and $env:USERDNSDOMAIN){ $forms += ($u+'@'+$env:USERDNSDOMAIN) }",
    "$usedCred=$cred",
    // SMB admin$ probando cada formato hasta que uno autentique.
    "foreach($f in $forms){",
    "  try{",
    "    $c=New-Object System.Management.Automation.PSCredential($f,$sec)",
    "    New-PSDrive -Name 'PDMprobe' -PSProvider FileSystem -Root ('\\\\'+$h+'\\admin$') -Credential $c -ErrorAction Stop | Out-Null",
    "    $o.smbOk=$true; $o.reachable=$true; $o.authOk=$true; $o.userForm=$f; $o.error=$null; $usedCred=$c",
    "    Remove-PSDrive -Name 'PDMprobe' -Force -ErrorAction SilentlyContinue; break",
    "  }catch{ $o.error='SMB: '+$_.Exception.Message }",
    "}",
    // WMI sobre DCOM (con la credencial que funcionó).
    "try{",
    "  $so=New-CimSessionOption -Protocol Dcom",
    "  $cs=New-CimSession -ComputerName $h -Credential $usedCred -SessionOption $so -OperationTimeoutSec 20 -ErrorAction Stop",
    "  $osi=Get-CimInstance -CimSession $cs -ClassName Win32_OperatingSystem -ErrorAction Stop",
    "  $o.wmiOk=$true; $o.authOk=$true; $o.name=$osi.CSName; $o.os=[string]$osi.Version",
    "  Remove-CimSession $cs -ErrorAction SilentlyContinue",
    "}catch{ if(-not $o.error){ $o.error='WMI: '+$_.Exception.Message } }",
    "$o | ConvertTo-Json -Compress",
  ].join("\r\n");

  try {
    const r = await runPs(script, { PDM_RHOST: host, PDM_RUSER: username, PDM_RPW: password }, 45000);
    const p = parseResult(r.stdout);
    if (!p) return res.status(500).json({ error: "No hubo respuesta del diagnóstico.", detail: (r.stderr || r.stdout).slice(0, 500) });
    // Registro seguro (sin credenciales): útil para monitorear.
    console.log(
      `[remote-install] probe ${host} → reachable=${!!p.reachable} smb=${!!p.smbOk} wmi=${!!p.wmiOk}` +
        (p.userForm ? ` userForm="${String(p.userForm)}"` : "") +
        (p.error ? ` err="${String(p.error).slice(0, 140)}"` : ""),
    );
    res.json({
      host,
      reachable: !!p.reachable,
      smbOk: !!p.smbOk,
      wmiOk: !!p.wmiOk,
      authOk: !!p.authOk,
      remoteName: (p.name as string) ?? null,
      osVersion: (p.os as string) ?? null,
      userForm: (p.userForm as string) ?? null,
      error: (p.error as string) ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Construye el runner.ps1 que se ejecuta EN la PC destino (params ya interpolados). */
function buildRunner(
  id: string,
  fname: string,
  ext: string,
  iargs: string,
  printer: { ip: string; model: string; name: string } | null,
): string {
  const q = (s: string) => s.replace(/'/g, "''");
  let logic: string;
  if (ext === ".inf") {
    logic = [
      "$out=& pnputil.exe /add-driver $f /install 2>&1 | Out-String; L $out; L ('EXIT='+$LASTEXITCODE)",
      "if($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 3010){$ok=$true}",
    ].join("\n");
  } else if (ext === ".exe") {
    const al = iargs.trim()
      ? "@(" + iargs.split(/\s+/).filter(Boolean).map((a) => `'${a.replace(/'/g, "''")}'`).join(",") + ")"
      : "@()";
    logic = [
      `$al=${al}`,
      "if($al.Count){ $p=Start-Process -FilePath $f -ArgumentList $al -Wait -PassThru -WindowStyle Hidden } else { $p=Start-Process -FilePath $f -Wait -PassThru -WindowStyle Hidden }",
      "L ('EXE_EXIT='+$p.ExitCode); if($p.ExitCode -eq 0){$ok=$true}",
    ].join("\n");
  } else {
    // ZIP en REMOTO: se prefiere el .inf con pnputil (silencioso, funciona en
    // sesión no interactiva). Los asistentes gráficos (setup.exe/RV_SETUP) NO
    // se muestran en remoto, así que solo se usan si NO hay .inf.
    logic = [
      "$dest=Join-Path $work 'x'; Expand-Archive -LiteralPath $f -DestinationPath $dest -Force",
      "Get-ChildItem -Path $dest -Recurse -File | Unblock-File -ErrorAction SilentlyContinue",
      "$infs=@(Get-ChildItem -Path $dest -Recurse -Filter *.inf)",
      "L ('INFS='+$infs.Count)",
      "if($infs.Count){",
      "  foreach($inf in $infs){ L ('=== '+$inf.FullName+' ==='); $out=& pnputil.exe /add-driver $inf.FullName /install 2>&1 | Out-String; L $out; L ('EXIT='+$LASTEXITCODE); if($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 3010){$ok=$true} }",
      "} else {",
      "  $exe=Get-ChildItem -Path $dest -Recurse -Include *setup*.exe,*install*.exe | Select-Object -First 1",
      "  if(-not $exe){ $exe=Get-ChildItem -Path $dest -Recurse -Filter *.exe | Select-Object -First 1 }",
      "  if($exe){ L ('RUN '+$exe.FullName); $p=Start-Process -FilePath $exe.FullName -Wait -PassThru -WindowStyle Hidden; L ('EXE_EXIT='+$p.ExitCode); if($p.ExitCode -eq 0){$ok=$true} }",
      "  else { L 'Sin .inf ni .exe instalable en el ZIP.' }",
      "}",
    ].join("\n");
  }
  return [
    "$ErrorActionPreference='Continue'",
    `$work='C:\\Windows\\Temp\\${id}'`,
    "$log=Join-Path $work 'pdm.log'",
    "'' | Set-Content -LiteralPath $log",
    "function L($m){ $m | Add-Content -LiteralPath $log }",
    `$f=Join-Path $work '${fname.replace(/'/g, "''")}'`,
    "$ok=$false",
    "try{ Unblock-File -LiteralPath $f -ErrorAction SilentlyContinue }catch{}",
    "try{",
    logic,
    "}catch{ L ('EXC='+$_.Exception.Message) }",
    // Si se pidió desplegar una impresora del inventario: crear puerto + cola.
    printer
      ? [
          "if($ok){",
          "  try{",
          `    $pip='${q(printer.ip)}'; $pmodel='${q(printer.model)}'; $pname='${q(printer.name)}'`,
          "    $port='IP_'+$pip",
          "    if(-not (Get-PrinterPort -Name $port -ErrorAction SilentlyContinue)){ Add-PrinterPort -Name $port -PrinterHostAddress $pip; L ('PUERTO '+$port+' creado') } else { L ('PUERTO '+$port+' ya existía') }",
          // Nombre real del driver de impresora: la línea entre comillas del .inf que contiene el modelo.
          "    $drvName=$null; $srcInf=$null; $anyName=$null; $anyInf=$null",
          "    foreach($inf in @(Get-ChildItem -Path $work -Recurse -Filter *.inf)){",
          "      $ms=Select-String -LiteralPath $inf.FullName -Pattern ('\"([^\"]*'+[Regex]::Escape($pmodel)+'[^\"]*)\"') -AllMatches -ErrorAction SilentlyContinue",
          "      foreach($line in $ms){ foreach($mm in $line.Matches){ $nm=$mm.Groups[1].Value; if(-not $anyName){ $anyName=$nm; $anyInf=$inf.FullName }; if(($nm -like 'RICOH*') -and (-not $drvName)){ $drvName=$nm; $srcInf=$inf.FullName } } }",
          "    }",
          "    if(-not $drvName){ $drvName=$anyName; $srcInf=$anyInf }",
          "    if(-not $drvName){ L ('SIN_NOMBRE_DRIVER_EN_INF modelo='+$pmodel); $ok=$false }",
          "    else{",
          "      L ('DRIVER_NAME='+$drvName)",
          // Registrarlo como DRIVER DE IMPRESORA (pnputil solo lo dejó en el almacén).
          "      if(-not (Get-PrinterDriver -Name $drvName -ErrorAction SilentlyContinue)){",
          "        try{ Add-PrinterDriver -Name $drvName -ErrorAction Stop; L 'Add-PrinterDriver OK' }",
          "        catch{ Add-PrinterDriver -Name $drvName -InfPath $srcInf -ErrorAction Stop; L 'Add-PrinterDriver (InfPath) OK' }",
          "      }",
          "      if(-not (Get-Printer -Name $pname -ErrorAction SilentlyContinue)){ Add-Printer -Name $pname -DriverName $drvName -PortName $port; L ('IMPRESORA agregada: '+$pname) } else { L ('IMPRESORA ya existía: '+$pname) }",
          "      $ok=$true",
          "    }",
          "  }catch{ L ('ADDPRINTER_ERR='+$_.Exception.Message); $ok=$false }",
          "}",
        ].join("\n")
      : "",
    "L ('ANYOK='+$ok)",
    "'done' | Set-Content -LiteralPath (Join-Path $work 'pdm.done')",
  ].join("\r\n");
}

// --- Etapa 2: instalación remota (admin$ + WMI/DCOM) ------------------------
remoteInstallRouter.post("/install", async (req, res) => {
  const b = req.body ?? {};
  const host = String(b.host ?? "").trim();
  const driverId = String(b.driverId ?? "").trim();
  const printerId = String(b.printerId ?? "").trim(); // opcional: desplegar impresora del inventario
  const username = String(b.username ?? "").trim();
  const password = String(b.password ?? "");
  if (!isHost(host)) return res.status(400).json({ error: "Nombre o IP del equipo inválido." });
  if (!username || !password) return res.status(400).json({ error: "Faltan las credenciales de administrador." });
  if (!driverId) return res.status(400).json({ error: "Falta el driver a instalar." });

  // Delegación: el hub instala con SU catálogo (driverId/printerId son del hub).
  const hub = await readHub();
  if (hub.hubUrl) {
    try {
      const r = await hubProxy(hub, "POST", "/api/remote-install/install", {
        host,
        driverId,
        printerId: printerId || undefined,
        username,
        password,
      });
      return res.status(r.status).json(r.body);
    } catch (e) {
      return res.status(502).json({ ok: false, message: "No se pudo delegar al hub: " + (e as Error).message, log: "" });
    }
  }

  if (process.platform !== "win32") {
    return res.status(400).json({ error: "Solo desde un host Windows, o configura un hub de delegación." });
  }

  const d = await prisma.driverPackage.findUnique({ where: { id: driverId } });
  if (!d?.filePath) return res.status(400).json({ error: "Ese driver no tiene un instalador alojado." });
  const ext = path.extname(d.fileName ?? d.filePath).toLowerCase();
  if (![".inf", ".exe", ".zip"].includes(ext)) {
    return res.status(400).json({ error: "Solo se pueden instalar en remoto archivos .inf, .exe o .zip." });
  }

  // Impresora a desplegar (opcional): su IP/modelo/nombre del inventario.
  let printer: { ip: string; model: string; name: string } | null = null;
  if (printerId) {
    const p = await prisma.printer.findUnique({ where: { id: printerId }, select: { ipAddress: true, model: true, name: true } });
    if (!p) return res.status(400).json({ error: "La impresora del inventario no existe." });
    printer = { ip: p.ipAddress, model: String(p.model ?? "").trim(), name: (p.name || p.model || p.ipAddress).trim() };
  }

  console.log(`[remote-install] install → host=${host} driver="${d.name}"${printer ? ` printer="${printer.name}" ip=${printer.ip}` : ""} file=${path.basename(d.filePath)}…`);
  const id = "pdm" + crypto.randomBytes(5).toString("hex");
  const fname = path.basename(d.filePath);
  const runnerContent = buildRunner(id, fname, ext, d.installArgs ?? "", printer);
  const runnerLocal = path.join(os.tmpdir(), `pdm-runner-${id}.ps1`);
  try {
    await fs.writeFile(runnerLocal, "\uFEFF" + runnerContent, "utf8");
  } catch (e) {
    return res.status(500).json({ ok: false, message: "No se pudo preparar el instalador: " + (e as Error).message, log: "" });
  }

  const script = [
    "$ErrorActionPreference='Stop'",
    "$o=[ordered]@{ok=$false;log='';error=$null}",
    "$h=$env:PDM_RHOST; $local=$env:PDM_FILE; $runner=$env:PDM_RUNNER; $id=$env:PDM_ID",
    RESOLVE_HOST,
    CRED,
    "$dn='PDMinst'; $mounted=$false; $cs=$null",
    DROP_SMB,
    // Resolver el formato de usuario que autentica (DOMINIO\usuario o usuario@FQDN).
    "$u=$env:PDM_RUSER; $forms=@($u)",
    "if($u.Contains('\\') -and $env:USERDNSDOMAIN){ $forms += ($u.Split('\\')[-1]+'@'+$env:USERDNSDOMAIN) }",
    "elseif((-not $u.Contains('@')) -and $env:USERDNSDOMAIN){ $forms += ($u+'@'+$env:USERDNSDOMAIN) }",
    "foreach($f in $forms){ try{ $tc=New-Object System.Management.Automation.PSCredential($f,$sec); New-PSDrive -Name 'PDMtest' -PSProvider FileSystem -Root ('\\\\'+$h+'\\admin$') -Credential $tc -ErrorAction Stop | Out-Null; Remove-PSDrive -Name 'PDMtest' -Force -ErrorAction SilentlyContinue; $cred=$tc; break }catch{} }",
    "try{",
    "  New-PSDrive -Name $dn -PSProvider FileSystem -Root ('\\\\'+$h+'\\admin$') -Credential $cred -ErrorAction Stop | Out-Null; $mounted=$true",
    "  $dest=$dn+':\\Temp\\'+$id",
    "  New-Item -ItemType Directory -Path $dest -Force | Out-Null",
    "  Copy-Item -Path $local -Destination ($dest+'\\'+[System.IO.Path]::GetFileName($local)) -Force",
    "  Copy-Item -Path $runner -Destination ($dest+'\\runner.ps1') -Force",
    "  $so=New-CimSessionOption -Protocol Dcom",
    "  $cs=New-CimSession -ComputerName $h -Credential $cred -SessionOption $so -OperationTimeoutSec 30 -ErrorAction Stop",
    "  $cmd='powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"C:\\Windows\\Temp\\'+$id+'\\runner.ps1\"'",
    "  $r=Invoke-CimMethod -CimSession $cs -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$cmd} -ErrorAction Stop",
    "  if($r.ReturnValue -ne 0){ throw ('WMI Create devolvió '+$r.ReturnValue) }",
    "  $done=$dest+'\\pdm.done'",
    "  $ok=$false; for($i=0;$i -lt 300;$i++){ Start-Sleep -Seconds 2; if(Test-Path $done){ $ok=$true; break } }",
    "  $lf=$dest+'\\pdm.log'",
    "  if(Test-Path $lf){ $o.log=Get-Content -LiteralPath $lf -Raw }",
    "  if(-not $ok){ if(-not $o.log){ $o.error='La instalación no terminó a tiempo (timeout).' } }",
    "  $o.ok=($o.log -match 'ANYOK=True')",
    "}catch{ $o.error=$_.Exception.Message }",
    "finally{",
    "  try{ if($cs){ Remove-CimSession $cs -ErrorAction SilentlyContinue } }catch{}",
    "  try{ if($mounted){ Remove-Item -Path ($dn+':\\Temp\\'+$id) -Recurse -Force -ErrorAction SilentlyContinue } }catch{}",
    "  try{ if($mounted){ Remove-PSDrive -Name $dn -Force -ErrorAction SilentlyContinue } }catch{}",
    "}",
    "$o | ConvertTo-Json -Compress",
  ].join("\r\n");

  const env: Record<string, string> = {
    PDM_RHOST: host,
    PDM_RUSER: username,
    PDM_RPW: password,
    PDM_FILE: d.filePath,
    PDM_RUNNER: runnerLocal,
    PDM_ID: id,
  };
  try {
    const r = await runPs(script, env, 12 * 60_000);
    await fs.unlink(runnerLocal).catch(() => {});
    const p = parseResult(r.stdout);
    if (!p) return res.status(500).json({ ok: false, message: "No hubo respuesta de la instalación.", log: (r.stderr || r.stdout).slice(-4000) });
    const ok = !!p.ok;
    // `log` SIEMPRE como texto (evita "[object Object]" si viniera un objeto).
    const logStr =
      typeof p.log === "string" ? p.log : p.log == null ? "" : JSON.stringify(p.log, null, 2);
    console.log(`[remote-install] install ${host} "${d.name}" → ${ok ? "OK ✓" : "FALLÓ ✗"}${p.error ? ` err="${String(p.error).slice(0, 140)}"` : ""}`);
    if (!ok) console.log(`[remote-install] detalle:\n${(logStr || String(p.error ?? "")).slice(-1200)}`);
    res.json({
      ok,
      host,
      driver: d.name,
      message: ok ? `Driver instalado en ${host}.` : `No se pudo completar la instalación en ${host}.`,
      log: logStr.slice(-6000),
    });
  } catch (e) {
    await fs.unlink(runnerLocal).catch(() => {});
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e), log: "" });
  }
});
