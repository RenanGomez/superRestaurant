# Ejecutor de tareas Codex (L2)

`codex-task.ps1` ejecuta un paquete de contexto en un worktree Git dedicado. Prepara el paquete con el formato de [`docs/templates/CONTEXT_PACKET.md`](../../docs/templates/CONTEXT_PACKET.md): objetivo, criterios de aceptación, archivos de entrada, invariantes, alcance, verificaciones y salida esperada. Ejecútalo desde el repositorio en PowerShell, con sesión iniciada en Codex CLI y sin `OPENAI_API_KEY` definida.

```powershell
.\tools\agentic\codex-task.ps1 -Task s5-catalog-ui -Packet .\.claude\packets\s5-catalog-ui.md -Base main -Effort medium
```

## Parámetros

| Parámetro | Uso |
| --- | --- |
| `-Task` | Obligatorio. Nombre corto en minúsculas y guiones: empieza con letra o dígito y tiene de 3 a 41 caracteres. Determina worktree, rama y carpeta de logs. |
| `-Packet` | Obligatorio. Ruta a un archivo existente con el paquete de contexto; el script lee su contenido completo como prompt. |
| `-Base` | Referencia Git de partida para una rama nueva; predeterminado: `main`. No cambia un worktree ya existente. |
| `-Model` | Modelo de Codex CLI; predeterminado: cadena vacía, por lo que se usa el modelo configurado en CLI. |
| `-Effort` | Esfuerzo de razonamiento: `low`, `medium` o `high`; predeterminado: `medium`. Se aplica al inicio de una tarea, pero el script no lo pasa a `exec resume`. |
| `-Resume` | Continúa el hilo guardado en `thread-id.txt`, si existe. Sin ese archivo, inicia una ejecución nueva. |
| `-ReadOnly` | Cambia el sandbox de `workspace-write` (predeterminado) a `read-only`; útil para inspecciones sin escritura. |

## Archivos y ejecución

- Worktree: `C:\tmp\sr-wt\<task>`; rama: `codex/<task>`. El script crea ambos desde `-Base` cuando no existen; reutiliza un worktree existente.
- Logs en `<raíz-del-repositorio>/.claude/runs/<task>/`: `<fecha>.events.jsonl` contiene eventos, `<fecha>.last.md` el último mensaje y `thread-id.txt` el identificador para `-Resume` cuando está disponible.
- El script ejecuta `codex exec` sin interacción, con aprobaciones `never`, Node 24 y el sandbox seleccionado. Al terminar muestra el último mensaje, `git status --short` del worktree y el código de salida.
- Cada paquete corresponde a una tarea y un escritor. Incluye los comandos exactos de verificación y exige pegar su salida literal. Los commits locales deben ser pequeños y seguir conventional commits.

## Prohibiciones

- No hacer `git push`, `merge` ni `rebase`.
- No tocar Supabase remoto ni editar migraciones existentes.
- No editar `TODO.md`, `HANDOFF.md` ni `PROJECT_NOTES.md` desde la tarea L2.
