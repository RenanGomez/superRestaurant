# routing — qué motor, modelo y razonamiento (v4)

Los nombres de modelo viven en `config.json` (alias). Usa alias.

> **dsh corre con la suscripción OpenCode Go** (`config.dsh.provider: opencodego`, US$10/mes con cupo por modelo,
> sin pago por token). Con `provider: openrouter` vuelve a pagar por token con `config.dsh.models`.

**Motores:**
- **gemini** (CLI `agy`): cuota abundante y gratis. **Escribe código** (UI, visual, piezas medianas) además de leer y revisar.
- **dsh** (DeepSeek Harness → OpenCode Go): cupo mensual amplio y límites de 5 h altos; varios a la vez. Tareas
  pequeñas y mecánicas.
- **codex** (cuenta B): cuota suficiente, **motor de código normal**: piezas difíciles, bugs, lógica con estado.
**Los tres escriben en paralelo. Una ola que deja ocioso a un motor desperdicia cuota pagada.**
- **Claude**: orquesta. No es worker salvo `claude -p` como último recurso.

## Modelo de dsh (OpenCode Go)
**Solo `deepseek-v4.1-flash`.** Todos los alias apuntan a él: no pases `-Model` a dsh. Lo único que se ajusta es
`-Effort` (`low` por defecto, `medium` en bugs o en el reintento). dsh no ve imágenes.

## Reparto obligatorio: los tres motores en cada ola
- Claude no escribe código que pueda escribir un motor.
- **Con ≥3 tareas en un pedido, cada motor (dsh, codex, gemini) recibe al menos una que escriba código.** Con 2,
  van a dos motores distintos. Nunca todo a dsh.
- Reparto: **codex** → bugs difíciles, red/sincronización, estado, lógica con riesgo · **gemini** → UI, visual,
  assets, piezas medianas con contexto amplio · **dsh** → tests, mecánico, piezas pequeñas (varias en paralelo).
- Revisión cruzada: el diff de un motor lo revisa otro (gemini o codex revisan a dsh; dsh o gemini a codex).
- Si una tarea falla, el reintento va a otro motor, no al mismo dos veces.
- Antes de lanzar la ola, Claude escribe en una línea el reparto ("codex: A · gemini: B · dsh: C, D").

## Qué usar según la tarea
| Tarea | 1º | Si falla |
|---|---|---|
| Mapa del repo, auditoría, "¿dónde está X?", docs | gemini fast (+ `context/map.md`) | dsh (sin `-Write`) |
| Tests, boilerplate, renombrados, ediciones mecánicas | **dsh `-Write`** | gemini default `-Write` |
| Feature acotada (1–3 archivos) | dsh o gemini `-Write` (el que esté libre en la ola) | el otro, luego codex |
| Feature grande | **piezas repartidas entre codex, gemini y dsh en paralelo** (`-Files` disjuntos); el contrato entre piezas lo fija Claude en los briefs | la pieza que falló, a otro motor |
| Bug difícil, concurrencia, red, rendimiento | **codex default/medium** (brief con el fragmento exacto y cómo reproducir) | codex strong → dsh `-Effort medium` |
| Revisión de diff | gemini strong si escribió dsh (otra familia) · dsh si escribió codex o gemini | subagente sonnet |
| UI, capturas, assets visuales | gemini strong | — |
| Investigación web / comparar librerías | gemini strong | Claude (WebSearch) |
| Diseño, decisiones con trade-offs, integración | Claude sesión principal | — |
| Depende del contexto de esta conversación | subagente Claude (fork) sonnet | sesión principal |

## Rápido: cómo partir un pedido
1. Una ola por pedido: encola juntas todas las tareas independientes y lanza **un** `drain -Wait` en background.
   drain corre hasta `queue.maxParallel` (6) a la vez: dsh varias, gemini hasta 3, codex 1 por cuenta.
2. Tareas dsh pequeñas: **1–3 archivos, un objetivo, un "hecho cuando"**. Mejor 3 tareas de 5 min que una de 30.
3. Mientras dsh escribe, gemini mapea o revisa en la misma ola; lo que depende de otra tarea va con `-After`.
4. `-Worktree` solo si dos escritores tocarían lo mismo o el cambio es arriesgado; si no, `-Files` disjuntos en la
   carpeta del proyecto (más rápido, sin fusionar ramas).

## Eficiente: briefs que no queman cupo
- Di **qué archivos tocar** y pega el fragmento relevante (función, firma, error) o cita `map.md §N`; nunca "explora el
  repo". Flash gasta turnos buscando lo que no le dices.
- Contexto mínimo: sin AGENTS.md copiado, sin la conversación, sin archivos enteros de más de ~200 líneas.
- `-Effort low` por defecto; `medium` solo en bugs o reintento; `high` nunca en dsh.
- Un reintento por tarea, con feedback concreto en el mismo brief y el mismo `-Id`, en otro motor. Luego el usuario.

## Certero: que lo hecho sea correcto
- "Hecho cuando" verificable: un comando (test, build, script) cuya salida real va en el result. Sin evidencia →
  `unverified`, no se acepta.
- Flash puede afirmar con seguridad cosas falsas: todo `-Write` de dsh de más de ~20 líneas lo revisa gemini strong
  (o un subagente sonnet) antes de darlo por bueno; lo trivial lo revisa Claude con `git diff`.
- Firmas, nombres y rutas exactos en el brief: dsh no debe adivinar APIs del proyecto.
- Tras integrar una ola, correr los tests del proyecto una vez (no por cada tarea).

**Tareas encoladas como codex:** usan la cuenta B; si B ya está ocupada en la ola o sin cuota, las hace dsh
(`codex.fallback`). No hace falta encolarlas distinto.

## Presupuesto
- Cupo Go de Flash: $100/mes y ~43k peticiones cada 5 h; el restante se ve en la consola de opencode.ai.
- Esfuerzo: dsh y codex en `low` por defecto; `medium` en bugs; `high` solo en un reintento de codex.
- Opus no se usa como worker.

## Cuota de Claude (orquestador y subagentes)
El coste crece con turnos × contexto: un turno con 900k cuesta como ~20 con 40k.
- **Contexto acotado:** la compactación automática (200k) resume y sigue; no pedir conversación nueva.
  Al aviso del hook, actualizar `HANDOFF.md` en pocas líneas.
- **Modelo por tarea:** Opus solo para diseño, trade-offs e integración. Bucles de probar/revisar/corregir,
  lecturas y búsquedas → subagente `sonnet` o `haiku` (parámetro `model` del Agent).
- **Fork solo si hace falta la conversación:** por defecto subagente fresco con brief corto; un fork hereda
  todo el contexto y lo paga en cada turno.
- **Capturas e imágenes:** no leerlas en la sesión principal (se quedan en el contexto para siempre). Las revisa
  un subagente o el motor `vision`/gemini y devuelve texto. Si Claude debe mirar una, reducida a ~800 px.
- **Esfuerzo de codex:** `low` por defecto, `medium` en bugs; `high` solo en reintento (mismo `-Id`):
  agent.ps1 baja a `config.codex.maxEffort` (medium) cualquier `high` que no sea reintento.
- **App de Codex:** comparte cuenta con el harness. En la app, modelo terra por defecto; nada de subagentes de la app
  para trabajo que pueda ir encolado.
- **Menos turnos:** agrupar comandos en una llamada; nada de `sleep` ni sondeos (drain `-Wait` en background avisa).

## Limpieza (todo brief a un motor)
Añadir al brief: "Si levantas un servidor, puerto, watcher o proceso en background para probar, ciérralo antes de
entregar el informe. Si el usuario debe probarlo abierto, regístralo con `.harness/bin/open.ps1 -Add -ProcId <pid>
-Port <p> -What <qué> -Keep <motivo>` y dilo en el informe." drain.ps1 mata al final lo que quede sin keep.
