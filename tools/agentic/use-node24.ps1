<#
.SYNOPSIS
  Deja activo Node 24.19.0 (el `engines.node` del repo) para esta sesión,
  sin shims que rompan turbo.

.DESCRIPTION
  Antepone la instalación REAL de Node 24 al PATH del proceso actual y
  valida la versión contra `engines.node` de package.json. No crea nodos
  intermedios (`.cmd`/`.exe` envoltorio): `node`, `pnpm` y `turbo` resuelven
  el `node.exe` real de la 24, que es lo que espera turbo al lanzar sus
  tareas hijas.

  Este script debe DOT-SOURCEARSE para que el PATH quede activo en tu shell:

      . .\tools\agentic\use-node24.ps1

  Si lo ejecutas con `powershell -File .\tools\agentic\use-node24.ps1`, el
  cambio vive solo en el proceso hijo: Windows no devuelve variables de
  entorno al proceso padre, así que `node -v` en el shell llamador seguiría
  viendo la versión anterior. El script detecta ese caso y lo advierte.

.PARAMETER NodeHome
  Carpeta que contiene `node.exe` (por defecto se autodetecta).

.PARAMETER Expected
  Versión esperada; por defecto se lee de `engines.node` en package.json.

.EXAMPLE
  . .\tools\agentic\use-node24.ps1
  node -v   # v24.19.0
#>
[CmdletBinding()]
param(
  [string]$NodeHome,
  [string]$Expected
)

$ErrorActionPreference = 'Stop'

# --- 1. Versión esperada, desde package.json cuando esté disponible -------
if (-not $Expected) {
  $repoRoot = (git rev-parse --show-toplevel 2>$null)
  if ($repoRoot) {
    $pkg = Join-Path $repoRoot.Trim() 'package.json'
    if (Test-Path $pkg) {
      try {
        $json = Get-Content $pkg -Raw | ConvertFrom-Json
        if ($json.engines -and $json.engines.node) { $Expected = $json.engines.node }
      } catch { }
    }
  }
  if (-not $Expected) { $Expected = '24.19.0' }
}

# --- 2. Localizar la instalación real de Node 24 --------------------------
$candidates = @()
if ($NodeHome) { $candidates += $NodeHome }
if ($env:SR_NODE24) { $candidates += $env:SR_NODE24 }
$candidates += (Join-Path $env:LOCALAPPDATA 'Programs\node24')
$candidates += (Join-Path $env:ProgramFiles 'nodejs')
$candidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs')
$candidates += 'D:\nodejs'

$resolved = $null
foreach ($dir in $candidates) {
  if (-not $dir) { continue }
  $exe = Join-Path $dir 'node.exe'
  if (-not (Test-Path $exe)) { continue }
  $ver = (& $exe -v 2>$null)
  if ($ver -eq "v$Expected") { $resolved = [System.IO.Path]::GetFullPath($dir); break }
}

if (-not $resolved) {
  $tried = ($candidates | Where-Object { $_ } | Select-Object -Unique) -join "`n  "
  throw @"
No se encontró una instalación de Node $Expected.
Instala Node $Expected con fnm, nvm-windows o volta, o indica la carpeta:
  . .\tools\agentic\use-node24.ps1 -NodeHome 'C:\ruta\a\node24'
  `$env:SR_NODE24 = 'C:\ruta\a\node24'
Carpetas probadas:
  $tried
"@
}

# --- 3. Anteponer al PATH del proceso actual, sin duplicar ----------------
$current = ($env:Path -split ';') | Where-Object { $_ -ne '' }
$normalized = $resolved.TrimEnd('\')
$withoutOld = $current | Where-Object { $_.TrimEnd('\') -ine $normalized }
$env:Path = (@($resolved) + $withoutOld) -join ';'

# Deja también pnpm/corepack del mismo prefijo disponibles (ya están en esa carpeta).
$pnpmCmd = Join-Path $resolved 'pnpm.cmd'
$pnpmNote = if (Test-Path $pnpmCmd) { "pnpm: $((& $pnpmCmd -v 2>$null))" } else { "pnpm: no encontrado en $resolved" }

# --- 4. Verificar y reportar ---------------------------------------------
$actual = (& (Join-Path $resolved 'node.exe') -v).Trim()
if ($actual -ne "v$Expected") {
  throw "Node en $resolved es $actual, se esperaba v$Expected."
}

# ¿Se ejecutó con -File en vez de dot-source? El PATH no vuelve al padre.
$dotSourced = $MyInvocation.InvocationName -eq '.'

Write-Host "Node activo: $actual  ($resolved)"
Write-Host $pnpmNote
if (-not $dotSourced) {
  Write-Warning 'El cambio de PATH vive solo en este proceso hijo (ejecución con -File). Windows no lo propaga al shell padre. Usa dot-sourcing para que turbo y tu shell vean Node 24:'
  Write-Host '    . .\tools\agentic\use-node24.ps1' -ForegroundColor Yellow
}
