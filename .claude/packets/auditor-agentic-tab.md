## Tarea
auditor-agentic-tab · capa: L2 · riesgo: bajo

## Objetivo
Añadir una nueva pestaña "Agentes" al auditor que visualice trabajo agentic desde transcripts JSONL locales: por sesión (tokens input/output/cache, costo estimado, herramientas usadas con conteos, archivos tocados, subagentes generados, timeline). Soportar Claude Code y Codex leyendo SOLO archivos transcript locales; opción toggle de ccusage sin dependencia obligatoria.

## Criterios de aceptación (verificables)
- [ ] Nueva pestaña "Agentes" visible en navbar entre "Actividad" y "Configuración"
- [ ] Endpoint GET /api/agents implementado en src/server.mjs siguiendo patrón existente (session token, Host/Origin)
- [ ] Parseo de JSONL funciona para Claude Code (%USERPROFILE%\.claude\projects\<slug>\*.jsonl) y Codex (%USERPROFILE%\.codex\sessions\YYYY\MM\DD\*.jsonl)
- [ ] UI muestra: lista de sesiones con fecha, tokens (in/out/cache), costo estimado, tabla de herramientas (nombre + count), archivos trazables, subagentes si existen
- [ ] Toggle "usar ccusage" ejecuta npx ccusage session --json y compara con parser nativo sin romper
- [ ] Nunca renderiza contenido de mensajes ni secretos, solo agregados y nombres
- [ ] Estilo sigue CSS vars de styles.css (colores, badges, paneles, tablas)
- [ ] Test en test/agents.test.mjs con fixtures JSONL bajo test/fixtures/
- [ ] `npm test` pasa; `npm run start` abre UI sin errores

## Archivos de entrada
- C:\Users\Emmanuel G\Documents\ChatGPT\project-doc-auditor\src\server.mjs (líneas 16-107): patrón HTTP, rutas, validación session/origin/CORS
- C:\Users\Emmanuel G\Documents\ChatGPT\project-doc-auditor\src\core.mjs (líneas 1-30): exportaciones y pattern de módulos
- C:\Users\Emmanuel G\Documents\ChatGPT\project-doc-auditor\src\repository.mjs (líneas 1-35, 109-120): clase ProjectRepository, método snapshot()
- C:\Users\Emmanuel G\Documents\ChatGPT\project-doc-auditor\public\app.js (líneas 1-55): manejo de vistas, estado, API
- C:\Users\Emmanuel G\Documents\ChatGPT\project-doc-auditor\public\styles.css (líneas 1-100): CSS var tokens, badges, paneles, layout
- C:\Users\Emmanuel G\Documents\ChatGPT\project-doc-auditor\test\core.test.mjs (líneas 1-96): patrón node --test, estructuras
- C:\Users\Emmanuel G\Documents\ChatGPT\project-doc-auditor\public\index.html (líneas 14-26): estructura navbar, botones nav-item

## Símbolos relevantes
| Archivo | Símbolo | Por qué importa |
|---|---|---|
| server.mjs | startAuditorServer, sendJson, requireSameOrigin | Patrón de endpoint, validación |
| core.mjs | sha256, parseMarkdownSections, KNOWN_STATES | Utilidades reutilizables |
| repository.mjs | ProjectRepository.snapshot() | Modelo retornado al cliente |
| app.js | setView(), loadSnapshot(), render() | Patrón multi-tab, hook de cargar datos |
| styles.css | --accent, --green, --red, .badge, .panel, .status-row | Tokens de diseño, componentes |

## Invariantes que NO deben cambiar
- Loopback-only, sin red externa salvo opcional npx ccusage local
- Session token y Host/Origin checks en todas las mutaciones
- Nunca escribir en archivo, nunca guardar secretos
- No introducir dependencias npm nuevas en package.json
- Endpoint GET /api/agents sigue request/response JSON del servidor
- UI no renderiza payloads completos de mensajes ni código sensible
- Compatible Node >=20, ESM puro, tests con node --test

## Fuera de alcance
- Cambiar arquitectura de auditor (tabs, navbar, seguridad)
- Integrar directamente con APIs de Claude/Codex en línea
- Procesamiento cloud o almacenamiento persistente
- Soporte de formatos JSONL distintos a Claude Code y Codex estándar

## Formato de entrada
**Claude Code JSONL** (%USERPROFILE%\.claude\projects\<slug>\*.jsonl):
- Slug: ruta completa con ":" y "\" reemplazados por "-" (ej: C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant → C--Users-Emmanuel-G-Documents-ChatGPT-superRestaurant)
- Registros JSONL con campos: `timestamp`, `ordinal`, `type` (session_meta, message, tool_use, tool_result), `payload`
- `message` payload: `{type, role, content}` donde content puede ser text, tool_use blocks, tool_result blocks
- `tool_use` en content: `{type: "tool_use", name: "<tool_name>", input: {...}, id: "<id>"}`
- `tool_result` en content: `{type: "tool_result", tool_use_id: "<id>"}`
- `usage` en algunos payloads: `{input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens?}`

**Codex JSONL** (%USERPROFILE%\.codex\sessions\YYYY\MM\DD\*.jsonl):
- Estructura similar con `session_meta` inicial (contiene `cwd` para filtrar por repo)
- `message` records con `payload.usage` si existen
- `tool_use` blocks análogos a Claude Code

## Verificación
```bash
# En C:\Users\Emmanuel G\Documents\ChatGPT\project-doc-auditor:
npm test
npm run start
# Luego: abrir navegador → pestaña "Agentes" debe cargarse
# GET http://127.0.0.1:PORT/api/agents debe retornar JSON { sessions: [...] }
```

Salida esperada:
1. Resumen: "Añadida pestaña Agentes con parser JSONL nativo y toggle ccusage"
2. Archivos: src/server.mjs, src/agents.mjs, public/app.js, test/agents.test.mjs, test/fixtures/
3. Test pass: `... tests ok`
4. UI: Pestaña "Agentes" renders lista con cols: Fecha | Origen | Tokens | Costo | Herramientas

## Arquitectura sugerida
- **src/agents.mjs** (nuevo): funciones `parseClaudeCodeJsonl(path)`, `parseCodexJsonl(path)`, `aggregateSession(records)` → retorna `{sessionId, origin, startedAt, tokens: {input, output, cache}, estimatedCost, tools: {name: count}, files: string[], subagents: string[], timeline: [{time, event}]}`
- **src/server.mjs**: añadir ruta `GET /api/agents` con parámetro opcional `?use-ccusage=true` → lee `%USERPROFILE%\.claude\projects\<audited-repo-slug>` y `%USERPROFILE%\.codex\sessions` → retorna `{sessions: [...]}`
- **public/app.js**: añadir vista `renderAgents()` en render(), incluir toggle checkbox, hacer fetch a /api/agents
- **public/index.html**: añadir nav-item `data-view="agents"` con icono entre activity y settings
- **test/agents.test.mjs**: tests para ambos parsers, token aggregation, costo estimado, ccusage toggle

Riesgo sugerido: **bajo** — sin cambios a core logic, parser lectura-only, sin red, toggle optional
Capa sugerida: **L2 (Codex)** — módulo acotado, decisiones locales, código UI compartible