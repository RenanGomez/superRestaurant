@echo off
rem Genera y abre en el navegador un enlace de recuperacion de contrasena sin pasar por correo.
rem Uso: recovery-link.bat correo@dominio.com   (si se omite, lo pregunta)
rem Requiere los servidores locales arriba (start-local.bat).
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
set "EMAIL=%~1"
if "%EMAIL%"=="" set /p EMAIL=Correo del usuario:
node tools\agentic\local-servers\recovery-link.mjs "%EMAIL%"
if errorlevel 1 (
  echo.
  echo No se genero el enlace; revisa el mensaje de arriba.
)
pause
exit /b 0
