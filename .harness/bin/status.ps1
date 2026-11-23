<#
.SYNOPSIS
  Estado corto de la cola: tabla desde .harness/state/status.json (id, motor, salud, elapsed/eta, idle, último
  output), contenido de .harness/state/ALERT y si el drain.lock tiene un PID vivo. Lo usa guard.ps1 y el orquestador.
.EXAMPLE
  powershell -NoProfile -File .harness/bin/status.ps1
  powershell -NoProfile -File .harness/bin/status.ps1 -MaxLines 12
#>
param([int]$MaxLines = 0, [string]$StateDir = '')
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$harness  = Split-Path $PSScriptRoot -Parent
$stateDir = if ($StateDir) { [IO.Path]::GetFullPath($StateDir) } else { Join-Path $harness 'state' }
$sf = Join-Path $stateDir 'status.json'
$af = Join-Path $stateDir 'ALERT'
$lf = Join-Path $stateDir 'drain.lock'

$lines = New-Object System.Collections.Generic.List[string]

$drain = 'parado'
if (Test-Path $lf) {
  $p = (Get-Content $lf -Raw) -as [int]
  if ($p -and (Get-Process -Id $p -ErrorAction SilentlyContinue)) { $drain = "activo (PID $p)" }
  else { $drain = 'parado (lock huerfano)' }
}
$lines.Add("drain: $drain")

$sj = $null
if (Test-Path $sf) { try { $sj = Get-Content $sf -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $sj = $null } }
if (-not $sj) {
  $lines.Add('sin runs')
} else {
  $tasks = @($sj.tasks)
  $lines.Add("cola: $($tasks.Count) tarea(s) | actualizado $($sj.updated)")
  if ($tasks.Count) {
    $lines.Add(("{0,-14} {1,-7} {2,-8} {3,-11} {4,-5} {5}" -f 'id','motor','salud','elapsed/eta','idle','ultimo output'))
    foreach ($t in $tasks) {
      $eta  = if ($null -ne $t.eta_min)     { [double]$t.eta_min }     else { 0 }
      $el   = if ($null -ne $t.elapsed_min) { [double]$t.elapsed_min } else { 0 }
      $idle = if ($null -ne $t.idle_min)    { [double]$t.idle_min }    else { 0 }
      $out  = ("$($t.last_output)" -replace '\s+', ' ').Trim()
      if ($out.Length -gt 34) { $out = $out.Substring(0,31) + '...' }
      $id = "$($t.id)"; if ($id.Length -gt 14) { $id = $id.Substring(0,14) }
      $sal = if ($t.health) { "$($t.health)" } else { "$($t.status)" }
      $lines.Add(("{0,-14} {1,-7} {2,-8} {3,-11} {4,-5} {5}" -f $id, $t.engine, $sal, ("{0:N0}/{1:N0}" -f $el,$eta), ("{0:N0}" -f $idle), $out))
    }
  }
}
if (Test-Path $af) {
  $lines.Add('--- ALERTA')
  foreach ($l in @(Get-Content $af -Encoding UTF8 -TotalCount 4)) { if ($l) { $lines.Add($l) } }
}

if ($MaxLines -gt 0 -and $lines.Count -gt $MaxLines) {
  $keep = $MaxLines - 1
  $outLines = @($lines | Select-Object -First $keep) + "... (+$($lines.Count - $keep) lineas; .harness/state/status.json)"
} else { $outLines = @($lines) }
$outLines
