@echo off
rem Copia la sesion de superRestaurant de tu Chrome normal al archivo de las pruebas E2E.
rem Cierra TODAS las ventanas de Chrome antes de hacer doble clic.
rem Uso: e2e-import-session.bat            (perfil "Default")
rem      e2e-import-session.bat "Profile 1" (otro perfil de Chrome)
setlocal
for %%I in ("%~dp0..\..\..") do set "ROOT=%%~fI"
set "NODE24=%LOCALAPPDATA%\Programs\node24"
if not exist "%NODE24%\node.exe" (
  echo No encuentro Node 24 en "%NODE24%".
  pause
  exit /b 1
)
set "PATH=%NODE24%;%PATH%"
cd /d "%ROOT%"
node tools\agentic\local-servers\import-chrome-session.mjs %*
if errorlevel 1 (
  echo.
  echo No se copio la sesion; revisa el mensaje de arriba.
  pause
  exit /b 1
)
echo Listo. Ahora puedes correr e2e-run.bat
pause
exit /b 0
