@echo off
rem Establece una contrasena nueva para la cuenta administradora existente (ver
rem docs\runbooks\local-admin-password-setter.md). Solo sirve para esa cuenta.
rem Abre un formulario local en http://127.0.0.1:4320 donde escribes la contrasena;
rem nada se imprime ni se guarda en disco.
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

set "JOURNAL=tmp\local-admin-password-set.attempt.json"
if exist "%JOURNAL%" (
  for /f "tokens=2 delims=:}" %%S in ('type "%JOURNAL%"') do set "PREV=%%~S"
  echo Hay un intento previo registrado (estado: %PREV%).
  set "STAMP=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%-%TIME:~0,2%%TIME:~3,2%"
  set "STAMP=%STAMP: =0%"
  echo Se renombra a %JOURNAL%.bak-%STAMP% para permitir un intento nuevo.
  ren "%JOURNAL%" "local-admin-password-set.attempt.json.bak-%STAMP%" || goto :fail
)

echo [1/2] Pruebas de la herramienta...
node tools\local-admin-password-setter.test.mjs || goto :fail

echo [2/2] Iniciando el formulario local (expira en 60 minutos)...
echo Abre http://127.0.0.1:4320 en tu navegador, pulsa "Comprobar navegador" y luego escribe la contrasena nueva.
start "" "http://127.0.0.1:4320"
node tools\local-admin-password-setter.mjs --serve --confirm=SET_EXISTING_GLOBAL_ADMIN_PASSWORD
echo.
echo Estado del intento:
type "%JOURNAL%" 2>nul
echo.
pause
exit /b 0

:fail
echo Fallo; revisa el mensaje de arriba.
pause
exit /b 1
