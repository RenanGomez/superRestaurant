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
  [int]$TimeoutMin = 20,                 # espera máxima del result (gemini/Antigravity)
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
foreach ($d in @($runDir, (Split-Path $result -Parent))) { New-Item -ItemType Directory -Force $d | Out-Null }
if (-not (Test-Path $brief)) { throw "No existe $brief" }

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

$m = $cfg.$Engine.models.$Model
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
# Godot 4 crashea al arrancar en el sandbox (no puede crear su log en %APPDATA%); el wrapper del proyecto lo evita
if (Test-Path (Join-Path $root 'tools\godot.cmd')) {
  $prompt += "`nPara correr Godot usa SIEMPRE tools\godot.cmd (mismos argumentos que el .exe; en Git Bash ./tools/godot.cmd), nunca el .exe directo: sin eso Godot crashea al arrancar en el sandbox.`n"
}
# el sandbox de codex en Windows no deja escribir en carpetas que empiezan por punto: .agents/ → agents_out/
$agentsOut = ($Engine -eq 'codex') -and $Write -and (Test-Path (Join-Path $root '.agents'))
if ($agentsOut) {
  $prompt += "`nIMPORTANTE (sandbox): no puedes escribir dentro de .agents/. Todo archivo que el brief te pida crear o editar bajo .agents/<ruta> escríbelo en agents_out/<ruta> (misma ruta relativa); el harness lo moverá a .agents/ al terminar. Si una escritura falla por 'Access denied' en otra carpeta, dilo en el informe.`n"
}

# --- gemini: vía Antigravity agentapi (Gemini CLI ya no acepta cuentas personales) ---
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
  $msg = "Lee y ejecuta las instrucciones del archivo $pfile . $mode Al terminar, escribe tu informe final (formato indicado en ese archivo) en $result con una sola escritura."
  $mA = if ($m) { $m } else { 'flash' }
  $o = & $exeA agentapi new-conversation "--model=$mA" "--title=harness $Id" $msg 2>&1 | Out-String
  if ($o -notmatch '"conversationId":\s*"([^"]+)"') { return @{ code = 1; out = $o } }
  $conv = $Matches[1]
  $deadline = (Get-Date).AddMinutes($TimeoutMin); $last = -1
  while ((Get-Date) -lt $deadline) {
    Start-Sleep 5
    if (Test-Path $result) { $len = (Get-Item $result).Length; if ($len -gt 0 -and $len -eq $last) { break }; $last = $len }
  }
  $done = (Test-Path $result) -and (Get-Item $result).Length -gt 0
  return @{ code = $(if ($done) {0} else {124}); out = "$o`nconversation=$conv project=$proj timeout=$(-not $done)" }
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
    [IO.File]::WriteAllText($patch, @"
- id: llm-pi-ai
  config:
    providers:
      openrouter:
        apiKeyEnv: OPENROUTER_API_KEY
        api: openai-completions
        baseURL: https://openrouter.ai/api/v1
        models:
          - id: $m
            contextWindow: 1000000
- id: agent-default-model
  config:
    provider: openrouter
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
Push-Location $(if ($cwd) { $cwd } else { $root })   # dsh trabaja en el directorio actual
try {
  $ErrorActionPreference = 'Continue'   # stderr de los CLIs no debe abortar
  if ($Engine -eq 'gemini') { $r = Invoke-Antigravity; $out = $r.out; $code = $r.code }
  elseif ($Engine -eq 'dsh') {
    # stdout = respuesta final (el result); stderr = razonamiento y diagnósticos (solo al log)
    $exe = if ($cfg.dsh.exe) { [Environment]::ExpandEnvironmentVariables($cfg.dsh.exe) }
           else { "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" }
    $errF = Join-Path $runDir 'dsh-stderr.txt'
    $answer = @($prompt | & $exe @args_ 2> $errF | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    $out = @(Get-Content $errF -Encoding UTF8 | Where-Object { $_ -ne 'System.Management.Automation.RemoteException' }) + '--- respuesta ---' + $answer
  } else {
  $exe = (Get-Command "$Engine.cmd","$Engine.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if (-not $exe) { $exe = $Engine }
  $out = $prompt | & $exe @args_ 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -ne 'System.Management.Automation.RemoteException' }
  $code = $LASTEXITCODE }
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
# claude: "You've hit your limit · resets 3pm" / "Claude AI usage limit reached"
# dsh/OpenRouter: "402 ... Insufficient credits" (sin saldo) o 429
if ($code -ne 0 -and $text -match 'usage limit|rate limit|RESOURCE_EXHAUSTED|quota exceeded|hit your limit|limit reached|Insufficient credits|\b402\b|\b429\b') {
  $at = (Get-Date).AddMinutes(60)      # el mensaje no trae hora: reintentar en 1 h
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
    [IO.File]::WriteAllText($result, "## Estado`nqueued — $qkey agotó su cuota; relanzado con la cuenta $other en 1 min.", $utf8)
    "[$qkey sin cuota → relanzado con cuenta $other] $result"; exit 75
  }
  Exit-Queued $at.AddMinutes(2) "$qkey agotó su cuota"
}
if ($code -eq 0 -and $q -and $q.status -eq 'cooldown') { $quota | Add-Member $qkey ([pscustomobject]@{ status = 'ok' }) -Force; Save-Quota }

# claude escribe su respuesta en stdout: el result es esa salida
if ($Engine -eq 'dsh' -and $code -eq 0 -and ($answer -join '').Trim()) { [IO.File]::WriteAllText($result, ($answer -join "`n"), $utf8) }
if ($Engine -eq 'claude') { ($out | Where-Object { $_ -notmatch '^(Loaded cached|YOLO mode|Warning:)' }) -join "`n" | ForEach-Object { [IO.File]::WriteAllText($result, $_, $utf8) } }
if (-not (Test-Path $result) -or (Get-Item $result).Length -eq 0) {
  [IO.File]::WriteAllText($result, "## Estado`nblocked — el motor no produjo informe (exit $code). Ver log.txt", $utf8)
}
$secs = [int]((Get-Date) - $start).TotalSeconds
"[$Engine$(if($Account){"-$Account"}) model=$(if($m){$m}else{'(cli default)'}) effort=$Effort write=$Write exit=$code ${secs}s] $result"
exit $code
