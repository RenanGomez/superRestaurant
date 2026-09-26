## Tarea
auditor-agentic-tab · ronda 2 · capa: L2 · riesgo: bajo

## Contexto
La ronda 1 fue aprobada por el reviewer (seguridad, privacidad, tests). El orquestador verificó la pestaña en navegador real contra el repositorio superRestaurant y encontró tres defectos de exactitud/UX. Corrige sólo esto, en el mismo worktree, sin tocar la seguridad del endpoint.

## Criterios de aceptación (verificables)
- [ ] Costo por origen: las sesiones `Codex` usan la cuenta ChatGPT Plus (sin costo por uso). La columna COSTO debe mostrar `Plan Plus` para Codex y sólo estimar USD para Claude Code. Añade en `src/agents.mjs` una tabla `RATES` por origen (`claude`: 3/15/0.30 por millón; `codex`: null) y en la UI el texto explicativo debe decir que Codex no se factura por token.
- [ ] Herramientas de Codex: la mayoría de sesiones Codex muestran 0 herramientas aunque tienen decenas de llamadas. Inspecciona un archivo real reciente de `%USERPROFILE%\.codex\sessions\2026\09\26\*.jsonl` (sólo los primeros 60 registros; no copies contenido a fixtures) y cuenta todos los tipos de llamada que emite Codex (`function_call`, `custom_tool_call`, `local_shell_call`, `tool_use`, `mcp_tool_call` u otros que veas), agrupando por nombre. Actualiza `test/fixtures/codex.jsonl` con registros sintéticos de cada tipo y una prueba que los cuente.
- [ ] Detalle de sesión: al hacer clic en una fecha de la tabla, la vista se desplaza a `#agent-N` pero la pantalla queda en blanco (el contenedor de detalle no se ve). Reproduce con `node ./src/cli.mjs open --root "C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant" --no-browser` y corrige el layout/CSS (probablemente altura o `overflow` del `main`) para que el detalle (herramientas, archivos, subagentes, timeline) sea visible bajo la tabla. Añade un botón «Volver a la tabla».
- [ ] Sesiones sin tokens (0 in / 0 out) se muestran al final con la etiqueta `sin uso` en lugar de mezclarse.
- [ ] `npm test` en verde con las pruebas nuevas; `git diff --check` limpio.

## Archivos de entrada
- C:\tmp\sr-wt\auditor-agentic-tab\src\agents.mjs (completo)
- C:\tmp\sr-wt\auditor-agentic-tab\public\app.js (funciones renderAgents / agentDetail / loadAgents)
- C:\tmp\sr-wt\auditor-agentic-tab\public\styles.css (clases agents-*)
- C:\tmp\sr-wt\auditor-agentic-tab\test\agents.test.mjs y test\fixtures\*.jsonl

## Invariantes que NO deben cambiar
- Sin dependencias nuevas; sin red salvo el toggle ccusage; nunca renderizar contenido de mensajes, prompts ni secretos.
- El gate de sesión, Host/Origin y los límites de 20 MB/200 sesiones se conservan.
- Las fixtures siguen siendo sintéticas.

## Fuera de alcance
- Gráficas, exportación, otros orígenes de agentes.

## Verificación
- npm test
- node ./src/cli.mjs open --root "C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant" --no-browser (arranca, imprime URL, Ctrl+C)

## Formato de salida esperado
1. Resumen. 2. Archivos tocados. 3. Salida literal de `npm test`. 4. Lista de tipos de llamada Codex encontrados y cómo se cuentan. 5. Riesgos.
