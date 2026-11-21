# routing — qué motor, modelo y razonamiento (v4)

Los nombres de modelo viven en `config.json` (alias). Usa alias.

> **dsh corre con la suscripción OpenCode Go** (`config.dsh.provider: opencodego`, US$10/mes con cupo por modelo,
> sin pago por token). Con `provider: openrouter` vuelve a pagar por token con `config.dsh.models`.

**Motores:**
- **gemini** (Antigravity): cuota abundante y gratis.
- **dsh** (DeepSeek Harness → OpenCode Go): cupo mensual amplio y límites de 5 h altos. **Es el motor de código por defecto.**
- **codex** (una cuenta, B): cuota escasa. Solo para lo que dsh no resolvió o lo que necesita su sandbox.
- **Claude**: orquesta. No es worker salvo `claude -p` como último recurso.

## Modelo de dsh (OpenCode Go)
**Solo `deepseek-v4.1-flash`.** Todos los alias apuntan a él: no pases `-Model` a dsh. Lo único que se ajusta es
`-Effort` (`low` por defecto, `medium` en bugs o en el reintento). dsh no ve imágenes.

## dsh es obligatorio (igual que codex y Antigravity)
- **Todo código nuevo o editado lo intenta dsh primero**, salvo las excepciones de la tabla (imágenes/UI visual,
  lo que exige el sandbox de codex, diseño/integración). Claude no escribe código que pueda escribir dsh.
- Ninguna tarea de código va a codex sin que dsh la haya intentado una vez (con su reintento a `medium`).
- En cada pedido con código se reparte en paralelo: **dsh escribe, gemini lee/mapea/revisa, codex solo escala.**

## Qué usar según la tarea
| Tarea | 1º | Si falla |
|---|---|---|
| Mapa del repo, auditoría, "¿dónde está X?", docs | gemini fast (+ `context/map.md`) | dsh (sin `-Write`) |
| Tests, boilerplate, renombrados, ediciones mecánicas | **dsh `-Write`** | gemini default `-Write` |
| Feature acotada (1–3 archivos) | **dsh `-Write`** | dsh `-Effort medium` (mismo `-Id`) → codex default/low |
| Feature grande | **varias tareas dsh `-Write` en paralelo** (`-Files` disjuntos); el contrato entre piezas lo fija Claude en los briefs | codex default/low solo la pieza que falló |
| Bug difícil, concurrencia, rendimiento | **dsh `-Effort medium`** (brief con el fragmento exacto y cómo reproducir) | codex default/medium → codex strong |
| Revisión de diff | gemini strong si escribió dsh (otra familia) · dsh si escribió codex o gemini | subagente sonnet |
| UI, capturas, assets visuales | gemini strong | — |
| Investigación web / comparar librerías | gemini strong | Claude (WebSearch) |
| Diseño, decisiones con trade-offs, integración | Claude sesión principal | — |
| Depende del contexto de esta conversación | subagente Claude (fork) sonnet | sesión principal |

## Rápido: cómo partir un pedido
1. Una ola por pedido: encola juntas todas las tareas independientes y lanza **un** `drain -Wait` en background.
   drain corre hasta `queue.maxParallel` (4) a la vez; dsh admite varias simultáneas.
2. Tareas dsh pequeñas: **1–3 archivos, un objetivo, un "hecho cuando"**. Mejor 3 tareas de 5 min que una de 30.
3. Mientras dsh escribe, gemini mapea o revisa en la misma ola; lo que depende de otra tarea va con `-After`.
4. `-Worktree` solo si dos escritores tocarían lo mismo o el cambio es arriesgado; si no, `-Files` disjuntos en la
   carpeta del proyecto (más rápido, sin fusionar ramas).

## Eficiente: briefs que no queman cupo
- Di **qué archivos tocar** y pega el fragmento relevante (función, firma, error) o cita `map.md §N`; nunca "explora el
  repo". Flash gasta turnos buscando lo que no le dices.
- Contexto mínimo: sin AGENTS.md copiado, sin la conversación, sin archivos enteros de más de ~200 líneas.
- `-Effort low` por defecto; `medium` solo en bugs o reintento; `high` nunca en dsh.
- Un reintento por tarea, con feedback concreto en el mismo brief y el mismo `-Id`. Luego codex, y luego el usuario.

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
