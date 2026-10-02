<#
  Registra e inicia la Tarea Programada "PDM Central Server":
   - Corre como SYSTEM (sobrevive cierre de sesión y reinicios)
   - Se dispara al INICIO de Windows
   - Sin límite de tiempo de ejecución + reinicio ante fallos
  Debe ejecutarse ELEVADO (el .cmd que lo llama se auto-eleva).
#>
$ErrorActionPreference = 'Stop'
$task = 'PDM Central Server'
$cmd  = 'C:\Printer Device Manager\scripts\run-central-server.cmd'

if (-not (Test-Path $cmd)) { Write-Host "No se encontro $cmd" -ForegroundColor Red; exit 1 }

$action    = New-ScheduledTaskAction -Execute $cmd
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
              -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $task `
  -Description 'Servidor central Printer Device Manager (LAN, puerto 2626). Arranca con Windows.' `
  -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "OK: tarea '$task' registrada (SYSTEM, al inicio de Windows)." -ForegroundColor Green

# Liberar el 2626 de cualquier servidor manual previo y arrancar la tarea ya mismo.
Get-NetTCPConnection -LocalPort 2626 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host "  (liberado el 2626: PID $_)" } catch {} }
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $task
Write-Host "Tarea iniciada. Esperando a que el servidor responda..." -ForegroundColor Cyan

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:2626/api/health' -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
}
if ($ok) {
  Write-Host "LISTO: el servidor central responde en http://127.0.0.1:2626 y ahora lo gestiona la tarea." -ForegroundColor Green
  Write-Host "Sobrevivira reinicios y cierres de sesion." -ForegroundColor Green
} else {
  Write-Host "AVISO: aun no responde. Revisa el log: C:\Printer Device Manager\logs\central-server.log" -ForegroundColor Yellow
}
