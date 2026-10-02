@echo off
rem ============================================================
rem  Instala el arranque automatico del Servidor Central (2626)
rem  Doble clic y acepta el aviso de administrador (UAC).
rem ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Instalando la tarea programada del servidor central...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-central-server-task.ps1"
echo.
echo Presiona una tecla para cerrar.
pause >nul
