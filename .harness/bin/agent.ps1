<#
.SYNOPSIS
  Lanza un subagente (codex | gemini | claude) con el brief de .harness/runs/<Id>/brief.md.
  Deja result.md (informe corto) y log.txt (salida completa) en la misma carpeta.
.EXAMPLE
  powershell -NoProfile -File .harness/bin/agent.ps1 -Engine gemini -Id map-auth -Model strong
  powershell -NoProfile -File .harness/bin/agent.ps1 -Engine codex -Id fix-login -Model default -Effort medium -Write
#>
param(
  [Parameter(Mandatory)][ValidateSet('codex','gemini','claude')][string]$Engine,
  [Parameter(Mandatory)][string]$Id,
  [string]$Model = 'default',            # alias fast|default|strong o nombre literal
  [ValidateSet('','minimal','low','medium','high','xhigh')][string]$Effort = '',  # solo codex
  [switch]$Write,                        # permite editar archivos
  [switch]$Worktree,                     # trabaja en un git worktree aparte (codex)
  [int]$TimeoutMin = 20                  # espera máxima del result (gemini/Antigravity)
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

$m = $cfg.$Engine.models.$Model
if ($null -eq $m) { $m = $Model }      # nombre literal
# formato del informe: plantilla del harness, o el texto que diga config.resultFormat
$instr = if ($cfg.resultFormat) { "`n---`n$($cfg.resultFormat)`n" } else {
  (Get-Content (Join-Path $harness 'templates\result-instructions.md') -Raw -Encoding UTF8) -replace '\{MAX\}', $cfg.resultMaxLines }
$prompt = (Get-Content $brief -Raw -Encoding UTF8) + "`n`nLee y respeta AGENTS.md del proyecto.`n"
# Godot 4.6 crashes at start when it cannot create its log (sandbox: %APPDATA% is read-only); its wrapper avoids it
if (Test-Path (Join-Path $root 'tools\godot.cmd')) {
  $prompt += "Para correr Godot usa SIEMPRE tools\godot.cmd (mismos argumentos que el .exe; en Git Bash ./tools/godot.cmd), nunca el .exe directo: sin eso Godot crashea al arrancar en el sandbox.`n"
}
$prompt += $instr

# --- gemini: vía Antigravity agentapi (Gemini CLI ya no acepta cuentas personales) ---
function Invoke-Antigravity {
  $ls = Get-CimInstance Win32_Process -Filter "Name='language_server.exe'" |
        Where-Object { $_.CommandLine -match 'csrf_token\s+([0-9a-f-]{36})' } | Select-Object -First 1
  if (-not $ls) { return @{ code = 2; out = 'Antigravity no está abierto. Ábrelo y reintenta (o usa el fallback de routing.md).' } }
  $null = $ls.CommandLine -match 'csrf_token\s+([0-9a-f-]{36})'; $env:ANTIGRAVITY_CSRF_TOKEN = $Matches[1]
  $exeA = ($ls.CommandLine -replace '^"([^"]+)".*','$1')

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
    $args_ = @('exec','-C',$root,'--skip-git-repo-check','-o',$result,
               '-s', $(if ($Write) {'workspace-write'} else {'read-only'}))
    if ($m)        { $args_ += @('-m',$m) }
    if ($Effort)   { $args_ += @('-c',"model_reasoning_effort=`"$Effort`"") }
    if ($Worktree) { $args_ += '--worktree' }
    $args_ += '-'                       # prompt por stdin
  }
  'claude' {
    $args_ = @('-p','--permission-mode', $(if ($Write) {'acceptEdits'} else {'plan'}))
    if ($m) { $args_ += @('--model',$m) }
  }
}

$start = Get-Date
Push-Location $root
try {
  $ErrorActionPreference = 'Continue'   # stderr de los CLIs no debe abortar
  if ($Engine -eq 'gemini') { $r = Invoke-Antigravity; $out = $r.out; $code = $r.code } else {
  $exe = (Get-Command "$Engine.cmd","$Engine.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if (-not $exe) { $exe = $Engine }
  $out = $prompt | & $exe @args_ 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -ne 'System.Management.Automation.RemoteException' }
  $code = $LASTEXITCODE }
} finally { Pop-Location }
[IO.File]::WriteAllText($log, ($out -join "`n"), $utf8)

# claude escribe su respuesta en stdout: el result es esa salida
if ($Engine -eq 'claude') { ($out | Where-Object { $_ -notmatch '^(Loaded cached|YOLO mode|Warning:)' }) -join "`n" | ForEach-Object { [IO.File]::WriteAllText($result, $_, $utf8) } }
if (-not (Test-Path $result) -or (Get-Item $result).Length -eq 0) {
  [IO.File]::WriteAllText($result, "## Estado`nblocked — el motor no produjo informe (exit $code). Ver log.txt", $utf8)
}
$secs = [int]((Get-Date) - $start).TotalSeconds
"[$Engine model=$(if($m){$m}else{'(cli default)'}) effort=$Effort write=$Write exit=$code ${secs}s] $result"
exit $code
