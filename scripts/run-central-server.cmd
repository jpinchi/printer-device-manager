@echo off
rem =====================================================================
rem  Printer Device Manager - Servidor central (LAN, puerto 2626)
rem  Lanzado por la Tarea Programada "PDM Central Server" al iniciar
rem  Windows (como SYSTEM). Si el servidor termina, se reinicia solo.
rem  El working directory DEBE ser el repo: DATABASE_URL es relativa.
rem =====================================================================
setlocal enableextensions
set "REPO=C:\Printer Device Manager"
set "PATH=C:\Program Files\nodejs;%PATH%"
set "PDM_PORT=2626"
set "AUTH_ENFORCE=true"
if not exist "%REPO%\logs" mkdir "%REPO%\logs"
cd /d "%REPO%"

:loop
echo [%date% %time%] iniciando servidor central (puerto 2626)>> "%REPO%\logs\central-server.log"
"C:\Program Files\nodejs\node.exe" "%REPO%\scripts\serve-lan.mjs" >> "%REPO%\logs\central-server.log" 2>&1
echo [%date% %time%] el servidor termino (codigo %errorlevel%); reinicio en 5s>> "%REPO%\logs\central-server.log"
timeout /t 5 /nobreak >nul
goto loop
