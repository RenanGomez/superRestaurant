# routing — qué motor, modelo y razonamiento (v2)

Los nombres de modelo viven en `config.json` (alias `fast` / `default` / `strong`). Usa alias.

**Principio:** la cuota de Codex es la más escasa (5 h que pueden durar minutos); la de Antigravity sobra.
Codex solo para lo que exige sandbox real de escritura o depuración dura. Todo lo demás, Antigravity primero.
"encolar" = dejar la tarea `pending` para que drain la lance al reset, no hacerla en Claude.

| Tarea | 1º | Si el 1º está en cooldown |
|---|---|---|
| Mapa del repo, auditoría, "¿dónde está X?" | gemini fast (+ `context/map.md`) | subagente haiku |
| Docs, changelog, comentarios | gemini fast | encolar |
| Tests nuevos, boilerplate, renombrados, ediciones mecánicas | **gemini default `-Write`** (+`-Worktree` si las rutas están commiteadas) | codex fast/low |
| Feature acotada | codex default/low | gemini strong `-Write` (ídem) |
| Bug difícil, concurrencia, rendimiento | codex strong/medium | encolar |
| Revisión de diff | gemini strong (si escribió codex) · codex default/low (si escribió gemini) | subagente sonnet |
| Investigación web / comparar librerías | gemini strong | Claude (WebSearch) |
| Diseño, decisiones con trade-offs, integración | Claude sesión principal | — |
| Depende del contexto de esta conversación | subagente Claude (fork) sonnet | sesión principal |

## Presupuesto
- Esfuerzo de codex: `low` por defecto; `medium` solo en la fila de bugs; `high` solo en un reintento.
- Escalado: si el result viene incompleto o mal, **un** reintento un nivel arriba (fast→default→strong,
  low→medium→high) con feedback concreto añadido al mismo brief y el mismo `-Id`. Un segundo fallo → al usuario.
- Un run = una tarea pequeña con criterio de "hecho". Nada de "revisa todo el proyecto" a codex: el coste de
  codex crece con los turnos × el contexto, así que tareas cortas y briefs que digan qué archivos tocar.
- Contexto de proyecto: los briefs citan `.harness/context/map.md` en vez de pedir explorar. Si el mapa tiene
  más de ~2 semanas o el cambio es estructural, regenerarlo (`bin/map.ps1`).
