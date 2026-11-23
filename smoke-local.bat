@echo off
REM Levanta la API (3000) y la web (8082) para el smoke en un solo paso.
REM Uso: doble clic, o "smoke-local.bat nobuild" para saltar la compilacion de la API.
REM Delega en tools\agentic\local-servers\start-local.bat.
setlocal
set "ROOT=%~dp0"
set "TARGET=%ROOT%tools\agentic\local-servers\start-local.bat"
if not exist "%TARGET%" (
  echo No encuentro "%TARGET%".
  pause
  exit /b 1
)
call "%TARGET%" %1
exit /b %errorlevel%
