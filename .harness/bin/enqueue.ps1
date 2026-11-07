<#
.SYNOPSIS
  Añade una tarea a la cola (.harness/queue/<Id>.json). El brief debe existir en .harness/runs/<Id>/brief.md.
  La ejecuta drain.ps1 respetando dependencias, cuota de cada motor y "un escritor por archivo".
.EXAMPLE
  powershell -NoProfile -File .harness/bin/enqueue.ps1 -Id api-tests -Engine gemini -Model default -Write -Worktree -Files src/api
  powershell -NoProfile -File .harness/bin/enqueue.ps1 -Id fix-login -Engine codex -Effort medium -Write -Files src/auth -After api-tests
#>
param(
  [Parameter(Mandatory)][string]$Id,
  [Parameter(Mandatory)][ValidateSet('codex','gemini','dsh','claude')][string]$Engine,
  [string]$Model = 'default',
  [ValidateSet('','minimal','low','medium','high','xhigh')][string]$Effort = '',
  [switch]$Write,
  [switch]$Worktree,
  [string[]]$Files = @(),                # rutas/carpetas que escribe (para no solapar escritores)
  [string[]]$After = @(),                # ids que deben terminar antes
  [int]$Priority = 5,                    # menor = antes
  [string]$Account = ''                  # codex: fijar una cuenta (A, B…); vacío = drain elige la libre
)
$ErrorActionPreference = 'Stop'
$harness = Split-Path $PSScriptRoot -Parent
$cfg = Get-Content (Join-Path $harness 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$bp = if ($cfg.paths -and $cfg.paths.brief) { $cfg.paths.brief } else { '.harness/runs/{id}/brief.md' }
$bp = $bp -replace '\{id\}', $Id
if (-not (Test-Path (Join-Path (Split-Path $harness -Parent) $bp))) { throw "Falta el brief $bp" }
$qDir = Join-Path $harness 'queue'; New-Item -ItemType Directory -Force $qDir | Out-Null
$t = [ordered]@{
  id = $Id; engine = $Engine; model = $Model; effort = $Effort; write = [bool]$Write; worktree = [bool]$Worktree
  files = @($Files | ForEach-Object { $_ -split ',' } | Where-Object { $_ }); after = @($After | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
  priority = $Priority; status = 'pending'; added = (Get-Date).ToString('s'); attempts = 0; outcome = ''; account = $Account
}
[IO.File]::WriteAllText((Join-Path $qDir "$Id.json"), ($t | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding $false))
"encolada $Id [$Engine/$Model] after=$($t.after -join ',') files=$($t.files -join ',')"
