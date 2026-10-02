@echo off
rem ============================================================
rem  Reinicia el Servidor Central (2626) para que tome el
rem  codigo nuevo. Doble clic y acepta el aviso de admin (UAC).
rem ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Reiniciando el servidor central...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-central-server.ps1"
echo.
echo Presiona una tecla para cerrar.
pause >nul
