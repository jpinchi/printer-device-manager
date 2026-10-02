@echo off
rem ============================================================
rem  Desinstalar-Hub.cmd
rem  Quita el "hub de instalacion remota" de ESTA maquina:
rem  elimina la tarea programada "PDM Install Hub", libera su
rem  puerto y borra su carpeta de datos (C:\ProgramData\PDM-Hub).
rem
rem  NO desinstala la app de escritorio (Desktop). Esa se quita,
rem  si se quiere, desde "Agregar o quitar programas".
rem
rem  Doble clic y acepta el aviso de administrador (UAC).
rem ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Desinstalando el hub de instalacion remota...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0unregister-hub-task.ps1"
echo.
echo Presiona una tecla para cerrar.
pause >nul
