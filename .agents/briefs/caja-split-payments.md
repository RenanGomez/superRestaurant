# caja-split-payments — implementar el paquete A `.claude/packets/caja-split-payments.md` (escribe código)
Agente: Gemini   Nivel de rigor: A   Complejidad: Compleja

## Objetivo
Implementar completo `.claude/packets/caja-split-payments.md` (léelo primero; luego tu investigación `.agents/reports/caja-split-payments-research.md` y `AGENTS.md` §9, §10, §12, §19.2).

## Dónde trabajar (obligatorio)
1. Desde la raíz: `git worktree add "C:\tmp\sr-wt\caja-split-payments" -b gemini/caja-split-payments main`; edita sólo ahí. No edites el checkout principal.
2. Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm: `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js"`; `install --frozen-lockfile`; construye `packages/shared-types` antes de typecheck de api y web.
3. Commits por capa en `gemini/caja-split-payments`; si git falla por permisos, dilo.

## Archivos (editables)
- `apps/web/src/app/app/caja/**` y sus tests, `packages/shared-types/src/orders.ts` y `orders.runtime.test.ts`, `apps/api/src/orders.ts` y tests, `apps/api/package.json` (script del verificador), `apps/api/src/operations/run-order-payments-captured-by-schema-verification.ts` (nuevo), `supabase/migrations/20261102000300_order_payments_captured_by.sql` (nuevo), `supabase/tests/order_payments_captured_by_invariants.sql` (nuevo).
## Sólo lectura
- `apps/web/src/lib/orders-view.ts` (`tableLabel`), `apps/web/src/app/app/orders/actions.ts` (`orderDetailAction`, `tableNamesAction`), migraciones anteriores.
## Prohibido
- `apps/web/src/app/app/menu/**`, `tables/**`, `capture/**`; aplicar en remoto; push; merge; editar migraciones existentes.

## Restricciones e invariantes
Las del paquete. Prioridad absoluta al punto 1 (el bug de los 70) y al punto 4 (UI). Si el tiempo no alcanza para todo, deja fuera primero el punto 3 (`capturedBy`) y dilo.

## Verificación (en el worktree)
- `turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/api --filter=@super-restaurant/web`; `git diff --check`.
- Verificador local no disponible: documéntalo.

## Formato de salida: reporte §8 en .agents/reports/caja-split-payments.md
Resumen por capa, archivos, salida literal de puertas, hashes, brechas, riesgos. Máximo 90 líneas.
