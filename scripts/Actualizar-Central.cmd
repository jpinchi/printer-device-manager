@echo off
rem ============================================================
rem  Actualizar-Central.cmd
rem  Aplica al Servidor Central el codigo nuevo (endurecido) y
rem  los indices nuevos: detiene, hace prisma db push, y lo
rem  reinicia con el codigo nuevo. Verifica health y login.
rem
rem  Doble clic y acepta el aviso de administrador (UAC).
rem ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Actualizando el servidor central...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar-central.ps1"
echo.
echo Presiona una tecla para cerrar.
pause >nul
