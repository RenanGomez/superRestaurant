# Vigilante de la cola del arnés: estimación previa, avance real y alertas.
#   queue-watch.ps1            -> estado una vez
#   queue-watch.ps1 -Loop 2    -> repite cada 2 min hasta que no quede running/pending
# Alertas: STALL (sin latido > stallMin), LENTA (> 1.5x estimado), SIN-DRAIN (hay pending/running y no hay drain.ps1),
# HUERFANA (pending cuyas dependencias fallaron y nadie las desbloqueará).
param([double]$Loop = 0, [double]$StallMin = 8, [switch]$ExitOnAlert)
$root = (git rev-parse --show-toplevel) 2>$null; if (-not $root) { $root = (Get-Location).Path }
$q = Join-Path $root '.harness/queue'; $runs = Join-Path $root '.harness/runs'

function Get-Span($id) {  # minutos entre prompt/yml y la última escritura de log, de un run terminado
  $d = Join-Path $runs $id; $a = Get-Item (Join-Path $d 'prompt.md') -ea 0; $b = Get-Item (Join-Path $d 'log.txt') -ea 0
  if ($a -and $b -and $b.LastWriteTime -gt $a.LastWriteTime) { return ($b.LastWriteTime - $a.LastWriteTime).TotalMinutes }
}
function Get-Estimate($t) {
  $h = foreach ($f in Get-ChildItem $q -Filter *.json) {
    $o = Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json
    if ($o.status -in 'done','unverified' -and $o.effort -eq $t.effort -and $o.engine -eq $t.engine) { Get-Span $o.id }
  }
  $h = @($h | Where-Object { $_ -gt 0.5 } | Sort-Object)
  if ($h.Count -ge 3) { return [math]::Round($h[[int]($h.Count / 2)], 0) }
  return $null
}

do {
  $script:alert = $false
  $all = Get-ChildItem $q -Filter *.json | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json }
  $drain = @(Get-CimInstance Win32_Process -ea 0 | Where-Object { $_.CommandLine -match 'drain\.ps1' }).Count -gt 0
  $act = @($all | Where-Object { $_.status -in 'running','pending' })
  Write-Host ("[{0}] running={1} pending={2} drain={3}" -f (Get-Date -f HH:mm:ss), @($all|?{$_.status -eq 'running'}).Count, @($all|?{$_.status -eq 'pending'}).Count, $drain)
  if ($act.Count -and -not $drain) { Write-Host "ALERTA SIN-DRAIN: hay trabajo en cola y ningún drain.ps1 vivo -> relanzar: .harness/bin/drain.ps1 -Wait" -ForegroundColor Red; $script:alert = $true }
  foreach ($t in $act) {
    $est = Get-Estimate $t; $estTxt = if ($est) { "~$est min" } else { 'sin historial' }
    if ($t.status -eq 'running') {
      $live = Get-Item (Join-Path $runs "$($t.id)/live.log") -ea 0
      $first = if ($live) { (Get-Content $live -Encoding UTF8 | Where-Object { $_ -match 'intento' } | Select-Object -Last 1) -replace '^\W*\[(\d\d:\d\d:\d\d)\].*', '$1' }
      $idle = if ($live) { ((Get-Date) - $live.LastWriteTime).TotalMinutes } else { 999 }
      $el = $null; if ($first -match '^\d\d:\d\d:\d\d$') { $el = ((Get-Date) - [datetime]::Parse($first)).TotalMinutes; if ($el -lt 0) { $el += 1440 } }
      $flag = ''
      if ($idle -gt $StallMin) { $flag = 'STALL' } elseif ($est -and $el -gt 1.5 * $est) { $flag = 'LENTA' }
      $wt = Get-ChildItem "$HOME/harness-wt/*/$($t.id)" -ea 0 | Select-Object -First 1
      $chg = if ($wt) { @(git -C $wt.FullName status --short 2>$null).Count } else { 0 }
      $line = "  RUN {0,-38} {1:N1} min (est {2}) inactivo {3:N1} min, archivos tocados {4} {5}" -f $t.id, $el, $estTxt, $idle, $chg, $flag
      if ($flag -eq 'STALL') { $script:alert = $true }
      Write-Host $line -ForegroundColor $(if ($flag) { 'Yellow' } else { 'Green' })
    } else {
      $deps = @($t.after) | Where-Object { $_ }
      $bad = @($deps | Where-Object { $d = $_; $all | Where-Object { $_.id -eq $d -and $_.status -in 'failed','cancelled' } })
      $flag = if ($bad) { "HUERFANA (falló: $($bad -join ','))" } else { '' }
      Write-Host ("  PEND {0,-38} est {1} espera: {2} {3}" -f $t.id, $estTxt, ($deps -join ','), $flag) -ForegroundColor $(if ($flag) { 'Red' } else { 'Gray' })
    }
  }
  if ($ExitOnAlert -and $script:alert) { exit 2 }
  if ($Loop -gt 0 -and $act.Count) { Start-Sleep -Seconds ([int]($Loop * 60)) }
} while ($Loop -gt 0 -and $act.Count)
