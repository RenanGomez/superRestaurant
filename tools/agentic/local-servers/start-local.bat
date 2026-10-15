@echo off
rem Levanta la API (3000) y la web (8082) para pruebas locales, cada una en su ventana.
rem Uso: doble clic, o "start-local.bat nobuild" para saltar la compilacion de la API.
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

echo [1/4] Cerrando servidores previos en 3000 y 8082...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000,8082 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

if /i "%~1"=="nobuild" (
  echo [2/4] Compilacion omitida.
) else (
  echo [2/4] Compilando contratos compartidos y API...
  call pnpm --filter "@super-restaurant/shared-types" build || goto :fail
  call pnpm --filter "@super-restaurant/api" build || goto :fail
)

echo [3/4] Abriendo ventanas de API y web...
start "superRestaurant API :3000" cmd /k "cd /d "%ROOT%" && set "PATH=%NODE24%;%PATH%" && powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tmp\start-authorized-local-api.ps1" 3000"
start "superRestaurant WEB :8082" cmd /k "cd /d "%ROOT%" && set "PATH=%NODE24%;%PATH%" && pnpm --filter "@super-restaurant/web" exec next dev -p 8082"

echo [4/4] Esperando a que respondan (hasta 3 minutos)...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 90;$i++){ try { $a=(Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:3000/api/v1/health).StatusCode; $w=(Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 http://localhost:8082/login).StatusCode; if($a -eq 200 -and $w -eq 200){$ok=$true;break} } catch {}; Start-Sleep 2 }; if($ok){ 'Listo: API y web responden.'; exit 0 } else { 'No respondieron a tiempo; revisa las dos ventanas.'; exit 1 }"
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "http://localhost:8082"
exit /b 0

:fail
echo La compilacion fallo; revisa el error de arriba.
pause
exit /b 1
