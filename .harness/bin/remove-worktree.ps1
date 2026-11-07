<#
.SYNOPSIS
  Borra el worktree de un run (rama harness/<Id>) sin riesgo: se niega si dentro hay enlaces (junctions/symlinks),
  porque un borrado forzado los sigue y vacía las carpetas originales (así se perdió godot/game_assets el 2026-11-06).
  Busca el worktree por su rama, esté en .harness/worktrees (gemini) o en config.codex.worktreeDir (codex).
.EXAMPLE
  powershell -NoProfile -File .harness/bin/remove-worktree.ps1 -Id T015-Q2
#>
param([Parameter(Mandatory)][string]$Id, [switch]$DeleteBranch)
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$wt = (git -C $root worktree list --porcelain) -join "`n" -split "`n`n" |
      Where-Object { $_ -match "branch refs/heads/harness/$([regex]::Escape($Id))$" } |
      ForEach-Object { ($_ -split "`n")[0] -replace '^worktree ', '' } | Select-Object -First 1
if (-not $wt -or -not (Test-Path $wt)) { Write-Error "No hay worktree para harness/$Id"; exit 2 }
$links = Get-ChildItem $wt -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue
if ($links) {
  $links | ForEach-Object { Write-Host "ENLACE: $($_.FullName)" }
  Write-Error "El worktree tiene enlaces; quítalos a mano (Remove-Item del enlace, sin -Recurse) y repite."
  exit 3
}
& git -C $root worktree remove $wt
if ($LASTEXITCODE -ne 0) { Write-Error "git no pudo borrarlo (¿cambios sin commit?). No uses -f: revisa primero."; exit 4 }
if ($DeleteBranch) { & git -C $root branch -d "harness/$Id" }   # -d: solo si ya está fusionada
Write-Host "Borrado $wt"
