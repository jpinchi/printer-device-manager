<#
  actualizar-central.ps1
  Aplica al Servidor Central el CÓDIGO NUEVO (endurecido) y los índices nuevos:
   1) Detiene el proceso del central (por línea de comando; método fiable).
   2) Con la BD libre, aplica los índices con `prisma db push` (no destructivo).
   3) Re-registra e inicia la tarea «PDM Central Server» (arranca el código nuevo,
      que activa WAL/busy_timeout y el resto del hardening).
   4) Verifica health (campo `db`) y el login.
  Debe ejecutarse ELEVADO (el .cmd que lo llama se auto-eleva).
#>
$ErrorActionPreference = 'Continue'
$repo = 'C:\Printer Device Manager'
$node = 'C:\Program Files\nodejs\node.exe'
$prismaCli = Join-Path $repo 'node_modules\prisma\build\index.js'

Write-Host "Deteniendo el servidor central..." -ForegroundColor Cyan
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -in @('node.exe','cmd.exe')) -and
  ($_.CommandLine -match 'run-central-server' -or $_.CommandLine -match 'Printer Device Manager')
} | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host "  detenido PID $($_.ProcessId)" } catch {} }
Get-NetTCPConnection -LocalPort 2626 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop } catch {} }
Start-Sleep -Seconds 3

Write-Host "Aplicando índices (prisma db push)..." -ForegroundColor Cyan
Set-Location $repo
& $node $prismaCli db push --skip-generate 2>&1 | ForEach-Object { Write-Host "  $_" }

Write-Host "Arrancando el central con el código nuevo..." -ForegroundColor Cyan
& (Join-Path $repo 'scripts\register-central-server-task.ps1')

$ok = $false
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Seconds 2
  try { if ((Invoke-WebRequest 'http://127.0.0.1:2626/api/health' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch {}
}
Write-Host ""
if ($ok) {
  $body = try { (Invoke-WebRequest 'http://127.0.0.1:2626/api/health' -UseBasicParsing -TimeoutSec 4).Content } catch { "?" }
  $login = try { (Invoke-WebRequest 'http://127.0.0.1:2626/api/auth/login' -Method POST -ContentType 'application/json' -Body '{"username":"__t__","password":"__w__"}' -UseBasicParsing -TimeoutSec 12).StatusCode } catch { [int]$_.Exception.Response.StatusCode }
  Write-Host "LISTO. Central actualizado y respondiendo." -ForegroundColor Green
  Write-Host "  health: $body"
  Write-Host "  login (credenciales de prueba): $login  (401 = correcto; 500 = problema)"
} else {
  Write-Host "AVISO: el central no respondió a tiempo. Revisa C:\Printer Device Manager\logs\central-server.log" -ForegroundColor Yellow
}
