# ORCHESTRATOR — superRestaurant

Reglas de orquestación multi-motor para este repositorio. Complementa a `AGENTS.md`, que sigue siendo la
fuente de verdad del producto (dominio, dinero, tenancy, offline, seguridad, pruebas, Definition of Done,
niveles de rigor §19.2 y handoff §21). Si algo aquí contradice a `AGENTS.md`, gana `AGENTS.md`.

Lectura al iniciar una sesión: `AGENTS.md`, `TODO.md`, `HANDOFF.md` (sólo la primera entrada), `PROJECT_NOTES.md`
cuando la tarea lo pida, y este archivo. `.agents/plan.md` y `.agents/context.md` no son el tablero: el estado
vive en `TODO.md` y `HANDOFF.md`.

---

## 0. Quién lee este documento

- **Si recibiste un paquete de contexto o un brief** (`docs/templates/CONTEXT_PACKET.md`, `.claude/packets/<id>.md`
  o `.agents/briefs/<ID>.md`): eres un **sub-agente**. Ejecutas sólo tu objetivo, no orquestas ni delegas, y
  entregas el reporte en el formato que indique tu paquete (§8). Ignora §1 a §4.
- **Si hablas directamente con Emmanuel**: eres el **orquestador (L0)**, seas Claude Code, Gemini en Antigravity o
  Codex. Aplica todo este documento.

---

## 1. Rol del orquestador (L0)

1. Planifica, divide, delega, revisa diffs, integra y verifica. **No escribe código fuente.** En Claude Code lo
   impone el hook `.claude/hooks/guard-orchestrator-writes.js`: `Write` y `Edit` sólo sobre `TODO.md`, `HANDOFF.md`,
   `PROJECT_NOTES.md`, `AGENTS.md`, `README.md`, `.gitignore`, `.mcp.json`, `docs/**`, `.claude/**` y
   `tools/agentic/**`. Todo lo demás lo escribe un sub-agente con permiso de escritura.
2. Sí ejecuta: lectura exploratoria (CodeGraph primero, `AGENTS.md` §4), comandos de verificación, control de git
   (merge local de ramas de sub-agentes, limpieza de worktrees), arranque de servidores locales, y mantenimiento de
   `TODO.md`, `HANDOFF.md`, paquetes y notas.
3. Flujo por tarea:
   1. Clasificar la tarea por **nivel de rigor** A/B/C (`AGENTS.md` §19.2) y por **complejidad** (§3 de este archivo).
   2. Escribir el **paquete de contexto** (`docs/templates/CONTEXT_PACKET.md`) en `.claude/packets/<id>.md`.
      Si el ejecutor es Codex o Gemini vía el lanzador común, el mismo contenido va en `.agents/briefs/<id>.md`.
   3. Lanzar el sub-agente (§2). Un escritor por tarea, un worktree por tarea, una rama `claude/<id>` o `codex/<id>`.
   4. Revisión cruzada obligatoria en niveles A y B (§2.4) con el sub-agente `reviewer` o `codex exec review`.
   5. Integrar en `main` sólo con las puertas verdes desde el checkout principal; retirar el worktree en la misma
      sesión (en Windows: `rmdir /s /q` desde PowerShell y luego `git worktree prune`).
   6. Registrar en `HANDOFF.md` (entrada nueva arriba) y mover la tarea en `TODO.md`. Commits y push: sólo cuando
      Emmanuel lo pida (`AGENTS.md` §3.1 y §17).

---

## 2. Canales de ejecución

| Capa | Ejecutor | Cómo se lanza | Escribe código | Úsalo para |
|---|---|---|---|---|
| L1 | `implementer-claude` (Sonnet, worktree propio) | Herramienta Agent de Claude Code con el paquete de contexto | Sí | Nivel A siempre; nivel B cuando toque auth, dinero, tenancy, SQL, sync, contratos compartidos o refactors transversales |
| L1-ro | `reviewer`, `researcher` (sólo lectura) | Herramienta Agent | No | Revisión de diffs contra invariantes; paquetes de contexto previos a delegar |
| L2 | Codex (`codex exec`, cuenta ChatGPT Plus) | `tools/agentic/codex-task.ps1` o el lanzador común `.harness/bin/agent.ps1 -Engine codex -Id <id> -Effort <low, medium, high> [-Write] [-Worktree]` | Sí, en su worktree | Nivel B/C con aceptación cerrada: UI, tests, adaptadores, docs largos, refactors mecánicos |
| L3 | Gemini (Antigravity `agentapi`, cuenta Google AI Pro) | `.harness/bin/agent.ps1 -Engine gemini -Id <id> -Model <fast, default, strong>` | No (sólo lectura por instrucción, no por sandbox: para escribir, Codex) | Exploración, mapeo, parseo de logs, segunda opinión barata, tareas triviales |
| L3 | Claude CLI headless (`claude -p`) | `.harness/bin/agent.ps1 -Engine claude -Id <id> -Model <fast, default, strong>` | Según `-Write` | Sólo cuando no se orquesta desde Claude Code |

Notas del lanzador común (`.harness/bin/agent.ps1`):
- Es una **vía adicional** para Codex y Gemini, no un reemplazo del flujo L1 con `implementer-claude`.
- Lee `.agents/briefs/<id>.md`, deja el reporte en `.agents/reports/<id>.md` (formato §8) y el log completo en
  `.harness/runs/<id>/log.txt` (ignorado por git). Alias de modelos en `.harness/config.json`.
- `-Engine gemini` requiere la app Antigravity abierta y tarda 1 a 2 minutos; cada run aparece como conversación
  «harness <id>» en Antigravity. Probado en este repo el 2026-10-23: funciona.
- `-Engine codex` requiere `codex login` vigente. Probado el 2026-11-01 con `.agents/briefs/codex-smoke.md` (sólo
  lectura, `-Effort low`): funciona, 26 s, reporte correcto en `.agents/reports/codex-smoke.md`.
- Sin `-Write` el sub-agente es de sólo lectura. Lanzar en segundo plano; tareas independientes en paralelo (§4).
- Si quien orquesta es Gemini en Antigravity, puede usar `invoke_subagent` en lugar de `-Engine gemini`; si es
  Claude Code, usa su herramienta Agent para los sub-agentes Claude.

### 2.4 Revisión cruzada
- Nivel A: revisión doble, dos familias distintas (por ejemplo `reviewer` de Claude + `codex exec review`, o
  Claude + Gemini). Nivel B: una revisión de familia distinta a la del implementador. Nivel C: una revisión
  ligera o ninguna, a juicio de L0.
- Ningún diff de nivel A o B se integra sin revisión. Los P1 bloquean; los P2 se corrigen en ronda siguiente con el
  mismo sub-agente si conserva contexto, o con paquete nuevo.

---

## 3. Matriz de complejidad y esfuerzo

Antes de delegar, L0 clasifica la subtarea y elige el canal y esfuerzo mínimos suficientes. El nivel de rigor
(`AGENTS.md` §19.2) manda sobre esta tabla: una tarea de nivel A va a L1 aunque sea «trivial».

| Complejidad | Ejemplos | Claude (Agent) | Codex | Gemini |
|---|---|---|---|---|
| **Trivial** | Mapear archivos, renombrar, lint/formato, docstrings, regex, leer logs | `researcher` o `haiku` | `-Effort low` | `-Model fast` |
| **Estándar** | Feature acotada, bugfix reproducible, tests unitarios, refactor modular | `implementer-claude` (sonnet) | `-Effort medium` | `-Model default` (sólo lectura) |
| **Compleja** | Arquitectura, concurrencia, seguridad, refactors masivos, diseño de contratos | `implementer-claude` con revisión doble, u `opus` para diseño | `-Effort high` | `-Model strong` (diseño y segunda opinión) |

Reglas:
1. Menor esfuerzo suficiente; reservar el modelo del orquestador para planificar, revisar e integrar.
2. Escalar tras dos intentos fallidos en el mismo nivel; si falla en «Compleja», L0 re-divide la tarea.
3. Preferir las cuotas ya pagadas (Codex, Gemini) para lo mecánico y la exploración; Claude L1 para lo crítico.

### 3.1 Cuota, autenticación y fallback
- Ninguna CLI expone saldo; la disponibilidad se detecta por código de salida y mensajes como `Rate limit`,
  `429`, `Usage limit`, `Insufficient quota`, `Unauthorized`, `Session expired`.
- Ante uno de ellos, L0 no se detiene: marca el canal como no disponible en la sesión, redirige la subtarea al canal
  alternativo (Codex a Claude L1, Gemini a `researcher`, etc.) y lo anota en `HANDOFF.md`:
  «Canal X sin cuota o sin sesión; ejecutado con Y».

---

## 4. Contexto, paralelismo y eficiencia

1. Los sub-agentes no reciben historial de conversación: sólo el paquete, rutas exactas y rangos de líneas. Nunca
   «explora todo el proyecto». Un archivo de entrada de más de 300 líneas va con rango o con resumen previo.
2. Máximo 4 sub-agentes en paralelo. **Un archivo, un dueño** por ronda. B arranca cuando A entregó y L0 verificó.
3. Lo que resuelve un comando (`grep`, un test puntual, `git log`) lo ejecuta L0 sin delegar.
4. Paquetes de hasta unas 60 líneas; si no cabe, dividir. Sin trabajo especulativo. Detención temprana si el paquete
   es contradictorio o incompleto, reportándolo.
5. Hallazgos reutilizables sobre subsistemas van a `PROJECT_NOTES.md` o a `docs/architecture/**`, no a la
   conversación.

---

## 5. Verificación y seguridad

1. Toda subtarea termina con un comando de verificación objetivo definido en el paquete, ejecutado con Node 24 y
   pnpm 11 (`%LOCALAPPDATA%/Programs/node24`). L0 repite las puertas desde el checkout principal antes de integrar.
2. Honestidad estricta: qué se probó y qué quedó fuera.
3. Sin secretos ni valores de `.env` en paquetes, briefs, reportes, notas ni chat. Codex siempre con sandbox
   `workspace-write`; Gemini sólo lectura.
4. Destructivo o remoto (migraciones, borrados, push, force, credenciales) sólo con autorización explícita de Emmanuel
   (`AGENTS.md` §3.1).

---

## 6. Sub-agentes Claude disponibles (`.claude/agents/`)

- `implementer-claude`: único con escritura; exige paquete de contexto; worktree propio; commits locales
  convencionales; nunca merge, push ni Supabase remoto.
- `reviewer`: revisa un diff contra `AGENTS.md` §7-§13 y el paquete; sólo lectura; salida con P1/P2/P3 y veredicto.
- `researcher`: responde una pregunta estructural y devuelve un paquete de contexto listo para delegar.

---

## 7. Plantilla de brief para el lanzador común (`.agents/briefs/<id>.md`)

Mismo contenido que el paquete de contexto; cabecera mínima:

```markdown
# <id> — <título corto>
Agente: [Codex | Gemini | Claude]   Nivel de rigor: [A | B | C]   Complejidad: [Trivial | Estándar | Compleja]
## Objetivo
## Archivos (editables / sólo lectura / contexto)
## Restricciones e invariantes
## Criterios de aceptación
## Verificación (comandos exactos)
## Formato de salida: reporte §8 en .agents/reports/<id>.md
```

---

## 8. Formato de reporte

```markdown
# <id> — [hecha | bloqueada]
Cambios: 1 a 3 líneas
Archivos: rutas creadas o editadas
Verificación: comando → Pasa | Falla + causa
Riesgos/pendientes: detalle o «Ninguno»
Notas: observaciones o «Ninguna»
```
Máximo 15 líneas para Codex y Gemini. Los sub-agentes Claude usan el formato de salida de `CONTEXT_PACKET.md`
(resumen, archivos, salida literal de las puertas, riesgos).

---

## 9. Limpieza pendiente

- `.agents/notes/legacy_TODO.md`, `legacy_todo.md`, `legacy_project_notes.md` y `legacy_PROJECT_NOTES.md` son copias
  del 2026-10-21 de `TODO.md` y `PROJECT_NOTES.md`; se pueden borrar. `.agents/plan.md` y `.agents/context.md` son
  plantillas sin llenar; o se eliminan o se dejan sólo como destino de briefs y reportes del lanzador.
- `AGENTS.md.bak_20261021_221354` puede borrarse una vez confirmado que `AGENTS.md` coincide con el commit.
