<#
.SYNOPSIS
  Hook de Claude Code que obliga a delegar. Lo registra install.ps1 en .claude/settings.json del proyecto.
  - UserPromptSubmit: si el mensaje del usuario contiene OVERRIDE, levanta el límite para esta sesión.
  - PreToolUse (Edit|Write|MultiEdit|NotebookEdit): suma las líneas que la sesión escribe en archivos de código
    y, pasado config.guard.maxLines, niega la edición con instrucciones para delegar a codex/gemini.
  Archivos del harness, .claude/ y Markdown no cuentan (cola, notas, handoff, briefs).
#>
$ErrorActionPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$in = [Console]::In.ReadToEnd() | ConvertFrom-Json
if (-not $in) { exit 0 }

$harness = Split-Path $PSScriptRoot -Parent
$root    = Split-Path $harness -Parent
$cfg     = Get-Content (Join-Path $harness 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$max     = if ($cfg.guard -and $cfg.guard.maxLines) { [int]$cfg.guard.maxLines } else { 30 }
if ($cfg.guard -and $cfg.guard.enabled -eq $false) { exit 0 }

$stateDir = Join-Path $harness 'state'
New-Item -ItemType Directory -Force $stateDir | Out-Null
$sid   = ($in.session_id -replace '[^\w-]', '')
$stFile = Join-Path $stateDir "guard-$sid.json"
$st = if (Test-Path $stFile) { Get-Content $stFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{ lines = 0; override = $false; files = @() } }
function Save { [IO.File]::WriteAllText($stFile, ($st | ConvertTo-Json -Compress), $utf8) }
function Log($msg) { [IO.File]::AppendAllText((Join-Path $stateDir 'guard.log'), "$(Get-Date -Format s) $sid $msg`n", $utf8) }

if ($in.hook_event_name -eq 'UserPromptSubmit') {
  if ($in.prompt -cmatch '\bOVERRIDE\b') { $st.override = $true; Save; Log 'override' }
  exit 0
}

# --- PreToolUse ---
$ti   = $in.tool_input
$path = if ($ti.file_path) { $ti.file_path } else { $ti.notebook_path }
if (-not $path) { exit 0 }
$full = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($path)) { $path } else { Join-Path $root $path }))
$rel  = if ($full.StartsWith($root, 'OrdinalIgnoreCase')) { $full.Substring($root.Length).TrimStart('\','/') } else { $full }
if ($rel -match '^(\.harness|\.claude)[\\/]' -or $rel -match '\.md$') { exit 0 }

function Count($s) { if ($s) { ([string]$s -split "`n").Count } else { 0 } }
$n = switch ($in.tool_name) {
  'Write'     { Count $ti.content }
  'MultiEdit' { ($ti.edits | ForEach-Object { Count $_.new_string } | Measure-Object -Sum).Sum }
  'NotebookEdit' { Count $ti.new_source }
  default     { Count $ti.new_string }
}
$total = $st.lines + $n

if ($total -gt $max -and -not $st.override) {
  Log "deny $rel +$n (total $total)"
  $reason = "agent-harness: esta sesión ya escribió $($st.lines) líneas de código (límite $max). " +
    "Delega: escribe .harness/runs/<id>/brief.md y lanza .harness/bin/agent.ps1 (codex para implementar, " +
    "gemini -Write -Worktree para tests/boilerplate) según routing.md. Si el motor está agotado, deja la tarea en la cola. " +
    "Solo el usuario puede levantar el límite escribiendo OVERRIDE en su mensaje; no se lo pidas salvo que delegar sea imposible."
  @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason } } |
    ConvertTo-Json -Compress -Depth 5
  exit 0
}
$st.lines = $total
if ($st.files -notcontains $rel) { $st.files = @($st.files) + $rel }
Save
exit 0
