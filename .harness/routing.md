# routing — qué motor, modelo y razonamiento (v3)

Los nombres de modelo viven en `config.json` (alias `fast` / `default` / `strong`). Usa alias.

**Motores disponibles:** Antigravity (gemini, cuota abundante), Codex con **una sola cuenta** (B, cuota escasa: 5 h
que pueden durar minutos) y Claude CLI como **respaldo automático de Codex** (`config.codex.fallback`).
Codex solo para lo que exige sandbox real de escritura o depuración dura. Todo lo demás, Antigravity primero.

**Respaldo:** una tarea encolada como `codex` la hace Claude (`claude -p`) cuando Codex no tiene cuota, con el
modelo mapeado (fast→haiku, default→sonnet, strong→sonnet). No hace falta encolarla distinto: drain y agent.ps1
cambian solos. Claude gasta la misma cuota que el orquestador: por eso solo entra cuando Codex está agotado
(`fallback.parallel: true` lo usa además como carril extra). Si Claude también está sin cuota, la tarea espera
el primer reset.

| Tarea | 1º | Si el 1º está sin cuota |
|---|---|---|
| Mapa del repo, auditoría, "¿dónde está X?" | gemini fast (+ `context/map.md`) | subagente haiku |
| Docs, changelog, comentarios | gemini fast | encolar |
| Tests nuevos, boilerplate, renombrados, ediciones mecánicas | **gemini default `-Write`** (+`-Worktree` si las rutas están commiteadas) | codex fast/low → claude haiku |
| Feature acotada | codex default/low | → claude sonnet (automático) · o gemini strong `-Write` |
| Bug difícil, concurrencia, rendimiento | codex strong/medium | → claude sonnet (automático) |
| Revisión de diff | gemini strong (si escribió codex/claude) · codex default/low (si escribió gemini) | subagente sonnet |
| Investigación web / comparar librerías | gemini strong | Claude (WebSearch) |
| Diseño, decisiones con trade-offs, integración | Claude sesión principal | — |
| Depende del contexto de esta conversación | subagente Claude (fork) sonnet | sesión principal |

## Presupuesto
- Esfuerzo de codex: `low` por defecto; `medium` solo en la fila de bugs; `high` solo en un reintento.
- Opus no se usa como worker: es para el orquestador. Los workers Claude van en haiku o sonnet.
- Escalado: si el result viene incompleto o mal, **un** reintento un nivel arriba (fast→default→strong,
  low→medium→high) con feedback concreto añadido al mismo brief y el mismo `-Id`. Un segundo fallo → al usuario.
- Un run = una tarea pequeña con criterio de "hecho". Nada de "revisa todo el proyecto": el coste crece con los
  turnos × el contexto, así que tareas cortas y briefs que digan qué archivos tocar.
- Contexto de proyecto: los briefs citan `.harness/context/map.md` en vez de pedir explorar. Si el mapa tiene
  más de ~2 semanas o el cambio es estructural, regenerarlo (`bin/map.ps1`).
