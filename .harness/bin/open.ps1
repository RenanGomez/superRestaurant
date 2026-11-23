<#
.SYNOPSIS  Registro de lo que una sesión/motor deja abierto (procesos, puertos). Ver ORCHESTRATOR.md, "Limpieza".
.EXAMPLE   open.ps1 -Add -ProcId 1234 -Port 5173 -What "vite dev"                     # cleanup.ps1 lo cierra
.EXAMPLE   open.ps1 -Add -ProcId 1234 -Port 5173 -What "vite" -Keep "el usuario lo prueba"   # se respeta
.EXAMPLE   open.ps1 -Done -ProcId 1234     |   open.ps1 -List
#>
param([switch]$Add, [switch]$Done, [switch]$List,
      [int]$ProcId, [int]$Port, [string]$What = '', [string]$Keep = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot)
$dir  = Join-Path $root '.harness\run'; New-Item -ItemType Directory -Force $dir | Out-Null
$file = Join-Path $dir 'open.json'
$enc  = New-Object System.Text.UTF8Encoding $false
$items = @(if (Test-Path $file) { (Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { $_.pid } })
if ($Port -and -not $ProcId) { $ProcId = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess }
if ($Add) {
  if (-not $ProcId) { throw 'Falta -ProcId (o un -Port que esté escuchando)' }
  $items = @($items | Where-Object { $_.pid -ne $ProcId }) + [pscustomobject]@{
    pid = $ProcId; port = $Port; what = $What; keep = $Keep; at = (Get-Date -f s) }
} elseif ($Done) {
  $items = @($items | Where-Object { $_.pid -ne $ProcId -and (-not $Port -or $_.port -ne $Port) })
}
[IO.File]::WriteAllText($file, $(if ($items) { ConvertTo-Json -InputObject @($items) -Depth 4 } else { '[]' }), $enc)
# los "keep" se reflejan en ~/agent-harness/keep.txt para que reaper.ps1 (global) tampoco los mate
$kf = Join-Path $HOME 'agent-harness\keep.txt'
$others = @(if (Test-Path $kf) { Get-Content $kf | Where-Object { $_ -and $_ -notlike "*`t$root" } })
$mine = @($items | Where-Object { $_.keep } | ForEach-Object { "$($_.pid)`t$root" })
[IO.File]::WriteAllLines($kf, [string[]]($others + $mine), $enc)
if ($List -or $Add -or $Done) { if ($items) { $items | Format-Table pid, port, what, keep, at -AutoSize | Out-String } else { 'registro vacío' } }
