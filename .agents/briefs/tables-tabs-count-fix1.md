# tables-tabs-count-fix1 — restaurar el total por cuenta que se perdió al pasar a pestañas (escribe código)
Agente: Gemini   Nivel de rigor: C   Complejidad: Trivial

## Objetivo
En la rama `gemini/tables-tabs-count` (worktree `C:\tmp\sr-wt\tables-tabs-count`; no edites el checkout principal), el commit `d669430` eliminó el estado `details` (`Record<string, OrderDetailV1 | null>`) y la función `totalLabel` que cargaban el detalle de cada cuenta con `orderDetailAction` para mostrar su total («$130.00»). Emmanuel pidió expresamente la pestaña «+ Nueva» **junto al total de la cuenta**, así que el total debe volver.

## Tarea
1. Restaura la carga del detalle por cuenta como estaba en `main` (`git show main:apps/web/src/app/app/tables/tables-board.tsx` para ver `details`, `totalLabel` y dónde se disparaba la carga al abrir el diálogo o al crear una cuenta).
2. Muestra el total en la pestaña («Cuenta 1 · $130.00», «Juan · $130.00» si tiene `accountLabel`; «Cargando…» mientras llega) y en la tarjeta activa; `accountTabLabel` recibe el total ya formateado o `null` (actualiza su test).
3. La pestaña «+ Nueva» va inmediatamente a la derecha de la última pestaña de cuenta.
4. `turbo run lint typecheck test build --filter=@super-restaurant/web`; `git diff --check`; commit `fix(web-tables): restore per-account totals in tabs`.

## Formato de salida: reporte §8 en .agents/reports/tables-tabs-count-fix1.md
Qué restauraste, salida de puertas, hash. Máximo 30 líneas.
