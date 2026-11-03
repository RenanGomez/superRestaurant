<#
.SYNOPSIS
  Hook pre-commit (lo llama .git/hooks/pre-commit): rechaza archivos staged de más de config.largeFiles.maxMB
  salvo que coincidan con config.largeFiles.allow (globs estilo git: `godot/data/**`, `*.ogg`).
  Nunca borra ni modifica nada; para una excepción puntual: git commit --no-verify.
#>
$ErrorActionPreference = 'Stop'
$harness = Split-Path $PSScriptRoot -Parent
$cfg = (Get-Content (Join-Path $harness 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json).largeFiles
if ($cfg -and $cfg.enabled -eq $false) { exit 0 }
$maxMB = if ($cfg -and $cfg.maxMB) { [double]$cfg.maxMB } else { 1 }
$allow = @(if ($cfg) { $cfg.allow })

function Like($path, $glob) {        # glob → regex: ** cualquier ruta, * dentro de un segmento
  $rx = '^' + ([regex]::Escape($glob) -replace '\\\*\\\*/?', '.*' -replace '\\\*', '[^/]*' -replace '\\\?', '.') + '$'
  if ($glob -notmatch '/') { $path = Split-Path $path -Leaf }   # sin carpeta: compara solo el nombre
  $path -match $rx
}

$big = foreach ($f in (git diff --cached --name-only --diff-filter=AM)) {
  $size = [long](git cat-file -s ":$f" 2>$null)
  if ($size -gt $maxMB * 1MB -and -not ($allow | Where-Object { Like $f $_ })) { "  $([math]::Round($size / 1MB, 1)) MB  $f" }
}
if (-not $big) { exit 0 }
[Console]::Error.WriteLine(@"
agent-harness: estos archivos superan $maxMB MB:
$($big -join "`n")
Si son necesarios, añade su ruta o un patrón a .harness/config.json -> largeFiles.allow (p. ej. "godot/data/**")
o, para assets binarios pesados, considera Git LFS. Excepción puntual: git commit --no-verify
"@)
exit 1
