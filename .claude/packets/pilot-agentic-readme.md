## Tarea
pilot-agentic-readme · capa: L2 · riesgo: bajo

## Objetivo
Crear `tools/agentic/README.md` que documente cómo usar `tools/agentic/codex-task.ps1` (parámetros, worktree, logs, reglas) para que cualquier persona del equipo pueda lanzar una tarea Codex.

## Criterios de aceptación (verificables)
- [ ] Existe `tools/agentic/README.md` en español, máximo 80 líneas.
- [ ] Documenta cada parámetro del script (`Task`, `Packet`, `Base`, `Model`, `Effort`, `Resume`, `ReadOnly`) leyendo el bloque `param(...)` real del script.
- [ ] Explica dónde quedan worktree (`C:\tmp\sr-wt\<task>`), rama (`codex/<task>`) y logs (`.claude/runs/<task>/`).
- [ ] Incluye un ejemplo de invocación y la lista de prohibiciones (push, merge, Supabase remoto, migraciones existentes).
- [ ] Un commit local con mensaje `docs: document codex task runner`.

## Archivos de entrada
- tools/agentic/codex-task.ps1 (completo, ~90 líneas): fuente de verdad de los parámetros.
- docs/templates/CONTEXT_PACKET.md: formato del paquete que recibe el script.

## Símbolos relevantes
| Archivo | Símbolo | Por qué importa |
|---|---|---|
| tools/agentic/codex-task.ps1 | bloque `param(...)` | nombres y defaults exactos |

## Invariantes que NO deben cambiar
- No modificar el script ni ningún otro archivo; sólo crear el README.

## Fuera de alcance
- Cambios al script, a AGENTS.md o a cualquier código.

## Verificación
- `git status --short` debe listar únicamente `tools/agentic/README.md`.
- `git log --oneline -1` debe mostrar el commit.

## Formato de salida esperado
1. Resumen de 3 líneas.
2. Archivos tocados.
3. Salida literal de `git status --short` y `git log --oneline -1`.
