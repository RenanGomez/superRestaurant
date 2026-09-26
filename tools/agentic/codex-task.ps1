<#
.SYNOPSIS
  Runs one Codex CLI (ChatGPT Plus login, never OPENAI_API_KEY) task in its own git worktree.

.DESCRIPTION
  L2 runner for the multi-agent harness. Each call:
    1. creates (or reuses) a worktree at C:\tmp\sr-wt\<Task> on branch codex/<Task> from <Base>;
    2. runs `codex exec` non-interactively, sandbox workspace-write, approvals never,
       with the context packet as prompt and Node 24 + pnpm 11 on PATH;
    3. writes the JSONL event log and the last message under .claude\runs\<Task>\.
  Several tasks can run in parallel: each has its own worktree and log directory.
  Codex never pushes, merges or touches Supabase remoto: the sandbox only writes inside the worktree.

.EXAMPLE
  .\tools\agentic\codex-task.ps1 -Task s5-catalog-ui -Packet .\.claude\packets\s5-catalog-ui.md
  .\tools\agentic\codex-task.ps1 -Task s5-catalog-ui -Packet ... -Resume   # continue the same thread
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Task,
  [Parameter(Mandatory)] [string] $Packet,
  [string] $Base = "main",
  [string] $Model = "",
  [ValidateSet("low","medium","high")] [string] $Effort = "medium",
  [switch] $Resume,
  [switch] $ReadOnly
)
# "Continue": Windows PowerShell 5.1 turns native stderr (git progress, codex logs) into
# terminating errors under "Stop". Exit codes are checked explicitly instead.
$ErrorActionPreference = "Continue"
if ($env:OPENAI_API_KEY) { throw "OPENAI_API_KEY está definida; el harness exige login ChatGPT Plus. Quita la variable." }
if ($Task -notmatch '^[a-z0-9][a-z0-9-]{2,40}$') { throw "Task debe ser kebab-case corto: $Task" }
if (-not (Test-Path $Packet)) { throw "Paquete no encontrado: $Packet" }

$repo = (git rev-parse --show-toplevel).Trim()
$node24 = Join-Path $env:LOCALAPPDATA "Programs\node24"
if (-not (Test-Path "$node24\node.exe")) { throw "Node 24 no está en $node24" }
$env:Path = "$node24;$env:Path"

# Newest Codex CLI shipped with the desktop app (the hashed subfolder changes on updates).
$codex = Get-ChildItem (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin") -Recurse -Filter codex.exe |
  Sort-Object { [version]((& $_.FullName --version) -replace '^codex-cli\s+','' -replace '-.*$','') } -Descending |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $codex) { throw "codex.exe no encontrado bajo %LOCALAPPDATA%\OpenAI\Codex\bin" }

$wtRoot = "C:\tmp\sr-wt"
$wt = Join-Path $wtRoot $Task
$branch = "codex/$Task"
New-Item -ItemType Directory -Force $wtRoot | Out-Null
if (-not (Test-Path $wt)) {
  if (git -C $repo branch --list $branch) { git -C $repo worktree add -q $wt $branch 2>&1 | Out-Null }
  else { git -C $repo worktree add -q -b $branch $wt $Base 2>&1 | Out-Null }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $wt)) { throw "git worktree add falló" }
}

$runDir = Join-Path $repo ".claude\runs\$Task"
New-Item -ItemType Directory -Force $runDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$events = Join-Path $runDir "$stamp.events.jsonl"
$last = Join-Path $runDir "$stamp.last.md"
$threadFile = Join-Path $runDir "thread-id.txt"

$prompt = Get-Content $Packet -Raw
$prompt += "`n`n## Reglas del harness`n- Trabajas en el worktree $wt, rama $branch. Haz commits locales pequeños con conventional commits.`n- Nunca git push/merge/rebase, nunca toques Supabase remoto, nunca edites migraciones ya existentes.`n- Node 24 y pnpm 11 están en PATH; ejecuta los comandos de verificación del paquete y pega su salida literal.`n- No edites TODO.md, HANDOFF.md ni PROJECT_NOTES.md."

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$sandbox = if ($ReadOnly) { "read-only" } else { "workspace-write" }
# Objects and refs of a linked worktree live in the main repo's .git; grant it so Codex can
# commit locally (it still cannot touch the main working tree).
$gitDir = Join-Path $repo ".git"

# The sandbox has no network: restore dependencies from the pnpm store before Codex starts.
if (-not (Test-Path (Join-Path $wt "node_modules"))) {
  Write-Host "pnpm install (offline-first) en $wt"
  Push-Location $wt
  pnpm install --frozen-lockfile --prefer-offline 2>&1 | Select-Object -Last 3
  Pop-Location
}
$args = @("exec", "-C", $wt, "--add-dir", $gitDir, "-s", $sandbox, "-c", "approval_policy=`"never`"",
          "-c", "model_reasoning_effort=`"$Effort`"", "--json", "-o", $last)
if ($Model) { $args += @("-m", $Model) }
if ($Resume -and (Test-Path $threadFile)) {
  $args = @("exec", "resume", (Get-Content $threadFile -Raw).Trim(), "-C", $wt, "--add-dir", $gitDir,
            "-s", $sandbox, "-c", "approval_policy=`"never`"", "--json", "-o", $last)
}

Write-Host "codex: $codex"
Write-Host "worktree: $wt ($branch) · sandbox: $sandbox · log: $events"
$prompt | & $codex @args 2>&1 | Tee-Object -FilePath $events | Out-Null
$exit = $LASTEXITCODE

# Persist thread id for -Resume, if the event stream carried one.
$idLine = Select-String -Path $events -Pattern '"(thread_id|session_id)"\s*:\s*"([^"]+)"' | Select-Object -First 1
if ($idLine) { $idLine.Matches[0].Groups[2].Value | Set-Content $threadFile -Encoding ascii }

Write-Host "---- último mensaje ----"
if (Test-Path $last) { Get-Content $last -Raw }
Write-Host "---- git status del worktree ----"
git -C $wt status --short
Write-Host "codex exit: $exit"
exit $exit
