# Brief o0-rev-sync-p3

NO escribas archivos fuera de tu informe `.agents/reports/o0-rev-sync-p3.md`. NO edites código, NO commitees, NO hagas push. NO ejecutes PostgreSQL ni Playwright. Trabaja en la raíz del repo y lee con `git show` (no abrir worktrees).

## Objetivo
Revisión de código del commit `8fe8df8c` (PR #77, `o0-sync-p3`, nivel A): **dos focos** en un veredicto. Toca el ejecutor de sync (estado, dispositivo, actor) y el transporte web.

Tiempo estimado: 12 min

## Qué revisar
`git show 8fe8df8c` (`apps/api/src/sync/sync-merge-executor.ts`, `apps/api/src/sync/sync-push.test.ts`, `apps/web/src/lib/offline/sync-transport.ts` y `.test.ts`). Vigente: `git show HEAD:<ruta>`.

## Foco 1 — invariantes
- El ejecutor distingue `DEVICE_UNKNOWN` de `DEVICE_REVOKED`, y `ACTOR_MISMATCH` de `AUTH_REVOKED`. Antes `unknown` se trataba como revocado y `ACTOR_MISMATCH` como `AUTH_REVOKED`; verifica que ya no ocurre en ninguna rama ni en los consumidores del API.
- El rechazo genera log estructurado **sin token, sin PII** y con `correlationId`/ids de scope cuando aplica.
- Transporte web: timeout por defecto 30 s aunque `timeoutMs` sea 0/ausente; el corte no deja la petición colgada ni provoca reintento duplicado; un 429/503 sigue respetando el comportamiento previo.
- Ningún evento confirmado se marca como fallido por un timeout ambiguo (¿el resultado es determinista?).

## Foco 2 — pruebas adversariales
- ¿Las pruebas nuevas fuerzan cada rama (unknown vs revoked, mismatch vs revoked) o solo repiten el camino feliz?
- ¿La prueba del timeout demuestra el corte real (abort) y no solo el valor por defecto?
- Señala aserciones tautológicas o mocks que evitan el código bajo prueba.

## Reporte
`.agents/reports/o0-rev-sync-p3.md`, máximo 20 líneas:
1. `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
2. Hallazgos `P1`/`P2`/`P3` con `archivo:línea` y una frase de por qué.
3. Estado de los P3 previos (debt.md PR #60 / #77): cerrado / sigue / no era cierto.
4. Qué no pudiste verificar (suites y PostgreSQL = orquestador).
