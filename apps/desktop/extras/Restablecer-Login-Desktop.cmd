@echo off
REM ============================================================
REM  Restablecer-Login-Desktop.cmd
REM  Restablece la cuenta LOCAL del Desktop en ESTA maquina.
REM  Respalda la base de datos y deja que la app cree una nueva
REM  en el proximo arranque (pantalla "Configuracion inicial").
REM  NO afecta el servidor central ni otras maquinas.
REM ============================================================
setlocal
set "DBDIR=%APPDATA%\@pdm\desktop"
set "DB=%DBDIR%\pdm.db"

echo.
echo === Restablecer login del Desktop (solo esta maquina) ===
echo Carpeta de datos: %DBDIR%
echo.

REM 1) Cerrar la app si esta abierta
echo Cerrando la aplicacion si esta abierta...
taskkill /IM "Printer Device Manager.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul

if not exist "%DB%" (
  echo No se encontro una base de datos en %DB%.
  echo Al abrir el Desktop veras directamente la "Configuracion inicial".
  echo.
  pause
  exit /b 0
)

REM 2) Respaldar con marca de tiempo (no se borra nada)
set "STAMP=%DATE:/=-%_%TIME::=-%"
set "STAMP=%STAMP: =0%"
set "BAK=%DBDIR%\pdm.db.bak_%STAMP%"
echo Respaldando la base de datos actual en:
echo   %BAK%
move /Y "%DB%" "%BAK%" >nul
if exist "%DBDIR%\pdm.db-wal" move /Y "%DBDIR%\pdm.db-wal" "%BAK%-wal" >nul 2>&1
if exist "%DBDIR%\pdm.db-shm" move /Y "%DBDIR%\pdm.db-shm" "%BAK%-shm" >nul 2>&1

echo.
echo Listo. Ahora abre "Printer Device Manager":
echo   - Aparecera la pantalla de CONFIGURACION INICIAL.
echo   - Crea tu usuario administrador con la clave que quieras.
echo.
echo (Tu base anterior quedo respaldada; si la necesitas, restaura el .bak.)
echo.
pause
endlocal
