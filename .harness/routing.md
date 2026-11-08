# routing — qué motor, modelo y razonamiento (v4)

Los nombres de modelo viven en `config.json` (alias). Usa alias.

> **dsh desactivado temporalmente** (`config.dsh.enabled: false`, sin saldo en OpenRouter). Mientras siga así,
> no uses `-Engine dsh`: código → codex (default/low; strong/medium en bugs) y lo demás → gemini. Si algo se
> encola como dsh igualmente, agent.ps1 lo pasa a codex. Las tablas de abajo aplican cuando vuelva a `true`.

**Motores:**
- **gemini** (Antigravity): cuota abundante y gratis.
- **dsh** (DeepSeek Harness → OpenRouter): sin cuota de 5 h; se paga por token y es muy barato. **Es el motor de
  código por defecto.**
- **codex** (una cuenta, B): cuota escasa. Solo para lo que dsh no resolvió o lo que necesita su sandbox.
- **Claude**: orquesta. No es worker salvo `claude -p` como último recurso.

## Modelos de dsh (alias → modelo, US$/M tokens entrada/salida)
| Alias | Modelo | Precio | Para qué |
|---|---|---|---|
| `fast` | qwen3.7-flash | 0.03 / 0.13 | leer, resumir, docs, "¿dónde está X?", ediciones triviales |
| `default` | **deepseek-v4.1-flash-1017** | 0.15 / 0.60 | **casi todo el código**: tests, features, bugs normales, refactors, boilerplate |
| `strong` | deepseek-v4-pro-0813 | 0.11 / 4.44 | features grandes, bugs difíciles, diseño dentro de un módulo |
| `max` | kimi-k3.1-pro | 2 / 10 | solo escalado: lo que `strong` no resolvió |
| `review` | glm-5.3 | 0.07 / 1.40 | revisar diffs de DeepSeek (otra familia de modelos detecta otros errores) |
| `vision` | qwen3.8-omni-flash | 0.15 / 0.47 | capturas, UI, imágenes |

## Qué usar según la tarea
| Tarea | 1º | Si falla o no hay cuota |
|---|---|---|
| Mapa del repo, auditoría, "¿dónde está X?" | gemini fast (+ `context/map.md`) | dsh fast |
| Docs, changelog, comentarios | gemini fast | dsh fast |
| Tests, boilerplate, renombrados, ediciones mecánicas | **dsh default `-Write`** | gemini default `-Write` |
| Feature acotada | **dsh default `-Write`** | dsh strong → codex default/low |
| Bug difícil, concurrencia, rendimiento | **dsh strong** | dsh max → codex strong/medium |
| Revisión de diff | dsh review (si escribió dsh) · gemini strong (si escribió codex) · dsh default (si escribió gemini) | subagente sonnet |
| UI, capturas, assets visuales | dsh vision | gemini strong |
| Investigación web / comparar librerías | gemini strong | Claude (WebSearch) |
| Diseño, decisiones con trade-offs, integración | Claude sesión principal | — |
| Depende del contexto de esta conversación | subagente Claude (fork) sonnet | sesión principal |

**Velocidad:** dsh admite varias tareas a la vez. Parte el trabajo en tareas pequeñas con `-Files` disjuntos y
encólalas juntas: drain corre hasta `queue.maxParallel` (4) en paralelo.

**Tareas encoladas como codex:** usan la cuenta B; si B ya está ocupada en la ola o sin cuota, las hace dsh
(`codex.fallback`, alias mapeado: fast/default → default, strong → strong). No hace falta encolarlas distinto.

## Presupuesto
- Esfuerzo: dsh y codex en `low` (o vacío) por defecto; `medium` en bugs; `high` solo en un reintento.
- Escalado: si el result viene incompleto o mal, **un** reintento un nivel arriba (fast → default → strong → max) con
  feedback concreto añadido al mismo brief y el mismo `-Id`. Si falla de nuevo: codex, y luego al usuario.
- Opus no se usa como worker.
- Un run = una tarea pequeña con criterio de "hecho". El coste crece con turnos × contexto, así que briefs que digan
  qué archivos tocar y citen `.harness/context/map.md` en vez de pedir explorar.
- dsh cuesta dinero: `max` solo en escalado. El límite de gasto se pone en la clave de openrouter.ai.
