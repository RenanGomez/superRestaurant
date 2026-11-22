<#
.SYNOPSIS
  Resumen de un tick del loop autonomo de superRestaurant.

.DESCRIPTION
  Imprime en 40 lineas o menos: sesiones AO, PRs abiertos con CI y revision,
  estado del CI de main, resumen de docs/agentic/backlog.json y avance del hito.
  Tambien reescribe docs/agentic/status.md con el mismo resumen.

  Se ejecuta desde cualquier directorio:
    powershell -NoProfile -File tools/agentic/loop-tick.ps1

.PARAMETER Project
  Proyecto de agent-orchestrator. Predeterminado: superrestaurant.

.PARAMETER NoStatusWrite
  No reescribe docs/agentic/status.md (util para inspecciones de solo lectura).
#>
[CmdletBinding()]
param(
  [string]$Project = 'superrestaurant',
  [switch]$NoStatusWrite
)

$ErrorActionPreference = 'Continue'
$MaxLines = 40

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$agenticDir = Join-Path $repoRoot 'docs\agentic'
$backlogPath = Join-Path $agenticDir 'backlog.json'
$statusPath = Join-Path $agenticDir 'status.md'

function Limit-Text {
  param([string]$Text, [int]$Max)
  if ($null -eq $Text) { return '' }
  if ($Text.Length -le $Max) { return $Text }
  return $Text.Substring(0, [Math]::Max(0, $Max - 3)) + '...'
}

function Invoke-Capture {
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  if (-not (Get-Command $File -ErrorAction SilentlyContinue)) {
    return [pscustomobject]@{ ExitCode = -1; Lines = @("$File no disponible en PATH"); Text = '' }
  }
  $captured = @(& $File @Arguments 2>&1)
  $exit = $LASTEXITCODE
  $lines = @($captured | ForEach-Object { $_.ToString() })
  return [pscustomobject]@{
    ExitCode = $exit
    Lines    = $lines
    Text     = ($lines -join "`n")
  }
}

function Get-CiLabel {
  param($Rollup)
  $checks = @($Rollup | Where-Object { $null -ne $_ })
  $total = $checks.Count
  if ($total -eq 0) { return 'CI -' }
  $ok = @($checks | Where-Object { $_.conclusion -eq 'SUCCESS' }).Count
  $badStates = @('FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE')
  $bad = @($checks | Where-Object { $badStates -contains $_.conclusion }).Count
  $pending = $total - $ok - $bad
  if ($bad -gt 0) { return "CI $ok/$total FAIL" }
  if ($pending -gt 0) { return "CI $ok/$total pend" }
  return "CI $ok/$total ok"
}

$now = Get-Date
$stamp = $now.ToString('yyyy-MM-dd HH:mm zzz')
$out = New-Object System.Collections.Generic.List[string]
$status = New-Object System.Collections.Generic.List[string]

# --- Cabecera -------------------------------------------------------------
$out.Add("LOOP TICK $stamp | proyecto $Project")
$status.Add('# Estado del loop')
$status.Add('')
$status.Add("Actualizado: $stamp")
$status.Add('')

# --- CI de main -----------------------------------------------------------
$mainLine = 'main CI: sin datos'
$mainRuns = Invoke-Capture -File 'gh' -Arguments @(
  'run', 'list', '--branch', 'main', '--limit', '1',
  '--json', 'status,conclusion,name,headSha,createdAt'
)
if ($mainRuns.ExitCode -ne 0) {
  $mainLine = "main CI: error consultando gh ($($mainRuns.Lines | Select-Object -First 1))"
} elseif ([string]::IsNullOrWhiteSpace($mainRuns.Text)) {
  $mainLine = 'main CI: sin ejecuciones registradas'
} else {
  try {
    $parsed = @((($mainRuns.Text | ConvertFrom-Json) | Where-Object { $null -ne $_ }))
    if ($parsed.Count -eq 0) {
      $mainLine = 'main CI: sin ejecuciones registradas'
    } else {
      $run = $parsed[0]
      $state = if ($run.status -ne 'completed') { $run.status } elseif ($run.conclusion) { $run.conclusion } else { 'unknown' }
      $when = $run.createdAt
      try {
        $when = ([datetimeoffset]::Parse($run.createdAt)).ToLocalTime().ToString('yyyy-MM-dd HH:mm')
      } catch { }
      $sha = ''
      if ($run.headSha) { $sha = $run.headSha.Substring(0, [Math]::Min(8, $run.headSha.Length)) }
      $mainLine = "main CI: $state ($($run.name) @ $sha, $when)"
    }
  } catch {
    $mainLine = "main CI: JSON invalido de gh ($($_.Exception.Message))"
  }
}
$out.Add($mainLine)
$status.Add('## CI de main')
$status.Add('')
$status.Add("- $mainLine")
$status.Add('')

# --- Sesiones AO ----------------------------------------------------------
$sessionLines = @()
$sessions = Invoke-Capture -File 'ao' -Arguments @('session', 'ls', '--project', $Project)
if ($sessions.ExitCode -ne 0) {
  $sessionLines = @("ao session ls fallo: $($sessions.Lines | Select-Object -First 1)")
} elseif ($sessions.Lines.Count -eq 0) {
  $sessionLines = @('(sin sesiones)')
} else {
  $sessionLines = @($sessions.Lines | Select-Object -First 6)
  if ($sessions.Lines.Count -gt 6) {
    $sessionLines += "  ... (+$($sessions.Lines.Count - 6) lineas)"
  }
}
$out.Add("SESIONES (ao session ls --project $Project)")
foreach ($line in $sessionLines) { $out.Add("  $line") }
$status.Add('## Sesiones')
$status.Add('')
$status.Add('```')
foreach ($line in $sessionLines) { $status.Add($line) }
$status.Add('```')
$status.Add('')

# --- PRs abiertos ---------------------------------------------------------
$prLines = New-Object System.Collections.Generic.List[string]
$prs = Invoke-Capture -File 'gh' -Arguments @(
  'pr', 'list', '--state', 'open', '--limit', '100',
  '--json', 'number,title,statusCheckRollup,reviewDecision'
)
$openPrCount = 0
if ($prs.ExitCode -ne 0) {
  $prLines.Add("gh pr list fallo: $($prs.Lines | Select-Object -First 1)")
} elseif ([string]::IsNullOrWhiteSpace($prs.Text)) {
  $prLines.Add('(sin PRs abiertos)')
} else {
  try {
    $prData = @((($prs.Text | ConvertFrom-Json) | Where-Object { $null -ne $_ }))
    $openPrCount = $prData.Count
    if ($openPrCount -eq 0) {
      $prLines.Add('(sin PRs abiertos)')
    } else {
      $shown = 0
      foreach ($pr in $prData) {
        if ($shown -ge 8) { break }
        $ci = Get-CiLabel -Rollup $pr.statusCheckRollup
        $review = if ($pr.reviewDecision) { $pr.reviewDecision } else { 'sin revision' }
        $title = Limit-Text -Text ([string]$pr.title) -Max 58
        $prLines.Add(('#{0} {1} | {2} | {3}' -f $pr.number, $title, $ci, $review))
        $shown++
      }
      if ($openPrCount -gt 8) { $prLines.Add("... (+$($openPrCount - 8) PRs)") }
    }
  } catch {
    $prLines.Add("JSON invalido de gh pr list: $($_.Exception.Message)")
  }
}
$out.Add("PRS ABIERTOS (gh pr list): $openPrCount")
foreach ($line in $prLines) { $out.Add("  $line") }
$status.Add('## PRs abiertos')
$status.Add('')
$status.Add("- Total: $openPrCount")
foreach ($line in $prLines) { $status.Add("- $line") }
$status.Add('')

# --- Backlog --------------------------------------------------------------
$items = @()
$backlogMilestone = 'M0'
$backlogError = $null
if (Test-Path -LiteralPath $backlogPath) {
  try {
    $backlog = Get-Content -LiteralPath $backlogPath -Raw | ConvertFrom-Json
    if ($backlog.items) { $items = @($backlog.items) }
    if ($backlog.milestone) { $backlogMilestone = [string]$backlog.milestone }
  } catch {
    $backlogError = "backlog.json invalido: $($_.Exception.Message)"
  }
} else {
  $backlogError = 'backlog.json no encontrado'
}

$out.Add("BACKLOG (docs/agentic/backlog.json) hito $backlogMilestone")
$status.Add('## Backlog')
$status.Add('')

if ($backlogError) {
  $out.Add("  $backlogError")
  $status.Add("- $backlogError")
} else {
  $counts = [ordered]@{}
  foreach ($st in @('ready', 'running', 'pr', 'review', 'merged', 'parked', 'cancelled')) {
    $counts[$st] = @($items | Where-Object { $_.status -eq $st }).Count
  }
  $out.Add(('  items {0} | ready {1} running {2} pr {3} review {4} merged {5} parked {6} cancelled {7}' -f `
        $items.Count, $counts['ready'], $counts['running'], $counts['pr'], $counts['review'], $counts['merged'], $counts['parked'], $counts['cancelled']))

  $byMilestone = @($items | Group-Object -Property milestone | Sort-Object Name)
  if ($byMilestone.Count -eq 0) {
    $out.Add('  (sin items)')
  } else {
    $shown = 0
    foreach ($group in $byMilestone) {
      if ($shown -ge 8) { break }
      $all = @($group.Group)
      $cancelled = @($all | Where-Object { $_.status -eq 'cancelled' }).Count
      $den = $all.Count - $cancelled
      $merged = @($all | Where-Object { $_.status -eq 'merged' }).Count
      if ($den -gt 0) {
        $pct = [Math]::Round((100.0 * $merged) / $den, 0)
        $pctText = "$pct%"
      } else {
        $pctText = 'n/a'
      }
      $ready = @($all | Where-Object { $_.status -eq 'ready' }).Count
      $running = @($all | Where-Object { $_.status -eq 'running' }).Count
      $pr = @($all | Where-Object { $_.status -eq 'pr' }).Count
      $review = @($all | Where-Object { $_.status -eq 'review' }).Count
      $parked = @($all | Where-Object { $_.status -eq 'parked' }).Count
      $out.Add(("  {0}: {1}/{2} ({3}) merged | ready {4} running {5} pr {6} review {7} parked {8}" -f `
            $group.Name, $merged, $den, $pctText, $ready, $running, $pr, $review, $parked))
      $status.Add(("- **{0}**: {1}/{2} ({3}) merged; ready {4}, running {5}, pr {6}, review {7}, parked {8}, cancelled {9}" -f `
            $group.Name, $merged, $den, $pctText, $ready, $running, $pr, $review, $parked, $cancelled))
      $shown++
    }
    if ($byMilestone.Count -gt 8) {
      $out.Add("  ... (+$($byMilestone.Count - 8) hitos)")
    }
  }

  $allCancelled = @($items | Where-Object { $_.status -eq 'cancelled' }).Count
  $allMerged = @($items | Where-Object { $_.status -eq 'merged' }).Count
  $allDen = $items.Count - $allCancelled
  if ($allDen -gt 0) {
    $globalPct = [Math]::Round((100.0 * $allMerged) / $allDen, 0)
    $out.Add("  GLOBAL: $allMerged/$allDen ($globalPct%) merged de $($items.Count) registrados")
  } else {
    $out.Add("  GLOBAL: 0/0 (n/a) merged de $($items.Count) registrados")
  }

  if ($items.Count -gt 0) {
    $status.Add('')
    $status.Add('| id | hito | nivel | carril | estado |')
    $status.Add('|---|---|---|---|---|')
    foreach ($item in $items) {
      $status.Add(('| {0} | {1} | {2} | {3} | {4} |' -f $item.id, $item.milestone, $item.level, $item.lane, $item.status))
    }
  }
}
$status.Add('')

# --- Salida ---------------------------------------------------------------
$final = @($out)
if ($final.Count -gt $MaxLines) {
  $final = @($final | Select-Object -First ($MaxLines - 1)) + '... (salida truncada a 40 lineas)'
}
$final | ForEach-Object { Write-Output $_ }

if (-not $NoStatusWrite) {
  if (-not (Test-Path -LiteralPath $agenticDir)) {
    New-Item -ItemType Directory -Path $agenticDir -Force | Out-Null
  }
  [System.IO.File]::WriteAllLines($statusPath, $status, (New-Object System.Text.UTF8Encoding($false)))
}
