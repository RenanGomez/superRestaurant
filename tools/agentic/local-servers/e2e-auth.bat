@echo off
rem Abre Chrome en http://localhost:8082/login para iniciar sesion a mano y guardar
rem la sesion en apps\web\playwright\.auth\user.json (usada por las pruebas E2E y buttonmash).
rem Requiere API (3000) y web (8082) levantados con start-local.bat.
setlocal
for %%I in ("%~dp0..\..\..") do set "ROOT=%%~fI"
set "NODE24=%LOCALAPPDATA%\Programs\node24"
if not exist "%NODE24%\node.exe" (
  echo No encuentro Node 24 en "%NODE24%".
  pause
  exit /b 1
)
set "PATH=%NODE24%;%PATH%"
cd /d "%ROOT%\apps\web"
node e2e\save-auth.ts
if errorlevel 1 (
  echo El guardado de sesion fallo; revisa el mensaje de arriba.
  pause
  exit /b 1
)
echo Sesion guardada. Ya puedes correr e2e-run.bat
pause
exit /b 0
