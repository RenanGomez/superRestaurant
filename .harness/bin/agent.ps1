<#
.SYNOPSIS
  Lanza un subagente (codex | gemini | dsh | claude) con el brief de .harness/runs/<Id>/brief.md.
  Deja result.md (informe corto) y log.txt (salida completa) en la misma carpeta.
.EXAMPLE
  powershell -NoProfile -File .harness/bin/agent.ps1 -Engine gemini -Id map-auth -Model strong
  powershell -NoProfile -File .harness/bin/agent.ps1 -Engine codex -Id fix-login -Model default -Effort medium -Write
#>
param(
  [Parameter(Mandatory)][ValidateSet('codex','gemini','dsh','claude')][string]$Engine,
  [Parameter(Mandatory)][string]$Id,
  [string]$Model = 'default',            # alias fast|default|strong o nombre literal
  [ValidateSet('','minimal','low','medium','high','xhigh')][string]$Effort = '',  # codex y dsh
  [switch]$Write,                        # permite editar archivos
  [switch]$Worktree,                     # git worktree aparte (codex: --worktree; gemini: .harness/worktrees/<Id>)
  [int]$TimeoutMin = 30,                 # espera máxima del result (respaldo gemini/agentapi)
  [double]$EtaMin = 0,                   # estimación (min) de la tarea; 0 = config.eta.defaults.<motor> o 15
  [switch]$Resumed,                      # lo pasa la tarea programada al relanzar tras un cooldown
  [switch]$NoSchedule,                   # lo pasa drain.ps1: la cola se encarga de reanudar
  [string]$Account = ''                  # codex: cuenta de config.codex.accounts (A, B…); vacío = la primera con cuota
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = $utf8
[Console]::OutputEncoding = $utf8

$harness = Split-Path $PSScriptRoot -Parent
$root    = Split-Path $harness -Parent
$cfg = Get-Content (Join-Path $harness 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
# rutas configurables (config.paths) para proyectos con su propia convención de briefs/reportes
function PathFor($key, $default) {
  $p = if ($cfg.paths -and $cfg.paths.$key) { $cfg.paths.$key } else { $default }
  Join-Path $root (($p -replace '\{id\}', $Id) -replace '/', '\')
}
$brief  = PathFor 'brief'  '.harness/runs/{id}/brief.md'
$result = PathFor 'result' '.harness/runs/{id}/result.md'
$log    = PathFor 'log'    '.harness/runs/{id}/log.txt'
$runDir = Split-Path $log -Parent
$isRetry = Test-Path $log   # ya hubo un intento con este -Id: es un reintento
foreach ($d in @($runDir, (Split-Path $result -Parent))) { New-Item -ItemType Directory -Force $d | Out-Null }
if (-not (Test-Path $brief)) { throw "No existe $brief" }

# --- latido: runs/<id>/heartbeat.json (UTF-8 sin BOM, atómico). drain/status lo leen para detectar atascos ---
$hbFile  = Join-Path $runDir 'heartbeat.json'
$hbStart = Get-Date
$script:hbPid = $PID                  # pid vigilado (Invoke-Watched lo cambia al hijo)
function Write-Heartbeat {
  param([string]$Phase = 'running', [double]$IdleMin = 0, [string]$LastOutput = '', [string]$Why = '')
  $txt = if ($LastOutput) { $LastOutput.Substring(0, [Math]::Min(140, $LastOutput.Length)) } else { '' }
  $hb = [ordered]@{
    id          = $Id
    engine      = $Engine
    pid         = [int]$script:hbPid
    started     = $hbStart.ToString('s')
    eta_min     = $(if ($EtaMin) { [double]$EtaMin } else { 15 })
    elapsed_min = [Math]::Round(((Get-Date) - $hbStart).TotalMinutes, 1)
    idle_min    = [Math]::Round($IdleMin, 1)
    last_output = $txt
    phase       = $Phase
    why         = $Why
  }
  $tmp = "$hbFile.tmp"
  try {
    [IO.File]::WriteAllText($tmp, ($hb | ConvertTo-Json -Depth 3), $utf8)
    Move-Item -Force $tmp $hbFile
  } catch { }
}
Write-Heartbeat    # latido inicial: borra el de un intento anterior y anuncia 'running'

# --- cuota: .harness/state/quota.json = { <motor>: { status, reset_at, msg } } ---
$stateDir  = Join-Path $harness 'state'; New-Item -ItemType Directory -Force $stateDir | Out-Null
$quotaFile = Join-Path $stateDir 'quota.json'
$quota = if (Test-Path $quotaFile) { Get-Content $quotaFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
$taskPath = '\agent-harness\'
$taskName = "$(Split-Path $root -Leaf)-$Id" -replace '[^\w.-]', '_'
$launch = $PSBoundParameters
function Save-Quota { [IO.File]::WriteAllText($quotaFile, ($quota | ConvertTo-Json -Depth 5), $utf8) }
# Programa el relanzamiento de este mismo run (mismos parámetros) para cuando vuelva la cuota.
function Schedule-Resume([datetime]$at) {
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Resumed')
  foreach ($k in $launch.Keys) {
    $v = $launch[$k]
    if ($v -is [switch]) { if ($v -and $k -ne 'Resumed') { $a += "-$k" } } else { $a += @("-$k", "`"$v`"") }
  }
  $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($a -join ' ') -WorkingDirectory $root
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $act -Settings $set `
    -Trigger (New-ScheduledTaskTrigger -Once -At $at) -Force | Out-Null
}
function Exit-Queued([datetime]$at, [string]$why) {
  Write-Heartbeat -Phase 'killed' -Why "queued: $why"
  $how = if ($NoSchedule) { 'Vuelve a la cola de drain' } else { Schedule-Resume $at; "Relanzamiento programado (tarea $taskPath$taskName)" }
  [IO.File]::WriteAllText($result, "## Estado`nqueued — $why. $how; cuota desde $($at.ToString('yyyy-MM-dd HH:mm')).", $utf8)
  "[$Engine queued hasta $($at.ToString('yyyy-MM-dd HH:mm'))] $result"
  exit 75
}
if ($Resumed) { Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue }
function CoolUntil($key) {
  $c = $quota.$key
  if ($c -and $c.status -eq 'cooldown' -and [datetime]$c.reset_at -gt (Get-Date)) { [datetime]$c.reset_at } else { $null }
}

# codex con varias cuentas (config.codex.accounts = { "A": ".codex-a", ... } relativo a $HOME): cada una con su
# CODEX_HOME (codex login una vez en cada una) y su propio cooldown en quota.json ("codex-A", "codex-B")
# compatibilidad: config.codex.homes (lista de rutas, formato anterior) → cuentas H1, H2…
$hasAccounts = $cfg.codex.accounts -and @($cfg.codex.accounts.PSObject.Properties).Count   # ojo: $null.PSObject cuenta 1
if ($cfg.codex.homes -and -not $hasAccounts) {
  $acc = [ordered]@{}; $i = 0
  foreach ($h in @($cfg.codex.homes | Where-Object { $_ })) { $acc["H$((++$i))"] = [Environment]::ExpandEnvironmentVariables($h) }
  $cfg.codex | Add-Member accounts ([pscustomobject]$acc) -Force
}
# respaldo de codex (config.codex.fallback = { engine: "claude", models: { fast: "haiku", ... } }): si codex no
# tiene cuota, la tarea la hace Claude en vez de esperar al reset. Devuelve $false si no hay respaldo disponible.
$fallbackWhy = ''
function Switch-ToFallback($why) {
  $fb = $cfg.codex.fallback
  if ($Engine -ne 'codex' -or -not $fb -or -not $fb.engine -or (CoolUntil $fb.engine)) { return $false }
  if ($fb.engine -eq 'dsh' -and $cfg.dsh.enabled -eq $false) { return $false }
  $script:Model = if ($fb.models -and $fb.models.$Model) { $fb.models.$Model } else { $Model }
  $script:Engine = $fb.engine; $script:Account = ''; $script:fallbackWhy = $why
  return $true
}

# dsh apagado (config.dsh.enabled = false, p. ej. sin saldo en OpenRouter): sus tareas las hace codex
if ($Engine -eq 'dsh' -and $cfg.dsh.enabled -eq $false) {
  $Engine = 'codex'; $Model = if ($Model -in 'strong','max') { 'strong' } else { 'default' }
  "[dsh desactivado → codex/$Model]"
}
$accounts = if ($Engine -eq 'codex' -and $cfg.codex.accounts) { @($cfg.codex.accounts.PSObject.Properties.Name) } else { @() }
if ($accounts) {
  if ($Account -and $accounts -notcontains $Account) { throw "Cuenta '$Account' no está en config.codex.accounts ($($accounts -join ', '))" }
  if (-not $Account) {                 # la primera libre; si todas están agotadas: respaldo o esperar a la que antes vuelva
    $Account = $accounts | Where-Object { -not (CoolUntil "codex-$_") } | Select-Object -First 1
    if ($Account) { $launch['Account'] = $Account }
    elseif (-not (Switch-ToFallback 'todas las cuentas de codex sin cuota')) {
      $soon = $accounts | Sort-Object { CoolUntil "codex-$_" } | Select-Object -First 1
      Exit-Queued (CoolUntil "codex-$soon").AddMinutes(2) "todas las cuentas de codex sin cuota"
    }
  }
  if ($Engine -eq 'codex') {
    $codexHome = [Environment]::ExpandEnvironmentVariables($cfg.codex.accounts.$Account)
    if (-not [IO.Path]::IsPathRooted($codexHome)) { $codexHome = Join-Path $HOME $codexHome }
    if (-not (Test-Path (Join-Path $codexHome 'auth.json'))) {
      throw "Cuenta $Account sin sesión: ejecuta  `$env:CODEX_HOME='$codexHome'; codex login  una vez."
    }
    $env:CODEX_HOME = $codexHome
  }
}
$qkey = if ($Account) { "codex-$Account" } else { $Engine }
$q = $quota.$qkey
if ((CoolUntil $qkey) -and -not (Switch-ToFallback "$qkey sin cuota")) {
  Exit-Queued (CoolUntil $qkey).AddMinutes(2) "$qkey sin cuota hasta $($q.reset_at)"
}
if ($fallbackWhy) { $qkey = $Engine; $q = $quota.$qkey; "[codex → $Engine/${Model}: $fallbackWhy]" }
# estimación de la tarea (la usa el latido y los topes maxMin); el motor ya está decidido
if ($EtaMin -le 0) {
  $etaCfg = if ($cfg.eta -and $cfg.eta.defaults) { $cfg.eta.defaults.$Engine } else { $null }
  $EtaMin = if ($etaCfg) { [double]$etaCfg } else { 15 }
}

$m = $cfg.$Engine.models.$Model
# dsh con suscripción OpenCode Go: modelos y endpoint de config.dsh.opencodego
$goDsh = ($Engine -eq 'dsh' -and $cfg.dsh.provider -eq 'opencodego')
if ($goDsh) { $m = $cfg.dsh.opencodego.models.$Model }
if ($null -eq $m) { $m = $Model }      # nombre literal
# formato del informe: plantilla del harness, o el texto que diga config.resultFormat
$instr = if ($cfg.resultFormat) { "`n---`n$($cfg.resultFormat)`n" } else {
  (Get-Content (Join-Path $harness 'templates\result-instructions.md') -Raw -Encoding UTF8) -replace '\{MAX\}', $cfg.resultMaxLines }
# codex ya carga AGENTS.md por su cuenta; solo se recuerda a los demás motores
$rules = if ($Engine -eq 'codex') { "`n" } else { "`n`nLee y respeta AGENTS.md del proyecto.`n" }
# evidencia obligatoria (también con config.resultFormat): drain marca "unverified" un informe sin bloque ```
$evidence = @'

REGLA DE EVIDENCIA (obligatoria): todo dato o comprobación del informe sale de algo que ejecutaste o leíste en
esta tarea. En la verificación incluye un bloque ``` con el comando exacto y un extracto de su salida real
(no la parafrasees). Si no pudiste comprobar algo, escribe "NO VERIFICADO: <motivo>" y no des el dato.
Nunca respondas de memoria ni estimes. Leer archivos y ejecutar comandos de solo lectura está permitido
aunque el brief diga "no ejecutes nada más".
'@
$prompt = (Get-Content $brief -Raw -Encoding UTF8) + $rules + $instr + $evidence
# revisión (-Model review): el diff va en el prompt para que el revisor no explore el repo vuelta tras vuelta.
# Rango opcional en el brief con una línea "Diff: <rango git>" (p. ej. "Diff: main...harness/f4b"); si no, git diff HEAD.
if ($Model -eq 'review') {
  $briefTxt = Get-Content $brief -Raw -Encoding UTF8
  $range = if ($briefTxt -match '(?m)^\s*Diff:\s*(\S+)') { $Matches[1] } else { 'HEAD' }
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $diffTxt = (& git -C $root diff $range 2>&1 | Out-String)
  $ErrorActionPreference = $eap
  $maxDiff = if ($cfg.dsh.reviewDiffMaxKB) { [int]$cfg.dsh.reviewDiffMaxKB * 1KB } else { 60KB }
  if ($diffTxt.Trim() -and $diffTxt.Length -le $maxDiff) {
    $prompt += "`n## Diff a revisar (git diff $range)`n" + '```diff' + "`n$diffTxt`n" + '```' +
      "`nRevisa SOLO este diff. No explores el repositorio: abre otro archivo únicamente si el diff no basta para " +
      "juzgar un cambio concreto (y dilo en el informe).`n"
  } elseif ($diffTxt.Trim()) {
    $prompt += "`n(El diff de $range pasa de $([int]($maxDiff/1KB)) KB y no se incluyó: revisa primero ``git diff --stat $range`` y lee solo los hunks necesarios.)`n"
  }
}
# Godot 4 crashea al arrancar en el sandbox (no puede crear su log en %APPDATA%); el wrapper del proyecto lo evita
if (Test-Path (Join-Path $root 'tools\godot.cmd')) {
  $prompt += "`nPara correr Godot usa SIEMPRE tools\godot.cmd (mismos argumentos que el .exe; en Git Bash ./tools/godot.cmd), nunca el .exe directo: sin eso Godot crashea al arrancar en el sandbox.`n"
}
# el sandbox de codex en Windows no deja escribir en carpetas que empiezan por punto: .agents/ → agents_out/
$agentsOut = ($Engine -eq 'codex') -and $Write -and (Test-Path (Join-Path $root '.agents'))
if ($agentsOut) {
  $prompt += "`nIMPORTANTE (sandbox): no puedes escribir dentro de .agents/. Todo archivo que el brief te pida crear o editar bajo .agents/<ruta> escríbelo en agents_out/<ruta> (misma ruta relativa); el harness lo moverá a .agents/ al terminar. Si una escritura falla por 'Access denied' en otra carpeta, dilo en el informe.`n"
}

# --- gemini (respaldo): vía Antigravity agentapi (requiere la app abierta); el backend por defecto es la CLI agy ---
function Invoke-Antigravity {
  $ls = Get-CimInstance Win32_Process -Filter "Name='language_server.exe'" |
        Where-Object { $_.CommandLine -match 'csrf_token\s+([0-9a-f-]{36})' } | Select-Object -First 1
  if (-not $ls) { return @{ code = 2; out = 'Antigravity no está abierto. Ábrelo y reintenta (o usa el fallback de routing.md).' } }
  $null = $ls.CommandLine -match 'csrf_token\s+([0-9a-f-]{36})'; $env:ANTIGRAVITY_CSRF_TOKEN = $Matches[1]
  # ExecutablePath no depende de si la línea de comando trae la ruta entre comillas
  $exeA = if ($ls.ExecutablePath) { $ls.ExecutablePath } else { ($ls.CommandLine -replace '^"([^"]+)".*','$1') -replace '\s+--.*$','' }

  # proyecto de Antigravity cuya carpeta contiene este repo
  $rootN = $root.TrimEnd('\').ToLower()
  $proj = Get-ChildItem "$HOME\.gemini\config\projects\*.json" | ForEach-Object {
    $j = Get-Content $_.FullName -Raw | ConvertFrom-Json
    foreach ($r in $j.projectResources.resources) {
      $u = if ($r.folderUri) { $r.folderUri } else { $r.gitFolder.folderUri }
      if ($u) { $f = ([Uri]::UnescapeDataString($u) -replace '^file:///','' -replace '/','\').TrimEnd('\').ToLower()
                if ($rootN -eq $f -or $rootN.StartsWith("$f\")) { $j.id } }
    } } | Select-Object -First 1
  if (-not $proj) { return @{ code = 2; out = "No hay proyecto de Antigravity para $root. Abre la carpeta una vez en Antigravity." } }
  $env:ANTIGRAVITY_PROJECT_ID = $proj

  # puerto gRPC: de los que escucha el proceso, el que no da error de protocolo
  $port = Get-NetTCPConnection -OwningProcess $ls.ProcessId -State Listen -ErrorAction SilentlyContinue |
    Sort-Object LocalPort | Where-Object {
      $env:ANTIGRAVITY_LS_ADDRESS = "127.0.0.1:$($_.LocalPort)"
      -not ((& $exeA agentapi get-conversation-metadata 00000000-0000-0000-0000-000000000000 2>&1 | Out-String) -match 'preface|forcibly|refused')
    } | Select-Object -First 1
  if (-not $port) { return @{ code = 2; out = 'No encontré el puerto del servidor de Antigravity.' } }
  $env:ANTIGRAVITY_LS_ADDRESS = "127.0.0.1:$($port.LocalPort)"

  $pfile = Join-Path $runDir 'prompt.md'
  $mode = if ($Write) { 'Puedes editar archivos dentro del alcance del brief.' } else { 'SOLO LECTURA: no modifiques ningún archivo salvo el informe.' }
  if ($Worktree) {
    # worktree dentro del proyecto (Antigravity solo ve la carpeta del proyecto); rama harness/<id>
    $wt = Join-Path $harness "worktrees\$Id"
    if (-not (Test-Path $wt)) {
      $g = & git -C $root worktree add -q -b "harness/$Id" $wt 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0) { return @{ code = 2; out = "No pude crear el worktree (¿es un repo git con commits?): $g" } }
    }
    $mode += " Trabaja EXCLUSIVAMENTE dentro de la carpeta $wt (copia del repo en la rama harness/$Id): lee y edita solo ahí, nunca en $root fuera de ella. No hagas commit."
  }
  [IO.File]::WriteAllText($pfile, $prompt, $utf8)
  if (Test-Path $result) { Remove-Item $result }
  $progress = [IO.Path]::ChangeExtension($result, '.progress.md')
  if (Test-Path $progress) { Remove-Item $progress }
  $msg = "Lee y ejecuta las instrucciones del archivo $pfile . $mode Al terminar, escribe tu informe final (formato indicado en ese archivo) en $result con una sola escritura. " +
         "SEÑAL DE VIDA (obligatorio): en los primeros 5 minutos escribe $progress con 3-6 líneas: qué entendiste, qué archivos tocarás y tu primer paso; añade una línea al completar cada paso. " +
         "Si el brief es inviable o te bloqueas, escribe YA el informe final en $result con estado 'blocked': qué intentaste, qué archivo o función te frenó y qué necesitas. Nunca termines sin informe."
  $mA = if ($m) { $m } else { 'flash' }
  $o = & $exeA agentapi new-conversation "--model=$mA" "--title=harness $Id" $msg 2>&1 | Out-String
  if ($o -notmatch '"conversationId":\s*"([^"]+)"') { return @{ code = 1; out = $o } }
  $conv = $Matches[1]
  # vigilancia: live.log cada minuto (pasos de la conversación vía ag-trace.py), corte temprano sin señal de vida o atascado
  $live  = Join-Path $runDir 'live.log'
  $trace = Join-Path $PSScriptRoot 'ag-trace.py'
  $py    = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' } elseif (Get-Command py -ErrorAction SilentlyContinue) { 'py' } else { '' }
  $aliveMin = if ($cfg.gemini.aliveMin) { [double]$cfg.gemini.aliveMin } else { 10 }
  $stallMin = if ($cfg.gemini.stallMin) { [double]$cfg.gemini.stallMin } else { 10 }
  # tope de pasos: cada paso reenvía todo el contexto y gasta el límite semanal; al llegar se le pide cerrar
  $maxSteps = if ($cfg.gemini.maxSteps) { [int]$cfg.gemini.maxSteps } else { 150 }
  $capAsked = $null
  $start = Get-Date; $deadline = $start.AddMinutes($TimeoutMin); $last = -1
  $steps = -1; $lastChange = $start; $nextLog = $start; $why = ''
  $nextHb = $start; $lastSum = ''
  [IO.File]::WriteAllText($live, "$(Get-Date -Format s) conversación $conv (modelo $mA); señal de vida en $progress`n", $utf8)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep 5
    if (Test-Path $result) { $len = (Get-Item $result).Length; if ($len -gt 0 -and $len -eq $last) { break }; $last = $len }
    if ((Get-Date) -ge $nextHb) {
      Write-Heartbeat -IdleMin ((Get-Date) - $lastChange).TotalMinutes -LastOutput $lastSum
      $nextHb = (Get-Date).AddSeconds(15)
    }
    if ((Get-Date) -lt $nextLog) { continue }
    $nextLog = (Get-Date).AddSeconds(60)
    $sum = if ($py) { (& $py -I $trace $conv --summary 2>&1 | Out-String).Trim() } else { '(sin python: sin detalle de pasos)' }
    $lastSum = $sum
    $alive = if (Test-Path $progress) { 'progress=sí' } else { 'progress=no' }
    [IO.File]::AppendAllText($live, "$(Get-Date -Format s) $alive $sum`n", $utf8)
    if ($sum -match 'pasos=(\d+)') { if ([int]$Matches[1] -ne $steps) { $steps = [int]$Matches[1]; $lastChange = Get-Date } }
    if ($steps -ge $maxSteps -and -not $capAsked) {
      $capAsked = Get-Date
      $null = & $exeA agentapi send-message $conv "LÍMITE DE PASOS ($maxSteps) alcanzado. No hagas más cambios: escribe AHORA el informe final en $result con estado 'partial' (qué quedó hecho, qué falta, dónde seguir) y termina." 2>&1
      [IO.File]::AppendAllText($live, "$(Get-Date -Format s) tope de $maxSteps pasos: pedido informe parcial`n", $utf8) }
    if ($capAsked -and ((Get-Date) - $capAsked).TotalMinutes -ge 3) {
      $why = "tope de pasos: superó $maxSteps pasos y no entregó informe parcial en 3 min"; break }
    $mins = ((Get-Date) - $start).TotalMinutes
    if ($mins -ge $aliveMin -and -not (Test-Path $progress) -and -not (Test-Path $result)) {
      $why = "sin señal de vida: no escribió $(Split-Path $progress -Leaf) en $aliveMin min"; break }
    if ($steps -ge 0 -and ((Get-Date) - $lastChange).TotalMinutes -ge $stallMin) {
      $why = "atascado: ningún paso nuevo en $stallMin min"; break }
  }
  $done = (Test-Path $result) -and (Get-Item $result).Length -gt 0
  if (-not $done) {
    if (-not $why) { $why = "timeout: $TimeoutMin min sin informe" }
    # pedirle que pare (si la API lo admite) y guardar qué hizo para el diagnóstico
    $null = & $exeA agentapi send-message $conv "CANCELADA por el harness ($why). DETENTE: no ejecutes más herramientas ni edites archivos. Responde solo 'ok' y termina." 2>&1
    # agentapi no tiene cancelación real: vigilar 2 min y dejar constancia si siguió gastando
    if ($py) { $s0 = $steps; Start-Sleep 120
      if ((& $py -I $trace $conv --summary 2>&1 | Out-String) -match 'pasos=(\d+)' -and [int]$Matches[1] -gt $s0 + 3) {
        [IO.File]::AppendAllText($live, "$(Get-Date -Format s) AVISO: siguió trabajando tras cancelar ($s0 -> $($Matches[1]) pasos); ciérrala a mano en Antigravity: conversación $conv`n", $utf8)
        $why += " | SIGUE ACTIVA tras cancelar: ciérrala en Antigravity ($conv)" } }
    $tr = if ($py) { & $py -I $trace $conv --tail 40 2>&1 | Out-String } else { 'sin python: abre la conversación en Antigravity' }
    [IO.File]::WriteAllText((Join-Path $runDir 'trace.txt'), $tr, $utf8)
    [IO.File]::AppendAllText($live, "$(Get-Date -Format s) FALLO: $why. Pasos en trace.txt`n", $utf8)
    $o += "`nFALLO: $why`n--- últimos pasos (trace.txt) ---`n" + (($tr -split "`n" | Select-Object -Last 15) -join "`n")
  }
  return @{ code = $(if ($done) {0} else {124}); why = $(if ($done) {''} else {$why}); out = "$o`nconversation=$conv project=$proj timeout=$(-not $done)" }
}

# --- vigilancia de un proceso CLI (codex, claude, dsh/opencode): latido cada 15 s, corte por arranque colgado,
# inactividad o tope total. Devuelve @{ code; why; booted }. Sin BootPattern, booted = hubo cualquier salida.
function Invoke-Watched {
  param(
    [Parameter(Mandatory)][string]$Exe,
    [string]$ArgLine = '',
    [Parameter(Mandatory)][string]$OutF,
    [Parameter(Mandatory)][string]$ErrF,
    [string]$Cwd = '',
    [string]$StdinF = '',
    [string]$BootPattern = '',
    [double]$BootMin = 0,
    [double]$StallMin = 10,
    [double]$MaxMin = 0,
    [string]$Live = '',
    [string]$Label = ''
  )
  if (-not $Cwd) { $Cwd = $root }
  if (-not $Live) { $Live = Join-Path $runDir 'live.log' }
  Remove-Item $ErrF, $OutF -ErrorAction SilentlyContinue
  $sp = @{ FilePath = $Exe; ArgumentList = $ArgLine; RedirectStandardOutput = $OutF; RedirectStandardError = $ErrF
           WorkingDirectory = $Cwd; WindowStyle = 'Hidden'; PassThru = $true }
  if ($StdinF) { $sp.RedirectStandardInput = $StdinF }
  $proc = Start-Process @sp
  $null = $proc.Handle   # sin esto ExitCode llega vacío
  $script:hbPid = $proc.Id
  $t0 = Get-Date; $lastSize = -1; $lastAct = $t0; $booted = $false; $why = $null
  Add-Content $Live "[$(Get-Date -f HH:mm:ss)] $Label pid $($proc.Id)" -Encoding UTF8
  while (-not $proc.WaitForExit(15000)) {
    $sz = (Get-Item $ErrF -ErrorAction SilentlyContinue).Length + (Get-Item $OutF -ErrorAction SilentlyContinue).Length
    if ($sz -ne $lastSize) { $lastSize = $sz; $lastAct = Get-Date }
    if (-not $booted) {
      $booted = if ($BootPattern) { [bool](Select-String -Path $ErrF -Pattern $BootPattern -Quiet -ErrorAction SilentlyContinue) }
                else { $sz -gt 0 }
    }
    $el = ((Get-Date) - $t0).TotalMinutes; $idle = ((Get-Date) - $lastAct).TotalMinutes
    $tail = (Get-Content $ErrF -Tail 1 -ErrorAction SilentlyContinue) -replace '.*message=', ''
    $line = ("[{0:HH:mm:ss}] {1:N1} min, inactivo {2:N1} min | {3}" -f (Get-Date), $el, $idle, "$tail".Substring(0, [Math]::Min(140, "$tail".Length)))
    Add-Content $Live $line -Encoding UTF8
    Write-Heartbeat -IdleMin $idle -LastOutput $line
    if ($BootMin -gt 0 -and -not $booted -and $el -ge $BootMin) { $why = "arranque colgado: sin sesión tras $BootMin min" }
    elseif ($idle -ge $StallMin)                           { $why = "sin actividad $StallMin min" }
    elseif ($MaxMin -gt 0 -and $el -ge $MaxMin)            { $why = "superó maxMin=$MaxMin min" }
    if ($why) { & taskkill.exe /T /F /PID $proc.Id 2>&1 | Out-Null; Add-Content $Live "[$(Get-Date -f HH:mm:ss)] CORTADO: $why" -Encoding UTF8; break }
  }
  if (-not $why) { $proc.WaitForExit(); $code = $proc.ExitCode } else { $code = 124 }
  return @{ code = $code; why = $why; booted = $booted }
}

# --- gemini por defecto: CLI `agy` (misma cuenta/cuota, sin Antigravity abierto). Deja prompt.md y usa Invoke-Watched ---
function Invoke-AgyCli {
  $exe = (Get-Command agy -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if (-not $exe) { return @{ code = 2; out = 'Falta la CLI agy en PATH (%LOCALAPPDATA%\agy\bin\agy.exe).' } }
  $pfile = Join-Path $runDir 'prompt.md'
  $cwd = $root
  # El brief se lee aquí: fuera de esta función $prompt puede no estar construido todavía (la rama gemini se
  # ejecuta antes del bloque común) y agy recibiría un prompt vacío.
  $prompt = (Get-Content $brief -Raw -Encoding UTF8)
  if ($Worktree) {
    $wt = Join-Path $harness "worktrees\$Id"
    if (-not (Test-Path $wt)) {
      $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      $g = & git -C $root worktree add -q -b "harness/$Id" $wt 2>&1 | Out-String
      $ErrorActionPreference = $eap
      if ($LASTEXITCODE -ne 0) { return @{ code = 2; out = "No pude crear el worktree (¿es un repo git con commits?): $g" } }
    }
    $cwd = $wt
    $prompt += "`nTrabaja EXCLUSIVAMENTE en $wt (worktree en la rama harness/$Id). No hagas commit; el orquestador revisa y fusiona.`n"
  }
  [IO.File]::WriteAllText($pfile, $prompt, $utf8)
  if (Test-Path $result) { Remove-Item $result }   # informe de un intento anterior
  $outF = Join-Path $runDir 'agy-stdout.txt'; $errF = Join-Path $runDir 'agy-stderr.txt'
  $live = Join-Path $runDir 'live.log'
  $stallMin = if ($cfg.gemini.stallMin) { [double]$cfg.gemini.stallMin } else { 10 }
  $maxMin   = [Math]::Max($(if ($cfg.gemini.maxMin) { [double]$cfg.gemini.maxMin } else { 45 }), $EtaMin * 3)
  $mode = if ($Write) { 'accept-edits' } else { 'plan' }
  $msg = "Lee y sigue las instrucciones del archivo $pfile y deja tu informe final (con el formato que pide) como respuesta. " +
         "Si el brief es inviable o te bloqueas, responde igualmente el informe con estado 'blocked'."
  $agyArgs = @('-p', $msg, '--output-format', 'text', '--print-timeout', "$([int][Math]::Ceiling($maxMin))m",
               '--model', $m)
  # solo lectura = modo por defecto: en headless lee archivos y deniega solo lo que pide permiso ('plan' bloquea hasta leer)
  if ($Write) { $agyArgs += @('--mode', $mode, '--dangerously-skip-permissions') }
  # solo lectura: headless deniega run_command; --sandbox aisla los comandos (no impide escribir: el brief lo prohibe)
  else { $agyArgs += @('--sandbox', '--dangerously-skip-permissions') }
  $quoteArg = { param($a) if ($a -match '[\s"]') { '"' + ($a -replace '"','\"') + '"' } else { $a } }
  $argLine = ($agyArgs | ForEach-Object { & $quoteArg "$_" }) -join ' '
  $w = Invoke-Watched -Exe $exe -ArgLine $argLine -OutF $outF -ErrF $errF `
                      -Cwd $cwd -StallMin $stallMin -MaxMin $maxMin -Live $live -Label 'agy,'
  $answer = @(Get-Content $outF -Encoding UTF8 -ErrorAction SilentlyContinue |
              ForEach-Object { $_ -replace '\x1b\[[0-9;]*m','' })
  $answerTxt = ($answer -join "`n").Trim()
  # stdout es el informe: si agy no escribió result.md, se guarda ahí
  if ($answerTxt -and (-not (Test-Path $result) -or -not (Get-Item $result).Length)) {
    [IO.File]::WriteAllText($result, $answerTxt, $utf8)
  }
  $err = @(Get-Content $errF -Encoding UTF8 -ErrorAction SilentlyContinue |
           ForEach-Object { $_ -replace '\x1b\[[0-9;]*m','' } | Where-Object { $_ })
  $code = $w.code
  if ($code -eq 0 -and -not $answerTxt) { $code = 1 }
  $out = @($err) + '--- respuesta ---' + $answer
  if ($w.why) { $out = @("[harness] gemini cortado: $($w.why) (ver live.log)") + $out }
  return @{ code = $code; why = $w.why; out = $out }
}

$args_ = @()
switch ($Engine) {
  'codex' {
    # dieta de contexto: sin ~/.codex/config.toml (MCPs, plugins, notify) ni historial de sesión;
    # lo necesario se pasa explícito desde config.json (codex.overrides)
    # --worktree de codex no admite --ignore-user-config: el worktree lo crea el harness (rama harness/<id>), fuera
    # de carpetas con punto (el sandbox de Windows no escribe en ellas). Nunca enlaces/junctions dentro: al borrar el
    # worktree, git los sigue y borra los originales (así se perdió godot/game_assets). Borrar con remove-worktree.ps1.
    $cwd = $root
    if ($Worktree) {
      $wtBase = if ($cfg.codex.worktreeDir) { [Environment]::ExpandEnvironmentVariables($cfg.codex.worktreeDir) }
                else { "C:\tmp\harness-wt\$(Split-Path $root -Leaf)" }   # no %LOCALAPPDATA%: la app de Claude lo virtualiza
      $cwd = Join-Path $wtBase $Id
      if (-not (Test-Path $cwd)) {
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'   # git escribe el progreso en stderr
        $g = & git -C $root worktree add -q -b "harness/$Id" $cwd 2>&1 | Out-String
        $ErrorActionPreference = $eap
        if ($LASTEXITCODE -ne 0) { throw "No pude crear el worktree en ${cwd}: $g" }
      }
      $prompt += "`nTrabaja EXCLUSIVAMENTE en $cwd (worktree en la rama harness/$Id). No hagas commit; el orquestador revisa y fusiona.`n"
    }
    $args_ = @('exec','--ignore-user-config','--ephemeral','-C',$cwd,'--skip-git-repo-check','-o',$result,
               '-s', $(if ($Write) {'workspace-write'} else {'read-only'}))
    foreach ($o in $cfg.codex.overrides) { $args_ += @('-c',$o) }
    if (-not $Effort -and $cfg.codex.defaultEffort) { $Effort = $cfg.codex.defaultEffort }
    # cuota de codex: el razonamiento alto gasta mucho. high/xhigh solo en reintentos (mismo -Id); si no, maxEffort.
    $cap = if ($cfg.codex.maxEffort) { $cfg.codex.maxEffort } else { 'medium' }
    if ($Effort -in 'high','xhigh' -and -not $isRetry -and $cap -notin 'high','xhigh') {
      "[effort $Effort -> ${cap}: high solo en reintento con el mismo -Id]"; $Effort = $cap
    }
    if ($m)        { $args_ += @('-m',$m) }
    if ($Effort)   { $args_ += @('-c',"model_reasoning_effort=`"$Effort`"") }
    if ($Write -and $Worktree) { $args_ += @('--add-dir', $root) }   # agents_out/ e informe viven en la carpeta del proyecto
    $args_ += '-'                       # prompt por stdin
  }
  'dsh' {
    # DeepSeek Harness headless con un modelo de OpenRouter (config.dsh.models). El modelo se fija con un --patch por
    # run. La clave sale del almacén de dsh (credentials), no de la variable de entorno.
    # Worktree fuera de C:\tmp: el sandbox de dsh no puede dar permisos en carpetas creadas por el de codex.
    $cwd = $root
    if ($Worktree) {
      $wtBase = if ($cfg.dsh.worktreeDir) { [Environment]::ExpandEnvironmentVariables($cfg.dsh.worktreeDir) }
                else { "$HOME\harness-wt\$(Split-Path $root -Leaf)" }
      $cwd = Join-Path $wtBase $Id
      if (-not (Test-Path $cwd)) {
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $g = & git -C $root worktree add -q -b "harness/$Id" $cwd 2>&1 | Out-String
        $ErrorActionPreference = $eap
        if ($LASTEXITCODE -ne 0) { throw "No pude crear el worktree en ${cwd}: $g" }
      }
      $prompt += "`nTrabaja EXCLUSIVAMENTE en $cwd (worktree en la rama harness/$Id). No hagas commit; el orquestador revisa y fusiona.`n"
    }
    if (-not $Effort -and $cfg.dsh.defaultEffort) { $Effort = $cfg.dsh.defaultEffort }
    $patch = Join-Path $runDir 'dsh-model.yml'
    $eff = if ($Effort) { "`n    reasoningEffort: $(if ($Effort -in 'minimal','low') {'low'} elseif ($Effort -eq 'medium') {'medium'} else {'high'})" } else { '' }
    # dieta de contexto: ventana realista (dsh compacta antes) y tope de salida (sin él pide 393k y OpenRouter da 402)
    $ctxWin = if ($cfg.dsh.contextWindow) { [int]$cfg.dsh.contextWindow } else { 128000 }
    $maxTok = if ($cfg.dsh.maxTokens) { [int]$cfg.dsh.maxTokens } else { 16000 }
    # config.dsh.routing (fijar proveedor de OpenRouter) NO se usa: dsh rechaza compat.openRouterRouting
    # ("INVALID_CONFIG ... not configurable here"); OpenRouter elige proveedor solo.
    $route = ''
    # modelos que no aceptan reasoningEffort (p. ej. kimi): config.dsh.noEffort, por id o alias
    $noEff = @(if ($cfg.dsh.noEffort) { $cfg.dsh.noEffort } else { 'moonshotai/kimi-k3.1-pro','kimi-k3.1-pro' })
    if ($m -in $noEff -or $Model -in $noEff) { $eff = '' }
    if ($goDsh) {
      # la CLI opencode lee OPENCODE_API_KEY; el patch de dsh de abajo queda sin uso en este modo
      $pName = 'opencodego'; $pBase = $cfg.dsh.opencodego.baseURL; $pKey = $cfg.dsh.opencodego.apiKeyEnv
      if (-not [Environment]::GetEnvironmentVariable($pKey)) {
        $v = [Environment]::GetEnvironmentVariable($pKey, 'User'); if ($v) { Set-Item "env:$pKey" $v }
        else { throw "Falta la clave de OpenCode Go: crea la variable de usuario $pKey (console de opencode.ai → API Keys)." }
      }
    } else { $pName = 'openrouter'; $pBase = 'https://openrouter.ai/api/v1'; $pKey = 'OPENROUTER_API_KEY' }
    [IO.File]::WriteAllText($patch, @"
- id: llm-pi-ai
  config:
    providers:
      ${pName}:
        apiKeyEnv: $pKey
        api: openai-completions
        baseURL: $pBase
        models:
          - id: $m
            contextWindow: $ctxWin
            maxTokens: $maxTok$route
- id: agent-default-model
  config:
    provider: $pName
    model: $m$eff
- id: credentials
  disabled: false
"@, $utf8)
    $args_ = @('--profile','headless','--patch',$patch,'--approval-policy','never',
               '--permission-mode', $(if ($Write) {'workspace-write'} else {'read-only'}))
    # sin --add-dir: el sandbox ACL de Windows de dsh no lo admite y el shell deja de arrancar (el result va por stdout)
    $args_ += '-'                       # prompt por stdin
    $env:OPENROUTER_API_KEY = $null     # la del entorno de Windows está vencida y taparía la del almacén de dsh
  }
  'claude' {
    # worker headless: -Write edita y ejecuta comandos (tests, evidencia); sin -Write solo lee
    $args_ = @('-p','--permission-mode', $(if ($Write) {'acceptEdits'} else {'default'}),
               '--allowedTools', $(if ($Write) {'Read Edit Write Grep Glob Bash'} else {'Read Grep Glob'}))
    if ($m) { $args_ += @('--model',$m) }
    $env:HARNESS_WORKER = '1'           # guard.ps1 no limita a los workers, solo al orquestador
  }
}

$start = Get-Date
$killedWhy = $null; $stdoutLines = $null
Push-Location $(if ($cwd) { $cwd } else { $root })   # dsh trabaja en el directorio actual
try {
  $ErrorActionPreference = 'Continue'   # stderr de los CLIs no debe abortar
  if ($Engine -eq 'gemini') {
    $gBackend = if ($cfg.gemini.backend) { [string]$cfg.gemini.backend } else { 'agy' }
    $r = if ($gBackend -eq 'agentapi' -or -not (Get-Command agy -ErrorAction SilentlyContinue)) { Invoke-Antigravity } else { Invoke-AgyCli }
    $out = $r.out; $code = $r.code; $killedWhy = $r.why
  }
  elseif ($Engine -eq 'dsh' -and $goDsh) {
    # OpenCode Go exige x-opencode-session: dsh no lo manda, así que corre la CLI oficial `opencode run`.
    # Prompt en archivo adjunto (evita el límite de línea de comandos). plan = solo lectura; build = edita.
    $oc = (Get-Command opencode.cmd, opencode -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $oc) { throw 'Falta la CLI de OpenCode: npm i -g opencode-ai' }
    $pf = Join-Path $runDir 'prompt.md'; [IO.File]::WriteAllText($pf, $prompt, $utf8)
    # el mensaje va antes de -f: -f es un array y se tragaría lo que venga después
    $ocArgs = @('run','Sigue exactamente las instrucciones del archivo adjunto prompt.md. Tu respuesta final es el informe.',
                '--pure','-m',"opencode-go/$m",'--agent',$(if ($Write) {'build'} else {'plan'}),
                '--dir', $(if ($cwd) { $cwd } else { $root }),'--title',"harness $Id",'-f',$pf)
    if ($Effort -in 'medium','high','xhigh') { $ocArgs += @('--variant', $(if ($Effort -eq 'medium') {'medium'} else {'high'})) }
    $ocArgs += @('--print-logs','--log-level','INFO')   # latido: opencode registra cada paso en stderr
    $errF = Join-Path $runDir 'dsh-stderr.txt'; $outF = Join-Path $runDir 'dsh-stdout.txt'
    $live = Join-Path $runDir 'live.log'
    $env:NO_COLOR = '1'
    # BD propia por run: la CLI comparte sesiones si todos los runs usan la misma BD y se filtran
    # comandos de otros proyectos (visto 2026-11-25). Cada run usa su propio XDG_DATA_HOME.
    if (-not $env:XDG_DATA_HOME) { $env:XDG_DATA_HOME = Join-Path $runDir 'ocdata' }
    # vigilancia (17-nov-2026: un run se quedó 3 h colgado en el arranque sin error): arranque sin sesión → relanzar;
    # sin actividad stallMin → cortar; total maxMin → cortar. Código 124 = drain lo da por fallido y avisa.
    $bootMin  = if ($cfg.dsh.bootMin)  { [double]$cfg.dsh.bootMin }  else { 2 }
    $stallMin = if ($cfg.dsh.stallMin) { [double]$cfg.dsh.stallMin } else { 8 }
    $maxMin   = [Math]::Max($(if ($cfg.dsh.maxMin) { [double]$cfg.dsh.maxMin } else { 45 }), $EtaMin * 3)
    $quoteArg = { param($a) if ($a -match '[\s"]') { '"' + ($a -replace '"','\"') + '"' } else { $a } }
    $argLine = ($ocArgs | ForEach-Object { & $quoteArg "$_" }) -join ' '
    $why = $null; $code = 0
    foreach ($try in 1, 2) {
      $w = Invoke-Watched -Exe $oc -ArgLine $argLine -OutF $outF -ErrF $errF `
                          -Cwd $(if ($cwd) { $cwd } else { $root }) -BootPattern 'session\.id=' `
                          -BootMin $bootMin -StallMin $stallMin -MaxMin $maxMin -Live $live -Label "intento $try,"
      $code = $w.code; $why = $w.why
      if (-not $why -or $w.booted) { break }   # solo el arranque colgado se relanza solo; lo demás vuelve al orquestador
    }
    $answer = @(Get-Content $outF -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { $_ -replace '\x1b\[[0-9;]*m','' })
    $err = @(Get-Content $errF -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { $_ -replace '\x1b\[[0-9;]*m','' } |
             Where-Object { $_ -and ($_ -notmatch '^timestamp=' -or $_ -match 'level=(ERROR|WARN)') -and $_ -notmatch 'failed to add snapshot files' })
    # stderr trae también la salida de las herramientas (tests de Godot imprimen "ERROR: ..."): solo cuenta el
    # "Error: " exacto con que opencode termina (sensible a mayúsculas) y sus propias líneas level=ERROR.
    $ocErr = @($err | Where-Object { $_ -cmatch '^Error: ' -or ($_ -cmatch '^timestamp=\S+ level=ERROR ') })
    if ($code -eq 0 -and ($ocErr | Where-Object { $_ -cmatch '^Error: ' })) { $code = 1 }
    if ($why) { $killedWhy = $why }
    if ($why) { $err = @("[harness] dsh cortado: $why (ver live.log)") + $err }
    $out = $err + '--- respuesta ---' + $answer
  }
  elseif ($Engine -eq 'dsh') {
    # stdout = respuesta final (el result); stderr = razonamiento y diagnósticos (solo al log)
    $exe = if ($cfg.dsh.exe) { [Environment]::ExpandEnvironmentVariables($cfg.dsh.exe) }
           else { "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" }
    $errF = Join-Path $runDir 'dsh-stderr.txt'
    $answer = @($prompt | & $exe @args_ 2> $errF | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    # el modelo no acepta ese reasoningEffort (cada modelo de OpenRouter admite otros): reintento al momento sin él
    if ($code -ne 0 -and (Get-Content $errF -Raw -Encoding UTF8) -match 'UNSUPPORTED_REASONING_EFFORT') {
      $y = (Get-Content $patch -Raw -Encoding UTF8) -replace '(?m)^\s*reasoningEffort:.*\r?\n?', ''
      [IO.File]::WriteAllText($patch, $y, $utf8)
      Add-Content $errF "[harness] $m no admite reasoningEffort=$Effort; reintento sin esfuerzo" -Encoding UTF8
      $answer = @($prompt | & $exe @args_ 2>> $errF | ForEach-Object { "$_" })
      $code = $LASTEXITCODE
    }
    $out = @(Get-Content $errF -Encoding UTF8 | Where-Object { $_ -ne 'System.Management.Automation.RemoteException' }) + '--- respuesta ---' + $answer
  } else {
  # codex/claude: mismo vigilante que dsh, sin patrón de arranque (booted = cualquier salida)
  $exe = (Get-Command "$Engine.cmd","$Engine.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if (-not $exe) { $exe = $Engine }
  $launchCwd = if ($cwd) { $cwd } else { $root }
  $inF = Join-Path $runDir 'prompt-stdin.txt'
  [IO.File]::WriteAllText($inF, $prompt, $utf8)   # prompt por stdin (codex: '-' ; claude: -p)
  $errF = Join-Path $runDir "$Engine-stderr.txt"; $outF = Join-Path $runDir "$Engine-stdout.txt"
  $live = Join-Path $runDir 'live.log'
  $quoteArg = { param($a) if ($a -match '[\s"]') { '"' + ($a -replace '"','\"') + '"' } else { $a } }
  $argLine = ($args_ | ForEach-Object { & $quoteArg "$_" }) -join ' '
  $stallMin = if ($cfg.$Engine.stallMin) { [double]$cfg.$Engine.stallMin } else { 10 }
  $maxMin   = if ($cfg.$Engine.maxMin) { [double]$cfg.$Engine.maxMin }
              else { [Math]::Max($(if ($Engine -eq 'codex') { 60 } else { 45 }), $EtaMin * 3) }
  $w = Invoke-Watched -Exe $exe -ArgLine $argLine -OutF $outF -ErrF $errF -Cwd $launchCwd -StdinF $inF `
                      -StallMin $stallMin -MaxMin $maxMin -Live $live -Label "$Engine"
  $code = $w.code; $why = $w.why
  if ($why) { $killedWhy = $why }
  $stdoutLines = @(Get-Content $outF -Encoding UTF8 -ErrorAction SilentlyContinue)
  $out = @(@(Get-Content $errF -Encoding UTF8 -ErrorAction SilentlyContinue) + $stdoutLines |
           Where-Object { $_ -ne 'System.Management.Automation.RemoteException' }) }
} finally { Pop-Location }
[IO.File]::WriteAllText($log, ($out -join "`n"), $utf8)

# codex: mover lo que dejó en agents_out/ a .agents/ (ver nota del sandbox arriba)
$outDir = Join-Path $(if ($cwd) { $cwd } else { $root }) 'agents_out'   # en un worktree, codex lo deja ahí
if ($agentsOut -and (Test-Path $outDir)) {
  Get-ChildItem $outDir -Recurse -File | ForEach-Object {
    $dst = Join-Path (Join-Path $root '.agents') $_.FullName.Substring($outDir.Length).TrimStart('\')
    New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
    Move-Item -Force $_.FullName $dst
  }
  Remove-Item -Recurse -Force $outDir -ErrorAction SilentlyContinue
}

# cuota agotada → cooldown + relanzamiento. codex: "...or try again at Nov 3rd, 2026 2:11 AM."
$text = $out -join "`n"
# dsh/opencode: solo las líneas de error de la CLI, nunca la respuesta del modelo (17-nov-2026: una tabla de
# docs con "`429` | RATE_LIMITED" y números de línea ":402:" congelaron dsh 1 h con la cuota intacta).
if ($Engine -eq 'dsh' -and $goDsh) {
  $text = if ($why) { '' } else { $ocErr -join "`n" }
}
# claude: "You've hit your limit · resets 3pm" / "Claude AI usage limit reached"
# dsh/OpenRouter: "402 ... Insufficient credits" (sin saldo) o 429
if ($code -ne 0 -and $text -match 'usage limit|rate limit|RESOURCE_EXHAUSTED|quota exceeded|hit your limit|limit reached|Insufficient credits|\b402\b|\b429\b') {
  $at = (Get-Date).AddMinutes(60)      # el mensaje no trae hora: reintentar en 1 h
  # dsh: un 429 del proveedor de UN modelo (pool compartido saturado) es pasajero: no congelar dsh 1 h
  if ($Engine -eq 'dsh' -and $text -match 'rate-limited upstream|upstream_provider|temporarily rate-limited' -and $text -notmatch 'Insufficient credits|402') {
    $at = (Get-Date).AddMinutes($(if ($cfg.dsh.upstreamCooldownMin) { [int]$cfg.dsh.upstreamCooldownMin } else { 5 }))
  }
  if ($text -match 'try again at ([A-Z][a-z]{2}) (\d{1,2})(?:st|nd|rd|th)?, (\d{4}) (\d{1,2}:\d{2} [AP]M)') {
    $at = [datetime]::ParseExact("$($Matches[1]) $($Matches[2]) $($Matches[3]) $($Matches[4])", 'MMM d yyyy h:mm tt',
                                 [Globalization.CultureInfo]::InvariantCulture)
  } elseif ($text -match '(?:try again at|resets) (\d{1,2})(?::(\d{2}))?\s?([AaPp][Mm])') {
    # solo hora ("try again at 1:33 PM", claude: "resets 3pm"): hoy, o mañana si ya pasó
    $hh = [int]$Matches[1] % 12; $mm = [int]("0" + $Matches[2]); $pm = $Matches[3] -like 'p*'   # antes de otro -match
    if ($pm) { $hh += 12 }
    $at = (Get-Date).Date.AddHours($hh).AddMinutes($mm)
    if ($at -lt (Get-Date)) { $at = $at.AddDays(1) }
  }
  $msg = ($text -split "`n" | Where-Object { $_ -match 'limit|quota|EXHAUSTED' } | Select-Object -First 1)
  $quota | Add-Member $qkey ([pscustomobject]@{ status = 'cooldown'; reset_at = $at.ToString('s'); msg = "$msg".Trim() }) -Force
  Save-Quota
  # con otra cuenta libre, un run suelto (sin drain) se relanza ya con ella en lugar de esperar
  $other = $accounts | Where-Object { $_ -ne $Account -and -not (CoolUntil "codex-$_") } | Select-Object -First 1
  if ($other -and -not $NoSchedule) {
    $launch['Account'] = $other
    Schedule-Resume (Get-Date).AddMinutes(1)
    Write-Heartbeat -Phase 'killed' -Why "queued: $qkey agotó su cuota"
    [IO.File]::WriteAllText($result, "## Estado`nqueued — $qkey agotó su cuota; relanzado con la cuenta $other en 1 min.", $utf8)
    "[$qkey sin cuota → relanzado con cuenta $other] $result"; exit 75
  }
  Exit-Queued $at.AddMinutes(2) "$qkey agotó su cuota"
}
if ($code -eq 0 -and $q -and $q.status -eq 'cooldown') { $quota | Add-Member $qkey ([pscustomobject]@{ status = 'ok' }) -Force; Save-Quota }

# claude escribe su respuesta en stdout: el result es esa salida
if ($Engine -eq 'dsh' -and $code -eq 0 -and ($answer -join '').Trim()) { [IO.File]::WriteAllText($result, ($answer -join "`n"), $utf8) }
if ($Engine -eq 'claude') {
  $claudeOut = if ($stdoutLines) { $stdoutLines } else { $out }
  ($claudeOut | Where-Object { $_ -notmatch '^(Loaded cached|YOLO mode|Warning:)' }) -join "`n" | ForEach-Object { [IO.File]::WriteAllText($result, $_, $utf8) }
}
# watchdog: el informe dice por qué se cortó (código 124); el orquestador lo ve como blocked
if ($killedWhy) { [IO.File]::WriteAllText($result, "## Estado`nblocked — watchdog: $killedWhy. Ver log.txt", $utf8) }
if (-not (Test-Path $result) -or (Get-Item $result).Length -eq 0) {
  [IO.File]::WriteAllText($result, "## Estado`nblocked — el motor no produjo informe (exit $code). Ver log.txt", $utf8)
}
Write-Heartbeat -Phase $(if ($killedWhy) { 'killed' } else { 'done' }) -Why "$killedWhy"
$secs = [int]((Get-Date) - $start).TotalSeconds
"[$Engine$(if($Account){"-$Account"}) model=$(if($m){$m}else{'(cli default)'}) effort=$Effort write=$Write exit=$code ${secs}s] $result"
exit $code
