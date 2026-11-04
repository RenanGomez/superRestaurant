<#
.SYNOPSIS
  Ejecuta la cola (.harness/queue/*.json) por olas: tareas pending con dependencias done y motor con cuota,
  hasta config.queue.maxParallel a la vez, sin dos escritores sobre los mismos archivos.
  Si al final quedan tareas esperando cuota, programa UNA tarea de Windows que vuelve a correr drain al reset.
  Con -Wait no termina: espera él mismo al reset y sigue, y solo sale cuando ya no queda nada que esperar.
  Así, lanzado en background desde una conversación, su salida DESPIERTA a esa misma conversación al acabar
  (la tarea de Windows queda solo como respaldo por si la app se cierra).
  Resumen en .harness/state/drain.md.
.EXAMPLE
  powershell -NoProfile -File .harness/bin/drain.ps1 -Wait     # desde la conversación, en background
#>
param([switch]$Resumed, [switch]$Wait, [double]$MaxWaitHours = 12)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$harness = Split-Path $PSScriptRoot -Parent
$root    = Split-Path $harness -Parent
$cfg     = Get-Content (Join-Path $harness 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$maxPar  = if ($cfg.queue -and $cfg.queue.maxParallel) { [int]$cfg.queue.maxParallel } else { 2 }
$qDir    = Join-Path $harness 'queue'
$stateDir = Join-Path $harness 'state'; New-Item -ItemType Directory -Force $stateDir, $qDir | Out-Null
$taskPath = '\agent-harness\'
$taskName = "$(Split-Path $root -Leaf)-drain" -replace '[^\w.-]', '_'
if ($Resumed) { Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue }

# un solo drain por proyecto: el lock guarda el PID; si ese proceso ya no existe, el lock está abandonado
$lock = Join-Path $stateDir 'drain.lock'
if (Test-Path $lock) {
  $owner = (Get-Content $lock -Raw) -as [int]
  if ($owner -and $owner -ne $PID -and (Get-Process -Id $owner -ErrorAction SilentlyContinue)) {
    "drain ya en marcha (PID $owner); sus resultados llegarán a quien lo lanzó. Resumen: .harness/state/drain.md"; exit 0
  }
}
[IO.File]::WriteAllText($lock, "$PID", $utf8)

function Load { Get-ChildItem $qDir -Filter *.json | ForEach-Object { Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } }
function Save($t) { [IO.File]::WriteAllText((Join-Path $qDir "$($t.id).json"), ($t | ConvertTo-Json -Depth 4), $utf8) }
function Quota { $f = Join-Path $stateDir 'quota.json'; if (Test-Path $f) { Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} } }
function CoolUntil($engine) {
  $q = (Quota).$engine
  if ($q -and $q.status -eq 'cooldown' -and [datetime]$q.reset_at -gt (Get-Date)) { [datetime]$q.reset_at } else { $null }
}
# codex con varias cuentas: cada una es un "carril" con su propia cuota (quota.json: codex-A, codex-B…)
$accounts = if ($cfg.codex.accounts -and @($cfg.codex.accounts.PSObject.Properties).Count) { @($cfg.codex.accounts.PSObject.Properties.Name) }
            elseif ($cfg.codex.homes) { $i = 0; @($cfg.codex.homes | Where-Object { $_ } | ForEach-Object { "H$((++$i))" }) }   # formato anterior
            else { @() }
function Keys($t) {
  if ($t.engine -ne 'codex' -or -not $accounts) { return @($t.engine) }
  if ($t.account) { return @("codex-$($t.account)") }
  return @($accounts | ForEach-Object { "codex-$_" })
}
function FreeKeys($t) { @(Keys $t | Where-Object { -not (CoolUntil $_) }) }
function Overlap($a, $b) {   # prefijos de ruta en común = mismos archivos
  foreach ($x in $a) { foreach ($y in $b) {
    $x2 = ($x -replace '\\','/').TrimEnd('/').ToLower(); $y2 = ($y -replace '\\','/').TrimEnd('/').ToLower()
    if ($x2 -eq $y2 -or $x2.StartsWith("$y2/") -or $y2.StartsWith("$x2/")) { return $true } } }
  return $false
}

$log = New-Object System.Collections.Generic.List[string]
$deadline = (Get-Date).AddHours($MaxWaitHours)
try {
 while ($true) {      # una ronda por cada reset de cuota que se espera (-Wait); sin -Wait, una sola
  while ($true) {
    $all  = @(Load)
    $done = @($all | Where-Object { $_.status -eq 'done' } | ForEach-Object { $_.id })
    $ready = @($all | Where-Object { $_.status -eq 'pending' -and (FreeKeys $_).Count -and
                 -not (@($_.after) | Where-Object { $_ -and $done -notcontains $_ }) } | Sort-Object priority, added)
    # ola: hasta maxPar, escritores sin solapar (un escritor sin -Files bloquea a todos los demás escritores)
    $wave = @(); $used = @()
    foreach ($t in $ready) {
      if ($wave.Count -ge $maxPar) { break }
      $clash = $t.write -and ($wave | Where-Object { $_.write -and (-not $t.files.Count -or -not $_.files.Count -or (Overlap $t.files $_.files)) })
      if ($clash) { continue }
      # cuenta de codex: una libre que no use ya otra tarea de esta ola (así A y B trabajan en paralelo)
      $free = FreeKeys $t
      $key = @($free | Where-Object { $used -notcontains $_ }) + $free | Select-Object -First 1
      $used += $key
      $t | Add-Member runAccount $(if ($key -like 'codex-*') { $key.Substring(6) } else { '' }) -Force
      $wave += $t
    }
    if (-not $wave) { break }

    $procs = foreach ($t in $wave) {
      $a = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSScriptRoot\agent.ps1`"",'-NoSchedule',
             '-Engine',$t.engine,'-Id',"`"$($t.id)`"",'-Model',"`"$($t.model)`"")
      if ($t.effort)   { $a += @('-Effort',$t.effort) }
      if ($t.runAccount) { $a += @('-Account',$t.runAccount) }
      if ($t.write)    { $a += '-Write' }
      if ($t.worktree) {
        # un worktree parte del último commit: con cambios sin commitear en sus rutas trabajaría sobre código viejo
        [string[]]$paths = if (@($t.files).Count) { @($t.files) } else { @('.', ':(exclude).harness', ':(exclude).agents') }
        $dirty = @(git -C $root status --porcelain -- @paths 2>$null)
        if ($dirty) { $log.Add("- $($t.id): sin worktree ($($dirty.Count) cambios sin commitear en sus rutas); escribe en la carpeta") }
        else { $a += '-Worktree' }
      }
      $t.status = 'running'; $t.attempts++; Save $t
      @{ t = $t; p = (Start-Process powershell.exe -ArgumentList ($a -join ' ') -WorkingDirectory $root -WindowStyle Hidden -PassThru) }
    }
    foreach ($x in $procs) {
      while (-not $x.p.WaitForExit(60000)) { (Get-Item $lock).LastWriteTime = Get-Date }   # latido del lock
      $t = $x.t; $code = $x.p.ExitCode
      $rp  = if ($cfg.paths -and $cfg.paths.result) { $cfg.paths.result } else { '.harness/runs/{id}/result.md' }
      $res = Join-Path $root ($rp -replace '\{id\}', $t.id)
      $line = if (Test-Path $res) { (Get-Content $res -Encoding UTF8 | Where-Object { $_ -and $_ -notmatch '^#' } | Select-Object -First 1) } else { '' }
      if ($code -eq 75) { $t.status = 'pending'; $t.attempts-- }        # cuota: vuelve a la cola, no cuenta intento
      elseif ($code -eq 0 -and $line -notmatch '^\s*blocked') {
        # sin bloque de evidencia o con NO VERIFICADO → el orquestador debe comprobarlo antes de darlo por hecho
        $body = if (Test-Path $res) { Get-Content $res -Raw -Encoding UTF8 } else { '' }
        $t.status = if ($body -match '```' -and $body -notmatch 'NO VERIFICADO') { 'done' } else { 'unverified' }
      }
      else { $t.status = 'failed' }
      $lane = "$($t.engine)$(if ($t.runAccount) { "-$($t.runAccount)" })"
      $t.PSObject.Properties.Remove('runAccount')
      $t.outcome = "$line".Trim(); Save $t
      $log.Add("- $($t.id) [$lane] → $($t.status) (exit $code): $($t.outcome)")
    }
  }

  # lo que queda esperando cuota → un único relanzamiento al primer reset
  $waiting = @(Load | Where-Object { $_.status -eq 'pending' })
  # cada tarea esperando por cuota vuelve cuando se libere la primera de sus cuentas/motor
  $resets  = @($waiting | Where-Object { -not (FreeKeys $_).Count } | ForEach-Object {
               Keys $_ | ForEach-Object { CoolUntil $_ } | Where-Object { $_ } | Sort-Object | Select-Object -First 1 } | Sort-Object)
  $next = ''
  if ($resets) {
    $at = $resets[0].AddMinutes(2)
    $act = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $root `
      -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Resumed"
    $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $act -Settings $set `
      -Trigger (New-ScheduledTaskTrigger -Once -At $at) -Force | Out-Null
    $next = "Relanzamiento de drain programado $($at.ToString('yyyy-MM-dd HH:mm')) ($taskPath$taskName)."
  } else { Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue }
  $all = @(Load)
  $sum = "# drain $(Get-Date -Format 'yyyy-MM-dd HH:mm')`n" + ($log -join "`n") + "`n`n" +
    "Cola: " + (($all | Group-Object status | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' ') + "`n" +
    ($(if ($waiting) { "Esperando: " + (($waiting | ForEach-Object { "$($_.id)[$($_.engine)]" }) -join ', ') + "`n" } else { '' })) + $next
  [IO.File]::AppendAllText((Join-Path $stateDir 'drain.md'), "$sum`n`n", $utf8)

  # -Wait: dormir hasta el reset (con latido en el lock) y hacer otra ronda; la tarea de Windows es el respaldo
  if ($Wait -and $resets -and $at -lt $deadline) {
    "[$(Get-Date -Format 'HH:mm')] esperando cuota hasta $($at.ToString('yyyy-MM-dd HH:mm'))…"
    while ((Get-Date) -lt $at) { Start-Sleep 60; (Get-Item $lock).LastWriteTime = Get-Date }
    $log.Add("- (reanudado tras esperar cuota hasta $($at.ToString('HH:mm')))")
    continue
  }
  if ($Wait -and $resets) { $sum += "`nDejo de esperar: el próximo reset supera -MaxWaitHours ($MaxWaitHours h); queda la tarea programada." }
  # lanzado por la tarea de Windows (nadie lo espera): avisar al usuario para que retome la conversación
  if ($Resumed -and $log.Count) {
    try {
      $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
      $x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
      $txt = $x.GetElementsByTagName('text')
      $null = $txt.Item(0).AppendChild($x.CreateTextNode("agent-harness: $(Split-Path $root -Leaf)"))
      $null = $txt.Item(1).AppendChild($x.CreateTextNode("Volvió la cuota y la cola avanzó: " + (($all | Group-Object status | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' ') + ". Retoma la conversación para revisar."))
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))
    } catch { }
  }
  $sum
  break
 }
} finally { Remove-Item $lock -ErrorAction SilentlyContinue }
