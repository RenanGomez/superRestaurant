# Brief o0-rev-web-purge

NO escribas archivos fuera de tu informe `.agents/reports/o0-rev-web-purge.md`. NO edites código, NO commitees, NO hagas push. NO ejecutes PostgreSQL ni Playwright. Trabaja en la raíz del repo y lee con `git show` (no abrir worktrees).

## Objetivo
Revisión de código del commit `84d42eee` (PR #74, `o0-web-purge`, nivel A): **dos focos** en un veredicto. Es el almacén cifrado offline de la web; aquí un fallo pierde o filtra datos de otro actor/tenant.

Tiempo estimado: 14 min

## Qué revisar
`git show 84d42eee` (`apps/web/src/lib/offline/sync-purge.ts`, `sync-purge.test.ts`, `sync-store.ts`). Contenido vigente con `git show HEAD:<ruta>`.

## Foco 1 — invariantes
- Purga en **sign-out** limpio: no queda réplica, claves, cursores ni identidad del actor anterior.
- En `AUTH_REVOKED`: el almacén se **bloquea** y se purga la réplica, pero el **outbox se conserva** con evidencia; ninguna operación confirmada se pierde ni se reenvía dos veces.
- `keyVersion` rotada: una clave vieja no puede descifrar datos nuevos y el AAD con `restaurantId`/`branchId` rechaza un blob movido de scope (defensa en profundidad).
- Carreras: purga durante un commit, dos pestañas, purga parcial que falla a medias (¿queda el store utilizable o corrupto?). ¿La purga es idempotente?

## Foco 2 — pruebas adversariales
- ¿Cada afirmación del brief original tiene una prueba que puede fallar de verdad? Cita las que faltan (blob de otro scope, clave vieja, purga interrumpida, AUTH_REVOKED frente a sign-out).
- ¿Alguna prueba usa estado global o depende del orden?

## Reporte
`.agents/reports/o0-rev-web-purge.md`, máximo 20 líneas:
1. `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
2. Hallazgos `P1`/`P2`/`P3` con `archivo:línea` del commit y una frase de por qué.
3. Estado de los P2/P3 previos de `docs/agentic/debt.md` (PR #62 / #74): cerrado / sigue / no era cierto.
4. Qué no pudiste verificar (ejecución de suites = orquestador).
