<#
  unregister-hub-task.ps1
  Desinstala el "PDM Install Hub" de ESTA maquina:
   - Detiene y elimina la Tarea Programada "PDM Install Hub".
   - Libera el puerto del hub (solo el proceso del hub, que corre como SYSTEM;
     NO toca el Desktop del usuario si lo tiene abierto).
   - Borra la carpeta de datos del hub (C:\ProgramData\PDM-Hub): BD de cuentas
     locales, logs, secreto de sesion y el lanzador.

  NO desinstala la app de escritorio (Desktop): esa se quita, si se quiere,
  desde "Agregar o quitar programas".

  Debe ejecutarse ELEVADO (el .cmd que lo llama se auto-eleva).

  Variable opcional:
   - PDM_HUB_PORT   puerto del hub (por defecto 2626)
#>
$ErrorActionPreference = 'Continue'
$task = 'PDM Install Hub'
$data = 'C:\ProgramData\PDM-Hub'
$port = if ($env:PDM_HUB_PORT) { [int]$env:PDM_HUB_PORT } else { 2626 }

Write-Host "Desinstalando el hub '$task'..." -ForegroundColor Cyan

# --- 1) Detener y eliminar la tarea programada ------------------------------
try { Stop-ScheduledTask -TaskName $task -ErrorAction Stop; Write-Host "  Tarea detenida." } catch { Write-Host "  (la tarea no estaba corriendo)" }
Start-Sleep -Seconds 1
try {
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction Stop
  Write-Host "  Tarea '$task' eliminada." -ForegroundColor Green
} catch {
  Write-Host "  (no existia la tarea '$task')" -ForegroundColor Yellow
}

# --- 2) Liberar el puerto SOLO del proceso del hub (dueno = SYSTEM) ----------
# El Desktop del usuario, si esta abierto, corre como el usuario y usa OTRO
# puerto; por eso solo tocamos procesos cuyo dueno sea SYSTEM.
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    $procId = $_
    try {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop
      $owner = (Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction Stop).User
      if ($owner -eq 'SYSTEM') {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-Host "  (proceso del hub detenido: PID $procId)"
      } else {
        Write-Host "  (puerto $port en uso por '$owner' (no es el hub); no se toca)" -ForegroundColor Yellow
      }
    } catch {}
  }

# --- 3) Borrar la carpeta de datos del hub ----------------------------------
if (Test-Path $data) {
  try {
    Remove-Item -Recurse -Force $data -ErrorAction Stop
    Write-Host "  Carpeta de datos borrada: $data" -ForegroundColor Green
  } catch {
    Write-Host "  No se pudo borrar $data (archivo en uso). Reintenta tras cerrar procesos." -ForegroundColor Yellow
  }
} else {
  Write-Host "  No habia carpeta de datos ($data)."
}

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host " HUB DESINSTALADO de esta maquina." -ForegroundColor Green
Write-Host " - La app de escritorio (Desktop) NO se toco." -ForegroundColor White
Write-Host " - Recuerda quitar la delegacion a este hub en los Desktop que lo" -ForegroundColor White
Write-Host "   usaban (Drivers > Configurar delegacion) y, si apuntaban aqui su" -ForegroundColor White
Write-Host "   'Servidor' de login, volver a ponerlo en la central." -ForegroundColor White
Write-Host "=====================================================================" -ForegroundColor Cyan
