@echo off
rem ============================================================
rem  Instalar-Hub.cmd
rem  Convierte ESTA maquina en un "hub" de instalacion remota
rem  para su sede: deja el servidor de Printer Device
rem  Manager corriendo de fondo (tarea programada, arranca con
rem  Windows) para que los Desktop de la sede le deleguen
rem  las instalaciones de drivers.
rem
rem  Requisito: tener el Desktop de Printer Device Manager YA
rem  instalado en esta maquina (de ahi toma el servidor).
rem
rem  Doble clic y acepta el aviso de administrador (UAC).
rem ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Instalando el hub de instalacion remota...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-hub-task.ps1"
echo.
echo Presiona una tecla para cerrar.
pause >nul
