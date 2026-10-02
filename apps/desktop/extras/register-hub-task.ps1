<#
  register-hub-task.ps1
  Registra e inicia la Tarea Programada "PDM Install Hub":
   - Reutiliza el servidor EMPAQUETADO que instala el Desktop
     (no necesita el repositorio ni Node aparte).
   - Corre como SYSTEM, arranca con Windows, se reinicia ante fallos.
   - Escucha en el puerto 2626 (configurable con PDM_HUB_PORT).
   - Valida el login contra la central (cuenta unica): cualquier
     cuenta de la central sirve para que los Desktop deleguen.
  Debe ejecutarse ELEVADO (el .cmd que lo llama se auto-eleva).

  Variables opcionales (set antes de ejecutar, o edita abajo):
   - PDM_HUB_PORT     puerto del hub (por defecto 2626)
   - PDM_CENTRAL_URL  central para las cuentas (por defecto http://192.0.2.24:2626)
#>
$ErrorActionPreference = 'Stop'

# --- 1) Localizar el Desktop instalado --------------------------------------
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Printer Device Manager'),
  (Join-Path $env:ProgramFiles 'Printer Device Manager')
)
if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Printer Device Manager') }
# Tambien buscar en el perfil de cada usuario (por si se instalo bajo otra cuenta).
Get-ChildItem 'C:\Users\*\AppData\Local\Programs\Printer Device Manager' -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { $candidates += $_.FullName }

$app = $candidates | Where-Object { $_ -and (Test-Path (Join-Path $_ 'Printer Device Manager.exe')) } | Select-Object -First 1
if (-not $app) {
  Write-Host "ERROR: no se encontro el Desktop instalado." -ForegroundColor Red
  Write-Host "Instala primero 'Printer Device Manager' (el Desktop) en esta maquina y vuelve a ejecutar." -ForegroundColor Yellow
  exit 1
}
$exe      = Join-Path $app 'Printer Device Manager.exe'
$server   = Join-Path $app 'resources\server\index.cjs'
$web      = Join-Path $app 'resources\web'
$vendor   = Join-Path $app 'resources\server\vendor'
$template = Join-Path $app 'resources\db-template\pdm.db'
Write-Host "Desktop encontrado en: $app" -ForegroundColor Cyan

# --- 2) Carpeta de datos del hub --------------------------------------------
$data = 'C:\ProgramData\PDM-Hub'
New-Item -ItemType Directory -Force -Path $data | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $data 'logs') | Out-Null
$db = Join-Path $data 'pdm.db'
if ((-not (Test-Path $db)) -and (Test-Path $template)) {
  Copy-Item $template $db
  Write-Host "Base de datos del hub inicializada." -ForegroundColor Green
}

# --- 3) Secreto de sesion persistente ---------------------------------------
$secretFile = Join-Path $data 'session-secret.txt'
if (-not (Test-Path $secretFile)) {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes) | Set-Content -NoNewline -Encoding ascii $secretFile
}
$secret = (Get-Content $secretFile -Raw).Trim()

# --- 4) Parametros -----------------------------------------------------------
$port = if ($env:PDM_HUB_PORT) { $env:PDM_HUB_PORT } else { '2626' }
# Por defecto el hub es SU PROPIA central de cuentas (fuente de verdad): NO
# reenvia el login a ningun lado. Si se quiere que valide contra otra central,
# pasa PDM_CENTRAL_URL antes de ejecutar.
$central = if ($env:PDM_CENTRAL_URL) { $env:PDM_CENTRAL_URL } else { '' }
$dbUrl   = 'file:' + ($db -replace '\\','/')

# --- 5) Generar el lanzador (bucle que reinicia el servidor) ----------------
$run = Join-Path $data 'run-hub.cmd'
$lines = @(
  '@echo off',
  'setlocal enableextensions',
  'set "ELECTRON_RUN_AS_NODE=1"',
  "set `"PDM_PORT=$port`"",
  "set `"PORT=$port`"",
  'set "HOST=0.0.0.0"',
  'set "AUTH_ENFORCE=true"',
  'set "POLLING_ENABLED=false"',
  "set `"DATABASE_URL=$dbUrl`"",
  "set `"PDM_DATA_DIR=$data`"",
  "set `"PDM_WEB_OUT=$web`"",
  "set `"NODE_PATH=$vendor`"",
  "set `"SESSION_SECRET=$secret`""
)
if ($central) { $lines += "set `"PDM_CENTRAL_URL=$central`"" }
$lines += @(
  "cd /d `"$app\resources\server`"",
  ':loop',
  "echo [%date% %time%] iniciando hub (puerto $port)>> `"$data\logs\hub.log`"",
  "`"$exe`" `"$server`" >> `"$data\logs\hub.log`" 2>&1",
  "echo [%date% %time%] el hub termino (codigo %errorlevel%); reinicio en 5s>> `"$data\logs\hub.log`"",
  'timeout /t 5 /nobreak >nul',
  'goto loop'
)
Set-Content -Path $run -Value $lines -Encoding ascii
Write-Host "Lanzador creado: $run" -ForegroundColor Green

# --- 6) Registrar e iniciar la tarea programada -----------------------------
$task = 'PDM Install Hub'
$action    = New-ScheduledTaskAction -Execute $run
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
              -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $task `
  -Description "Hub de instalacion remota Printer Device Manager (LAN, puerto $port). Arranca con Windows." `
  -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "OK: tarea '$task' registrada (SYSTEM, al inicio de Windows)." -ForegroundColor Green

# Liberar el puerto de cualquier proceso previo y arrancar ya.
Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host "  (liberado el ${port}: PID $_)" } catch {} }
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $task
Write-Host "Tarea iniciada. Esperando a que el hub responda..." -ForegroundColor Cyan

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
}

# IP local (para configurar la delegacion en los Desktop).
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
  Select-Object -First 1 -ExpandProperty IPAddress)
if (-not $ip) { $ip = 'IP-DE-ESTA-MAQUINA' }

Write-Host ""
if ($ok) {
  Write-Host "LISTO: el hub responde y lo gestiona la tarea (sobrevive reinicios)." -ForegroundColor Green
} else {
  Write-Host "AVISO: aun no responde. Revisa el log: $data\logs\hub.log" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host " URL de este hub:  http://$($ip):$port" -ForegroundColor White
Write-Host ""
if ($central) {
  Write-Host " Las cuentas se validan contra: $central" -ForegroundColor White
  Write-Host " (los tecnicos usan su cuenta de esa central)." -ForegroundColor White
} else {
  Write-Host " PASO 1 - Crear las cuentas de la sede:" -ForegroundColor Yellow
  Write-Host "   Abre en un navegador  http://$($ip):$port" -ForegroundColor White
  Write-Host "   La primera vez crea el ADMINISTRADOR, y en Administracion > Usuarios" -ForegroundColor White
  Write-Host "   crea las cuentas de los tecnicos de esta sede." -ForegroundColor White
}
Write-Host ""
Write-Host " PASO 2 - En cada Desktop de la sede:" -ForegroundColor Yellow
Write-Host "   - En la pantalla de login, en 'Servidor', pon:  http://$($ip):$port" -ForegroundColor White
Write-Host "     (para que el login use las cuentas de este hub)." -ForegroundColor White
Write-Host "   - En Drivers > Configurar delegacion, pon esa misma URL y una cuenta del hub." -ForegroundColor White
Write-Host "=====================================================================" -ForegroundColor Cyan
