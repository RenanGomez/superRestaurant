<#
.SYNOPSIS
  Ejecuta la cola (.harness/queue/*.json) por olas: tareas pending con dependencias done y motor con cuota,
  hasta config.queue.maxParallel a la vez, sin dos escritores sobre los mismos archivos.
  Si al final quedan tareas esperando cuota, programa UNA tarea de Windows que vuelve a correr drain al reset.
  Con -Wait no termina: espera él mismo al reset y sigue, y solo sale cuando ya no queda nada que esperar.
  Así, lanzado en background desde una conversación, su salida DESPIERTA a esa misma conversación al acabar
  (la tarea de Windows queda solo como respaldo por si la app se cierra).
  Vigila el heartbeat de cada run (lento/trabado), escribe .harness/state/status.json y, ante fallo,
  .harness/state/ALERT; con -Wait termina tras la ola en curso para despertar al orquestador.
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
$runsDir  = Join-Path $harness 'runs'
$statusFile = Join-Path $stateDir 'status.json'
$alertFile  = Join-Path $stateDir 'ALERT'
$slowFactor = if ($cfg.eta -and $cfg.eta.slowFactor)    { [double]$cfg.eta.slowFactor }    else { 1.5 }
$killFactor = if ($cfg.eta -and $cfg.eta.killFactor)    { [double]$cfg.eta.killFactor }    else { 3 }
$idleLimit  = if ($cfg.eta -and $cfg.eta.drainIdleMin)  { [double]$cfg.eta.drainIdleMin }  else { 15 }
$drainPid   = $PID
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
$drainStart = Get-Date -Format s   # cleanup.ps1 -Since: restos de motores lanzados desde aquí

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
# config.codex.fallback.engine (p. ej. claude) es el último carril de una tarea de codex: se usa si no hay cuota de codex
$fallback = if ($cfg.codex.fallback -and $cfg.codex.fallback.engine) { $cfg.codex.fallback.engine } else { '' }
$dshOff = $cfg.dsh.enabled -eq $false     # dsh apagado: sin carril dsh; sus tareas van a codex (agent.ps1 las desvía)
if ($dshOff -and $fallback -eq 'dsh') { $fallback = '' }
function Keys($t) {
  if ($t.engine -ne 'codex' -and -not ($t.engine -eq 'dsh' -and $dshOff)) { return @($t.engine) }
  # tipado: con un solo elemento, += concatenaría texto
  [string[]]$k = if (-not $accounts) { @('codex') } elseif ($t.account) { @("codex-$($t.account)") } else { @($accounts | ForEach-Object { "codex-$_" }) }
  if ($fallback) { $k += $fallback }
  return $k
}
function FreeKeys($t) { @(Keys $t | Where-Object { -not (CoolUntil $_) }) }
function Overlap($a, $b) {   # prefijos de ruta en común = mismos archivos
  foreach ($x in $a) { foreach ($y in $b) {
    $x2 = ($x -replace '\\','/').TrimEnd('/').ToLower(); $y2 = ($y -replace '\\','/').TrimEnd('/').ToLower()
    if ($x2 -eq $y2 -or $x2.StartsWith("$y2/") -or $y2.StartsWith("$x2/")) { return $true } } }
  return $false
}
function EtaOf($t) {
  if ($t.PSObject.Properties['eta_min'] -and [double]$t.eta_min -gt 0) { return [double]$t.eta_min }
  if ($cfg.eta -and $cfg.eta.defaults) {
    $d = $cfg.eta.defaults.PSObject.Properties[$t.engine]
    if ($d -and [double]$d.Value -gt 0) { return [double]$d.Value }
  }
  return 15.0
}
function ReadBeat($t) {
  $f = Join-Path $runsDir "$($t.id)\heartbeat.json"
  if (-not (Test-Path $f)) { return $null }
  # heartbeat de un intento anterior: no vale para vigilar este run
  if ($t.started_at -and (Get-Item $f).LastWriteTime -lt [datetime]$t.started_at) { return $null }
  try {
    $b = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($b.id -and "$($b.id)" -ne "$($t.id)") { return $null }
    return $b
  } catch { $null }
}
function Alert($id, $why) {
  [IO.File]::AppendAllText($alertFile, "$(Get-Date -Format 'yyyy-MM-dd HH:mm') $id — $why`n", $utf8)
}
function SetBlocked($t, $why) {
  $rp  = if ($cfg.paths -and $cfg.paths.result) { $cfg.paths.result } else { '.harness/runs/{id}/result.md' }
  $res = Join-Path $root ($rp -replace '\{id\}', $t.id)
  New-Item -ItemType Directory -Force (Split-Path $res) | Out-Null
  $old = if (Test-Path $res) { Get-Content $res -Raw -Encoding UTF8 } else { '' }
  [IO.File]::WriteAllText($res, "blocked — watchdog drain: $why`n`n$old", $utf8)
}
function SaveStatus {
  $now = Get-Date
  $tasks = foreach ($t in @(Load)) {
    $beat = ReadBeat $t
    $eta  = EtaOf $t
    $started = $t.PSObject.Properties['started_at'] -and $t.started_at
    $el = if ($t.status -ne 'pending' -and $started) { [math]::Round(($now - [datetime]$t.started_at).TotalMinutes, 1) } else { 0 }
    $idle = if ($beat -and $null -ne $beat.idle_min) { [math]::Round([double]$beat.idle_min, 1) } else { 0 }
    $out  = if ($beat -and $beat.last_output) { "$($beat.last_output)" } else { '' }
    $health = 'ok'
    if ($t.status -eq 'done') { $health = 'done' }
    elseif ($t.status -eq 'unverified') { $health = 'failed' }
    elseif ($t.status -eq 'failed') { $health = if ("$($t.outcome)" -match 'watchdog') { 'trabado' } else { 'failed' } }
    elseif ($t.status -eq 'running') {
      if ($t.pid -and -not (Get-Process -Id $t.pid -ErrorAction SilentlyContinue)) { $health = 'muerto' }
      elseif ($idle -gt $idleLimit -or $el -gt ($eta * $killFactor + 5)) { $health = 'trabado' }
      elseif ($el -gt $eta * $slowFactor) { $health = 'lento' }
    }
    [ordered]@{ id = $t.id; engine = $t.engine; status = $t.status; health = $health
                elapsed_min = $el; eta_min = $eta; idle_min = $idle; last_output = $out }
  }
  $obj = [ordered]@{ updated = $now.ToString('s'); drain_pid = $drainPid; tasks = @($tasks) }
  $tmp = "$statusFile.tmp"
  [IO.File]::WriteAllText($tmp, ($obj | ConvertTo-Json -Depth 5), $utf8)
  try { Move-Item -Force $tmp $statusFile } catch { Start-Sleep -Milliseconds 200; Move-Item -Force $tmp $statusFile }
}

$log = New-Object System.Collections.Generic.List[string]
$deadline = (Get-Date).AddHours($MaxWaitHours)

# ALERTA de un drain anterior ya leída por el orquestador (el resumen queda en drain.md):
# si queda algo que revisar, esta corrida nueva lo vuelve a detectar y escribe su propia ALERTA.
Remove-Item $alertFile -ErrorAction SilentlyContinue
# huérfanas de un drain caído: running cuyo proceso ya no existe → pending (respetando el lock de arriba)
foreach ($t in @(Load | Where-Object { $_.status -eq 'running' })) {
  if ($t.pid -and (Get-Process -Id $t.pid -ErrorAction SilentlyContinue)) { continue }
  $why = if ($t.pid) { "pid $($t.pid) ya no existe" } else { 'sin pid registrado' }
  $t.status = 'pending'; $t.outcome = "huérfana de drain caído ($why); relanzada"
  Save $t
  $log.Add("- $($t.id): huérfana ($why) → pending")
}
SaveStatus

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
      # el respaldo solo entra si no queda cuota de codex (salvo fallback.parallel: también como carril extra)
      if ($fallback -and -not $cfg.codex.fallback.parallel) { $cx = @($free | Where-Object { $_ -ne $fallback }); if ($cx) { $free = $cx } }
      $key = @($free | Where-Object { $used -notcontains $_ }) + $free | Select-Object -First 1
      # Antigravity: como mucho gemini.maxParallel a la vez (las ráfagas agotan el límite semanal)
      $gMax = if ($cfg.gemini.maxParallel) { [int]$cfg.gemini.maxParallel } else { 2 }
      if ($key -like 'gemini*' -and @($used | Where-Object { $_ -like 'gemini*' }).Count -ge $gMax) { continue }
      $used += $key
      $t | Add-Member runAccount $(if ($key -like 'codex-*') { $key.Substring(6) } else { '' }) -Force
      $t | Add-Member runLane $(if ($key -eq $fallback -and $t.engine -eq 'codex') { "codex→$fallback" } else { $key }) -Force
      $wave += $t
    }
    if (-not $wave) { break }

    $procs = foreach ($t in $wave) {
      $a = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSScriptRoot\agent.ps1`"",'-NoSchedule',
             '-Engine',$t.engine,'-Id',"`"$($t.id)`"",'-Model',"`"$($t.model)`"",
             '-EtaMin',(EtaOf $t).ToString([Globalization.CultureInfo]::InvariantCulture))
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
      $t.status = 'running'; $t.attempts++
      $t | Add-Member started_at (Get-Date).ToString('s') -Force
      Save $t
      $p = Start-Process powershell.exe -ArgumentList ($a -join ' ') -WorkingDirectory $root -WindowStyle Hidden -PassThru
      $t | Add-Member pid $p.Id -Force; Save $t
      @{ t = $t; p = $p; slowNoted = $false; killed = $false }
    }
    # espera con vigilante: cada 30 s revisa proceso y heartbeat de TODA la ola (no uno tras otro)
    $active = [System.Collections.ArrayList]@($procs)
    $halt = $false
    while ($active.Count -gt 0) {
      $reaped = @()
      foreach ($x in @($active)) {
        $t = $x.t
        $alive = Get-Process -Id $x.p.Id -ErrorAction SilentlyContinue
        if ($x.p.HasExited -or -not $alive) {          # terminó (o su pid desapareció): no dejarlo running
          try { $null = $x.p.WaitForExit(5000) } catch { }
          $reaped += $x; continue
        }
        $beat = ReadBeat $t
        $eta  = EtaOf $t
        $el   = if ($t.started_at) { ((Get-Date) - [datetime]$t.started_at).TotalMinutes } else { 0 }
        $idle = if ($beat -and $null -ne $beat.idle_min) { [double]$beat.idle_min } else { 0 }
        if ($idle -gt $idleLimit -or $el -gt ($eta * $killFactor + 5)) {
          $why = if ($idle -gt $idleLimit) { "heartbeat inactivo $([math]::Round($idle,0)) min (> $idleLimit)" }
                 else { "elapsed $([math]::Round($el,0)) min > eta $eta x $killFactor + 5" }
          & taskkill.exe /PID $x.p.Id /T /F *> $null
          SetBlocked $t $why
          $t.status = 'failed'; $t.outcome = "blocked — watchdog drain: $why"; Save $t
          Alert $t.id "watchdog: $why"
          $log.Add("- $($t.id) trabado → failed (watchdog: $why)")
          $x.killed = $true; $halt = $true; $reaped += $x
        }
        elseif ($el -gt $eta * $slowFactor -and -not $x.slowNoted) {
          $x.slowNoted = $true
          [IO.File]::AppendAllText((Join-Path $stateDir 'drain.md'), "- $(Get-Date -Format 'HH:mm') $($t.id): lento — elapsed $([math]::Round($el,0)) min > eta $eta x $slowFactor`n", $utf8)
        }
      }
      foreach ($x in $reaped) {
        $null = $active.Remove($x)
        if ($x.killed) { continue }
        $t = $x.t; $code = -1; try { $code = $x.p.ExitCode } catch { }
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
        $lane = $t.runLane
        $t.PSObject.Properties.Remove('runAccount'); $t.PSObject.Properties.Remove('runLane')
        $t.outcome = "$line".Trim(); Save $t
        $log.Add("- $($t.id) [$lane] → $($t.status) (exit $code): $($t.outcome)")
        if ($t.status -eq 'failed' -or $t.status -eq 'unverified') {
          Alert $t.id "$($t.status): $($t.outcome)"
          $halt = $true
        }
      }
      SaveStatus
      if ($active.Count -gt 0) { Start-Sleep 30; (Get-Item $lock).LastWriteTime = Get-Date }   # latido del lock
    }
    # fallo/trabado/unverified: no esperar resets ni lanzar más olas; el orquestador debe enterarse
    if ($halt) { break }
  }

  if ($halt) {
    $all = @(Load)
    $todo = @($all | Where-Object { $_.status -eq 'pending' } | ForEach-Object { $_.id })
    $sum = "# drain $(Get-Date -Format 'yyyy-MM-dd HH:mm')`n" + ($log -join "`n") + "`n`n" +
      "ALERTA: hay tareas failed/trabado o unverified; drain se detiene para que el orquestador revise (.harness/state/ALERT).`n" +
      "Cola: " + (($all | Group-Object status | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' ') + "`n" +
      "Quedan pending: " + ($(if ($todo) { $todo -join ', ' } else { 'ninguna' })) + "`n"
    [IO.File]::AppendAllText((Join-Path $stateDir 'drain.md'), "$sum`n`n", $utf8)
    Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    $sum
    break
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
    while ((Get-Date) -lt $at) { Start-Sleep 60; (Get-Item $lock).LastWriteTime = Get-Date; SaveStatus }
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
} finally {
  Remove-Item $lock -ErrorAction SilentlyContinue
  $drainPid = $null; try { SaveStatus } catch { }    # última foto: sin drain activo
  # cerrar lo que los motores dejaron corriendo (servidores, watchers, Godot...); ver ORCHESTRATOR.md "Limpieza"
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\cleanup.ps1" -Since $drainStart | Where-Object { $_ -ne 'nada abierto' }
}
