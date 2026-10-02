<#
  Reinicia la Tarea Programada "PDM Central Server" para que el servidor central
  tome el CÓDIGO NUEVO (el server corre desde el fuente vía tsx, así que basta
  con reiniciar el proceso). Debe ejecutarse ELEVADO (el .cmd que lo llama se
  auto-eleva).
#>
$ErrorActionPreference = 'Stop'
$task = 'PDM Central Server'

Write-Host "Reiniciando '$task'..." -ForegroundColor Cyan
try { Stop-ScheduledTask -TaskName $task -ErrorAction Stop } catch { Write-Host "  (la tarea no estaba corriendo)" }

# Asegurar que el 2626 quede libre para que arranque un proceso NUEVO (código nuevo).
Get-NetTCPConnection -LocalPort 2626 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host "  (2626 liberado: PID $_)" } catch {} }

Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName $task
Write-Host "Tarea iniciada. Esperando a que el servidor responda..." -ForegroundColor Cyan

$ok = $false
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Seconds 2
  try {
    if ((Invoke-WebRequest 'http://127.0.0.1:2626/api/health' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break }
  } catch {}
}

if ($ok) {
  Write-Host "LISTO: el servidor central se reinicio con el codigo nuevo y responde en http://127.0.0.1:2626" -ForegroundColor Green
} else {
  Write-Host "AVISO: aun no responde. Revisa C:\Printer Device Manager\logs\central-server.log" -ForegroundColor Yellow
}
