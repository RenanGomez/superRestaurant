# Brief o0-rev-web-leader

NO escribas archivos fuera de tu informe `.agents/reports/o0-rev-web-leader.md`. NO edites código, NO commitees, NO hagas push. NO ejecutes PostgreSQL ni Playwright. Trabaja en la raíz del repo y lee con `git show` (no abrir worktrees).

## Objetivo
Revisión de código del commit `11ce78f3` (PR #73, `o0-web-leader`, nivel A): evalúa **los dos focos** en un solo veredicto y di si el P2/P3 que dejó la revisión anterior sigue abierto.

Tiempo estimado: 12 min

## Qué revisar
`git show 11ce78f3` (2 archivos: `apps/web/src/lib/offline/sync-leader.ts` y `.test.ts`). Contenido vigente: `git show HEAD:apps/web/src/lib/offline/sync-leader.ts`. Registro en el script: `git show HEAD:apps/web/package.json`.

Contexto: las pestañas de la web offline comparten un almacén cifrado; debe haber **un solo motor escritor por `deviceId`**.

## Foco 1 — invariantes (razona contra el código, no supongas)
- Liderazgo exclusivo por `deviceId` (Web Locks) y liberación al cerrar/descargar la pestaña; sin fugas de `BroadcastChannel` ni timers.
- Al perder el lock: el motor se descarta y la pestaña recarga/reintenta con **la misma idempotency key** (no debe crear una segunda identidad de operación).
- Comportamiento cuando `navigator.locks` o `BroadcastChannel` no existen (fallback seguro, no dos líderes).
- ¿Puede una pestaña quedarse esperando para siempre? (P2 previo: el seguidor espera sin timeout). ¿`onLost` se dispara también en liberación voluntaria? ¿Está documentado?

## Foco 2 — pruebas adversariales
- ¿Las pruebas demuestran lo que dicen (segundo motor no escribe mientras el líder vive; pérdida de lock descarta y recarga con la misma key)? Señala aserciones tautológicas o que no pueden fallar.
- ¿El doble de `locks`/`channel` modela algo que el navegador real no puede producir (P3 previo)? Di si eso invalida la prueba o solo la limita.
- Falta el consumidor productivo (hoy `acquireSyncLeader` solo lo usa su test): confirma con grep y di si eso bloquea cerrar `o0-wire`.

## Reporte
`.agents/reports/o0-rev-web-leader.md`, máximo 20 líneas:
1. `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
2. Hallazgos con severidad (`P1`/`P2`/`P3`), `archivo:línea` del commit y una frase de por qué.
3. Estado de cada P2/P3 previo: cerrado / sigue / no era cierto, con evidencia.
4. Qué no pudiste verificar (ejecución de suites = orquestador).
Aplica Ponytail en el criterio: bugs, seguridad, carga real, pruebas, qué sobra.
