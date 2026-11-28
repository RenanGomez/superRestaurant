# Levanta el stack, renueva la sesion de Playwright y abre la UI para dejarla corriendo.
#
# Uso tipico (una sola vez, y la dejas abierta):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\agentic\local-servers\playwright-live.ps1
#
#   -Project desktop|mobile|offline   proyecto de Playwright (por defecto desktop)
#   -Spec e2e/visual/inventario.spec.ts  arranca con esa spec seleccionada
#   -Visual                            activa E2E_VISUAL=1 (pase visual)
#   -Run                               una sola corrida con navegador visible, en vez de la UI
#   -Check                             valida stack, Chrome y sesion sin abrir Playwright
#   -NoRefresh                         no lanza el renovador de sesion en segundo plano
#
# Que hace, en orden:
#   1. Si la API (3000) o la web (8082) no responden, las levanta en segundo plano
#      (con SYNC_CURSOR_SECRET efimero si no esta definido; nunca se imprime).
#   2. Renueva el storageState de Playwright sin navegador. Si el refresh token ya
#      fue rotado, abre `e2e:auth` UNA vez para que inicies sesion a mano y sigue.
#   3. Arranca un renovador cada 20 min mientras la UI siga abierta, para que la
#      sesion no caduque a mitad de una corrida larga.
#   4. Abre `playwright test --ui` (navegador persistente: ejecutar de nuevo no
#      relanza nada ni pide login).
#
param(
  [string]$Spec = "",
  [ValidateSet("desktop", "mobile", "offline")]
  [string]$Project = "desktop",
  [switch]$Visual,
  [switch]$Run,
  [switch]$Check,
  [switch]$NoRefresh,
  [int]$RefreshMinutes = 20
)

$ErrorActionPreference = "Continue"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$node24 = Join-Path $env:LOCALAPPDATA "Programs\node24"
if (Test-Path (Join-Path $node24 "node.exe")) { $env:PATH = "$node24;$env:PATH" }
$web = Join-Path $root "apps\web"
$authFile = Join-Path $web "playwright\.auth\user.json"
$refreshScript = Join-Path $root "tools\agentic\local-servers\refresh-e2e-session.mjs"
$logDir = Join-Path $root ".harness\state"
New-Item -ItemType Directory -Force $logDir | Out-Null

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Http([string]$url, [int]$seconds = 240) {
  for ($i = 0; $i -lt $seconds; $i++) {
    try {
      $status = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $url).StatusCode
      if ($status -ge 200 -and $status -lt 400) { return $true }
    } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}

# 1. Stack ---------------------------------------------------------------
if (-not (Test-Port 3000)) {
  if (-not $env:SYNC_CURSOR_SECRET -or $env:SYNC_CURSOR_SECRET.Length -lt 32) {
    $chars = (48..57) + (65..90) + (97..122)
    $env:SYNC_CURSOR_SECRET = -join ($chars | Get-Random -Count 44 | ForEach-Object { [char]$_ })
  }
  $apiScript = Join-Path $root "tmp\start-authorized-local-api.ps1"
  if (-not (Test-Path $apiScript)) { throw "Falta $apiScript; no puedo levantar la API." }
  Write-Host "[1/4] API no responde en 3000: la levanto en segundo plano..."
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$apiScript`"", "3000") `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "pw-live-api.out.log") `
    -RedirectStandardError (Join-Path $logDir "pw-live-api.err.log") | Out-Null
} else {
  Write-Host "[1/4] API ya escucha en 3000."
}

if (-not (Test-Port 8082)) {
  Write-Host "[1/4] Web no responde en 8082: la levanto en segundo plano (next dev, compila en la primera carga)..."
  Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "pnpm --filter @super-restaurant/web exec next dev -p 8082") `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "pw-live-web.out.log") `
    -RedirectStandardError (Join-Path $logDir "pw-live-web.err.log") | Out-Null
} else {
  Write-Host "[1/4] Web ya escucha en 8082."
}

if (-not (Wait-Http "http://localhost:3000/api/v1/health" 180)) { throw "La API no responde en 3000; revisa .harness\state\pw-live-api.err.log" }
if (-not (Wait-Http "http://localhost:8082/login" 300)) { throw "La web no responde en 8082; revisa .harness\state\pw-live-web.err.log" }
Write-Host "      Stack listo: API 3000 y web 8082."

# 2. Chrome y sesion -----------------------------------------------------
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "No encuentro Chrome; el config usa channel=chrome. Instalalo o cambia el config." }
Write-Host "[2/4] Chrome: $chrome"

$refreshed = $false
if (Test-Path $authFile) {
  & node $refreshScript 2>&1 | Out-Null
  $refreshed = ($LASTEXITCODE -eq 0)
}
if (-not $refreshed) {
  if ($Check) {
    Write-Host "[2/4] La sesion guardada no se pudo renovar (refresh token rotado)."
    Write-Host "      Sin -Check el script abre Chrome una vez para que inicies sesion y sigue solo."
  } else {
    Write-Host "[2/4] La sesion guardada no se pudo renovar. Abro Chrome UNA vez: inicia sesion a mano."
    Write-Host "      (Es el unico momento que necesito de ti; al llegar a /app se guarda y sigo solo.)"
    Push-Location $web
    try { & pnpm run e2e:auth } finally { Pop-Location }
    if (-not (Test-Path $authFile)) { throw "No se guardo la sesion en $authFile." }
  }
} else {
  Write-Host "[2/4] Sesion de Playwright renovada sin navegador."
}

# 3. Renovador en segundo plano -----------------------------------------
$job = $null
if (-not $NoRefresh) {
  $job = Start-Job -ArgumentList $refreshScript, $RefreshMinutes, $root -ScriptBlock {
    param($scriptPath, $minutes, $rootPath)
    while ($true) {
      Start-Sleep -Seconds ($minutes * 60)
      Push-Location $rootPath
      try { & node $scriptPath 2>&1 | Out-Null } catch { } finally { Pop-Location }
    }
  }
  Write-Host "[3/4] Renovador de sesion activo cada $RefreshMinutes min (se apaga al cerrar la UI)."
} else {
  Write-Host "[3/4] Renovador desactivado (-NoRefresh)."
}

# 4. Playwright ----------------------------------------------------------
if ($Visual) { $env:E2E_VISUAL = "1" }
$env:E2E_BASE_URL = "http://localhost:8082"
$pwArgs = @("exec", "playwright", "test", "--project", $Project)
if ($Spec -ne "") { $pwArgs += $Spec }

if ($Check) {
  Write-Host "[4/4] Check OK. Comando preparado: pnpm --filter @super-restaurant/web $($pwArgs -join ' ')"
  if ($Visual) { Write-Host "      E2E_VISUAL=1 (pase visual habilitado)." }
} elseif ($Run) {
  Write-Host "[4/4] Corrida con navegador visible: $($pwArgs -join ' ')"
  Push-Location $web
  try { & pnpm @pwArgs } finally { Pop-Location }
} else {
  Write-Host "[4/4] Abriendo Playwright UI (dejala abierta; ejecutar de nuevo no relanza ni pide login)."
  Push-Location $web
  try { & pnpm @pwArgs --ui } finally { Pop-Location }
}

if ($job) { Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue }
Write-Host "Listo. Para apagar API y web: tools\agentic\local-servers\stop-local.bat"
