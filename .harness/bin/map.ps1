<#
.SYNOPSIS
  Genera el mapa del proyecto que citan los briefs:
  1) repomix --compress empaqueta el repo (respeta .gitignore) en .harness/context/repo.md (no se versiona).
  2) Antigravity (gemini, cuota barata) lo lee y escribe .harness/context/map.md (≤300 líneas).
  Los motores leen map.md en vez de explorar el repo en cada run.
.EXAMPLE
  powershell -NoProfile -File .harness/bin/map.ps1            # pack + resumen con gemini
  powershell -NoProfile -File .harness/bin/map.ps1 -PackOnly  # solo el pack
#>
param([switch]$PackOnly, [string]$Model = 'default',
      [int]$MaxTokens = 400000)          # presupuesto del pack: Gemini lee ~1M, deja margen para razonar
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$harness = Split-Path $PSScriptRoot -Parent
$root    = Split-Path $harness -Parent
$ctx     = Join-Path $harness 'context'; New-Item -ItemType Directory -Force $ctx | Out-Null
$pack    = Join-Path $ctx 'repo.md'
# config.map.ignore: patrones extra del proyecto (p. ej. carpetas de datos o herramientas ajenas)
$cfgMap  = (Get-Content (Join-Path $harness 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json).map

Push-Location $root
try {
  # repomix global (npm i -g repomix); si falta, vía npx
  [string[]]$rx = if (Get-Command repomix -ErrorAction SilentlyContinue) { @('repomix') } else { @('npx', '-y', '--package=repomix', 'repomix') }
  & $rx[0] @($rx | Select-Object -Skip 1) --compress --remove-empty-lines --style markdown -o $pack `
    --ignore ('.harness/**,.agents/**,**/*.lock,**/package-lock.json,**/*.min.*,**/dist/**,**/build/**,' +
              '**/.tmp/**,**/tmp/**,**/temp/**,**/logs/**,**/*.log,**/*.out,**/*.bak*,**/*.before*,**/*.orig,' +
              '**/*.csv,**/*.tsv,**/*.svg,**/*.map,**/.godot/**,**/*.import,**/*.tscn,**/*.tres,' +
              '**/cache/**,**/.cache/**,**/__pycache__/**,**/screenshots/**,**/recordings/**,**/*.patch,**/*.uid' +
              $(if ($cfgMap.ignore) { ',' + ($cfgMap.ignore -join ',') } else { '' })) 2>&1 |
    Select-String 'Total (Files|Tokens)|error' | ForEach-Object { $_.Line.Trim() }
} finally { Pop-Location }
if (-not (Test-Path $pack)) { throw 'repomix no generó el pack' }

# Recorte al presupuesto: se quitan los archivos más grandes (suelen ser datos, no lógica) y se listan como omitidos
$text  = [IO.File]::ReadAllText($pack, $utf8)
$parts = [regex]::Split($text, '(?m)^(?=## File: )')
$head  = $parts[0]; $files = @($parts | Select-Object -Skip 1)
$budget = $MaxTokens * 3.5                # ~3,5 caracteres por token
$total  = ($files | Measure-Object -Property Length -Sum).Sum + $head.Length
# código → esquema de declaraciones (repomix no comprime todos los lenguajes, p. ej. GDScript); datos → omitidos
$decl = '^\s*(@?export|static|async|public|private|protected|internal|pub|func|fn|def|class|class_name|extends|signal|enum|const|interface|type|struct|impl|trait|function|module|namespace|@onready|var\s+\w+\s*:)\b'
$isCode = '\.(gd|py|js|jsx|ts|tsx|cs|java|kt|go|rs|rb|php|swift|dart|c|cc|cpp|h|hpp|lua|gdshader)$'
$byName = [ordered]@{}; foreach ($f in $files) { $byName[[regex]::Match($f, '^## File: (.+)').Groups[1].Value.Trim()] = $f }
$outlined = @(); $dropped = @()
foreach ($name in @($byName.Keys | Sort-Object { -$byName[$_].Length })) {
  if ($total -le $budget) { break }
  $f = $byName[$name]; $total -= $f.Length
  if ($name -match $isCode) {
    $o = ($f -split "`n" | Select-Object -Skip 1 | Where-Object { $_ -match $decl } | Select-Object -First 400) -join "`n"
    $fence = '```'
    $byName[$name] = "## File: $name`n(esquema: solo declaraciones; archivo completo ~$([int]($f.Length / 3500))k tokens)`n$fence`n$o`n$fence`n`n"
    $total += $byName[$name].Length; $outlined += $name
  } else { $byName.Remove($name); $dropped += "$name (~$([int]($f.Length / 3500))k tokens)" }
}
if ($outlined -or $dropped) {
  $note = "## Archivos recortados por tamaño`n" +
    (($outlined | ForEach-Object { "- $_ — solo esquema" }) + ($dropped | ForEach-Object { "- $_ — omitido (datos)" }) -join "`n") + "`n`n"
  [IO.File]::WriteAllText($pack, $head + $note + (@($byName.Values) -join ''), $utf8)
}
"Pack final: ~$([int]($total / 3500))k tokens; $($outlined.Count) archivos a esquema, $($dropped.Count) omitidos"
if ($PackOnly) { "pack: $pack"; exit 0 }

$id = 'map'
$cfg = Get-Content (Join-Path $harness 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$bp  = if ($cfg.paths -and $cfg.paths.brief) { $cfg.paths.brief } else { '.harness/runs/{id}/brief.md' }
$bf  = Join-Path $root (($bp -replace '\{id\}', $id) -replace '/', '\')
New-Item -ItemType Directory -Force (Split-Path $bf) | Out-Null
$rel = '.harness/context'
[IO.File]::WriteAllText($bf, @"
# Brief $id

## Objetivo
Escribir ``$rel/map.md``: el mapa del proyecto que leerán otros agentes en lugar de explorar el código.

## Alcance
- Lee SOLO ``$rel/repo.md`` (el repo empaquetado y comprimido); no abras otros archivos.
- Único archivo que puedes escribir: ``$rel/map.md`` (además del informe). Nada más.

## Contenido de map.md (máximo 300 líneas, telegráfico, sin código copiado salvo firmas clave)
1. Propósito del proyecto y stack (lenguajes, frameworks, versiones).
2. Árbol de carpetas relevante con una línea por carpeta/archivo importante.
3. Módulos: responsabilidad, archivos, símbolos/entry points principales, de qué dependen.
4. Flujos clave (request → respuesta, arranque, build) en pasos cortos.
5. Comandos: instalar, ejecutar, tests, lint, build.
6. Convenciones observadas (nombres, estructura, estilo de tests) y zonas frágiles.
Cada sección con encabezado ``## N. Título`` para que los briefs puedan citar "map.md §3".

## Hecho cuando
- ``$rel/map.md`` existe, ≤300 líneas, cubre las 6 secciones.
"@, $utf8)
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'agent.ps1') -Engine gemini -Id $id -Model $Model -Write
