@echo off
rem Corre las pruebas E2E de apps\web contra los servidores locales.
rem Uso: e2e-run.bat            (proyecto desktop)
rem      e2e-run.bat mobile     (Pixel 7)
rem      e2e-run.bat offline    (corte de red)
rem      e2e-run.bat all        (los tres)
rem      e2e-run.bat report     (abre el reporte HTML de la ultima corrida)
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
set "PROJECT=%~1"
if "%PROJECT%"=="" set "PROJECT=desktop"
if /i "%PROJECT%"=="report" (
  call "%NODE24%\pnpm.cmd" exec playwright show-report
  exit /b 0
)
if /i "%PROJECT%"=="all" (
  call "%NODE24%\pnpm.cmd" exec playwright test
) else (
  call "%NODE24%\pnpm.cmd" exec playwright test --project %PROJECT%
)
echo.
echo Codigo de salida: %errorlevel%  (reporte: e2e-run.bat report)
pause
exit /b 0
