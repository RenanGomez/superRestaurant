<#
.SYNOPSIS  Cierra lo que el trabajo dejó abierto en este proyecto. Ver ORCHESTRATOR.md, "Limpieza".
  1. Registro .harness/run/open.json (open.ps1): mata cada entrada sin "keep"; las "keep" solo se informan.
  2. -Hook  (hook Stop de Claude): además, procesos de esta sesión que escuchan en un puerto y no están en "keep".
  3. -Since (drain.ps1 al acabar): procesos de trabajo creados desde esa hora que no cuelgan de una sesión de
     Claude viva (restos de codex/gemini/dsh: servidores, watchers, Godot...).
  -DryRun: solo lista.
#>
param([switch]$Hook, [string]$Since, [switch]$DryRun)
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path (Split-Path $PSScriptRoot)
if ($Hook) { $in = [Console]::In.ReadToEnd() | ConvertFrom-Json; if ($in.cwd -and (Test-Path "$($in.cwd)\.harness")) { $root = $in.cwd } }
$file = Join-Path $root '.harness\run\open.json'
$work = '^(node|bash|sh|python\d*|py|godot.*|cmd|powershell|pwsh|deno|bun|uv|uvx|npm|npx|vite|esbuild|java|dotnet|ffmpeg|ngrok|docker|php|ruby|go|cargo)\.exe$'
$prot = 'codegraph|--mcp|mcp-server|\bmcp\b|drain\.ps1|agent\.ps1|enqueue\.ps1|reaper\.ps1|cleanup\.ps1|guard\.ps1|codex(\.js)?"?\s+exec|\brtk\b|Antigravity|agy-|codex-runtimes'
$all  = @(Get-CimInstance Win32_Process); $byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
function IsSession($p) { $p -and $p.Name -eq 'claude.exe' -and "$($p.ExecutablePath)" -match '\\claude-code\\' }
function Chain($p) { $seen = @{}; while ($p -and -not $seen[[int]$p.ProcessId]) { $seen[[int]$p.ProcessId] = 1; $p
  $par = $byId[[int]$p.ParentProcessId]; if ($par -and $par.CreationDate -gt $p.CreationDate) { break }; $p = $par } }
$self = @{}; $mySession = $null
foreach ($p in (Chain $byId[$PID])) { $self[[int]$p.ProcessId] = 1; if (IsSession $p) { $mySession = $p; break } }

$items = @(if (Test-Path $file) { (Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { $_.pid } })
$keepIds = @{}; foreach ($i in $items | Where-Object { $_.keep }) { $keepIds[[int]$i.pid] = $i }
$kf = Join-Path $HOME 'agent-harness\keep.txt'
if (Test-Path $kf) { Get-Content $kf | ForEach-Object { $k = ($_ -split "`t")[0]; if ($k -match '^\d+$' -and -not $keepIds[[int]$k]) { $keepIds[[int]$k] = 1 } } }
function Kept($p) { foreach ($a in (Chain $p)) { if ($keepIds[[int]$a.ProcessId]) { return $true } }; $false }

$kill = @{}; $why = @{}
foreach ($i in $items | Where-Object { -not $_.keep }) {
  $p = $byId[[int]$i.pid]; if ($p -and -not $self[[int]$i.pid]) { $kill[[int]$i.pid] = $p; $why[[int]$i.pid] = "registro: $($i.what)" } }
if ($Hook -and $mySession) {
  foreach ($c in @(Get-NetTCPConnection -State Listen)) { $p = $byId[[int]$c.OwningProcess]
    if (-not $p -or $self[[int]$p.ProcessId] -or "$($p.CommandLine)" -match $prot -or (Kept $p)) { continue }
    $ch = @(Chain $p); if ($ch | Where-Object { "$($_.CommandLine)" -match $prot }) { continue }
    # de esta sesión: cuelga de ella, o es un huérfano (su shell ya terminó) de trabajo creado durante la sesión
    $top = $ch[-1]; $orphan = -not $byId[[int]$top.ParentProcessId] -and $top.Name -match $work -and $top.CreationDate -gt $mySession.CreationDate
    if (($ch | Where-Object { $_.ProcessId -eq $mySession.ProcessId }) -or ($orphan -and -not (IsSession $top))) { $kill[[int]$p.ProcessId] = $p; $why[[int]$p.ProcessId] = "puerto $($c.LocalPort)" } }
}
if ($Since) { $t0 = [datetime]$Since
  foreach ($p in $all) {
    if ($p.CreationDate -lt $t0 -or $p.Name -notmatch $work -or $self[[int]$p.ProcessId] -or "$($p.CommandLine)" -match $prot -or (Kept $p)) { continue }
    $ch = @(Chain $p)
    if ($ch | Where-Object { IsSession $_ }) { continue }                       # de una sesión viva: lo gestiona ella
    # solo lo nuestro: cuelga de un motor, o su línea de comandos apunta al proyecto / a un worktree del harness
    $ours = ($ch | Select-Object -Skip 1 | Where-Object { "$($_.CommandLine)" -match 'agent\.ps1|codex|opencode|dsh|gemini' }) -or
            ("$($p.CommandLine)" -match ([regex]::Escape($root) + '|harness[\\/]'))
    if (-not $ours) { continue }
    $kill[[int]$p.ProcessId] = $p; $why[[int]$p.ProcessId] = 'resto de motor' }
}
$roots = @($kill.Values | Where-Object { -not $kill[[int]$_.ParentProcessId] })
$out = @()
foreach ($p in $roots) {
  $cmd = ("$($p.CommandLine)" -replace '\s+', ' '); $cmd = $cmd.Substring(0, [Math]::Min(120, $cmd.Length))
  $out += "{0} pid={1} ({2}) :: {3}" -f $(if ($DryRun) {'DRY'} else {'KILL'}), $p.ProcessId, $why[[int]$p.ProcessId], $cmd
  if (-not $DryRun) { & taskkill.exe /PID $p.ProcessId /T /F *> $null } }
# registro: quitar lo muerto, conservar keep
$alive = @($items | Where-Object { $_.keep -and $byId[[int]$_.pid] -and -not $kill[[int]$_.pid] })
if ((Test-Path $file) -and -not $DryRun) { [IO.File]::WriteAllText($file, $(if ($alive) { ConvertTo-Json -InputObject @($alive) -Depth 4 } else { '[]' }), (New-Object System.Text.UTF8Encoding $false)) }
$keptMsg = @($alive | ForEach-Object { "SIGUE ABIERTO pid=$($_.pid)$(if ($_.port) {" puerto $($_.port)"}) ($($_.what)): $($_.keep)" })
if ($out -and -not $DryRun) { Add-Content (Join-Path $HOME 'agent-harness\reaper.log') ($out | ForEach-Object { "{0:s} cleanup $_" -f (Get-Date) }) -Encoding UTF8 }
if ($Hook) {
  if ($out -or $keptMsg) { @{ systemMessage = "Limpieza del harness:`n" + (($out + $keptMsg) -join "`n") } | ConvertTo-Json -Compress } }
else { $out + $keptMsg; if (-not ($out + $keptMsg)) { 'nada abierto' } }
exit 0
