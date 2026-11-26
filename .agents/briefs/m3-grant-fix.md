# Brief m3-grant-fix (nivel A · P2 de la revisión cross-foco)

Trabajas en el worktree `C:\Users\Emmanuel G\harness-wt\superRestaurant\m3-schema-grant-close`,
rama `harness/m3-schema-grant-close` (PR #122). **No cambies de rama ni de worktree.**

## Hallazgo P2 (revisión SQL del PR)

`apps/api/src/inventory/movements.service.ts` ya no envía `compensatesMovementId` al envoltorio (que
lo fija a `null`), pero `packages/shared-types` lo sigue aceptando y `parseMovementRequest` lo guarda:
un cliente que crea estar compensando un movimiento recibe 201 y **no pasa nada**, en silencio.

## Qué hay que hacer

1. En `apps/api/src/inventory/movements.service.ts`, rechaza una petición manual con
   `compensatesMovementId` no nulo **antes** de tocar la base: `parseMovementRequest` devuelve
   `undefined` si el contrato trae un `compensatesMovementId` distinto de `null`/ausente, de modo que
   el controlador responda `400` con el mismo código de validación que el resto
   (`INVENTORY_MOVEMENT_REQUEST_INVALID` o el que ya use). No cambies el contrato de
   `packages/shared-types` (lo usan otros caminos) ni las transferencias.
2. `apps/api/src/inventory/movements.test.ts`: caso nuevo — una petición de ajuste con
   `compensatesMovementId` no nulo devuelve error `request` sin ejecutar SQL; y ajusta el caso
   existente que hoy espera que se ignore.
3. P3 opcional de la misma revisión, si es barato: en
   `supabase/tests/inventory_movements_api_invariants.sql`, prueba que `app_api` recibe `42501` al
   intentar `select app_private.inventory_record_movement(...)` directamente (denegación explícita,
   no solo `has_function_privilege`).

## Archivos (exactos)

- `apps/api/src/inventory/movements.service.ts`
- `apps/api/src/inventory/movements.test.ts`
- `supabase/tests/inventory_movements_api_invariants.sql` (solo el P3)

Prohibido tocar cualquier otro archivo.

## Reglas

- No hagas `git commit`, `git push`, ni crees ramas o PRs.
- **No ejecutes PostgreSQL ni Playwright** (el orquestador corre el verificador).
- Puertas: `pnpm --filter @super-restaurant/api run typecheck`, `lint` y `test`.

## Hecho cuando

Typecheck/lint/test del API en verde y `.agents/reports/m3-grant-fix.md` explica el cambio y qué
prueba cubre el rechazo. Aplica AGENTS §9 y §15.
