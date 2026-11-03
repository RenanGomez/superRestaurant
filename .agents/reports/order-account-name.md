# order-account-name — hecha

## Resumen por capa
1. **Contratos (`packages/shared-types`)**: Corregido test de `parseSetOrderAccountLabelCommandV1` en `orders.runtime.test.ts`. Tipos `OrderDetailV1`, `TableBoardActiveOrderV1` y `BranchOrderWorkItemV1` integran `accountLabel: string | null`.
2. **SQL (`supabase`)**: Migración `20261102000200_order_account_label.sql` añade columna `app.orders.account_label text check (char_length <= 60)`, función `app_private.set_order_account_label` con aislamiento por scope, `FOR UPDATE`, CAS version, auditoría `order.account_label_set`, y actualiza proyecciones `read_order`, `list_branch_order_work_items` y `list_table_board`. Invariantes en `supabase/tests/order_account_label_invariants.sql` (rollback-only).
3. **Verificador (`apps/api`)**: Creado `run-order-account-label-schema-verification.ts` y script `verify:order-account-label-schema:rollback` con flag `--local-disposable-only`.
4. **API (`apps/api`)**: Endpoint `POST /api/v1/orders/account-label` vía `OrderAccountLabelController` y `OrderAccountLabelService` (`orders.update`), adaptador Postgres, unit tests en `order-account-label.test.ts`, y proyecciones en `orders.ts`, `branch-order-work-tray.ts` y `table-board.ts`.
5. **Web (`apps/web`)**: En `tables-board.tsx`, tarjeta muestra «Cuenta: Juan», botón «Nombre» (min-h-11, target >= 44px), input inline (máx 60, autoFocus, Enter guarda, Escape cancela, vacío desasigna con null), feedback accesible `aria-live="polite"`. En `orders-tray.tsx` y `order-detail-panel.tsx`, encabezado muestra «Mesa 2 · Juan». En `print-documents.ts`, comanda y ticket formatean encabezado `Mesa: Mesa 2 · Juan` (o `Cuenta: Juan` si no tiene mesa) con fallback sin cambios.

## Archivos editados y creados (worktree C:\tmp\sr-wt\order-account-name-g)
- `packages/shared-types/src/orders.runtime.test.ts`
- `supabase/migrations/20261102000200_order_account_label.sql`
- `supabase/tests/order_account_label_invariants.sql`
- `apps/api/package.json`
- `apps/api/src/app.module.ts`
- `apps/api/src/orders.ts`
- `apps/api/src/branch-order-work-tray.ts`
- `apps/api/src/table-board.ts`
- `apps/api/src/order-account-label.ts`
- `apps/api/src/order-account-label.controller.ts`
- `apps/api/src/order-account-label.test.ts`
- `apps/api/src/operations/run-order-account-label-schema-verification.ts`
- `apps/web/src/app/app/tables/actions.ts`
- `apps/web/src/app/app/tables/page.tsx`
- `apps/web/src/app/app/tables/tables-board.tsx`
- `apps/web/src/app/app/orders/orders-tray.tsx`
- `apps/web/src/app/app/orders/order-detail-panel.tsx`
- `apps/web/src/lib/orders-view.ts`
- `apps/web/src/lib/orders-view.test.ts`
- `apps/web/src/lib/print-documents.ts`
- `apps/web/src/lib/print-documents.test.ts`
- `apps/web/src/lib/branch-order-work-tray.test.ts`
- `apps/web/src/lib/order-detail.test.ts`

## Salida literal de las puertas
- **turbo run lint typecheck test build (@super-restaurant/shared-types, api, web)**:
  `Tasks: 20 successful, 20 total. Time: 2m4.246s`
- **@super-restaurant/mobile typecheck**:
  `$ tsc --noEmit --project tsconfig.json -> Exit status 0`
- **@super-restaurant/api verify:order-account-label-schema:rollback**:
  `{"stage":"configuration","status":"failed","code":"LOCAL_ORDER_ACCOUNT_LABEL_FAILED","invariant":"LOCAL_CONFIRMATION_REQUIRED","message":"LOCAL_CONFIRMATION_REQUIRED"}`
  `{"stage":"local_cleanup","status":"failed","stopped":true,"runId":"578f979bf3b94b7b8b9a023b5af6f7e7","marker":"LOCAL_ORDER_ACCOUNT_LABEL_ONLY"}`
  `Exit status 1 (esperado sin Postgres local)`

## Commits en gemini/order-account-name
- `017c333` fix(shared-types): fix account label command test parameter
- `58b86e7` feat(db): order account label migration, invariants and verification script
- `0bc8b2e` feat(api): endpoint POST /api/v1/orders/account-label and projections
- `eca8f31` feat(web): table account name editing in board and display in orders tray, detail and prints
- `fdbb32d` fix(web): pass accountLabel to context in buildCustomerTicket

## Brecha y riesgos
- **Brecha**: No hay PostgreSQL local activo en el host de desarrollo; el script `verify:order-account-label-schema:rollback` está verificado y listo para corrida remota rollback-only por el orquestador.
- **Riesgos**: Ninguno. Todos los cambios son estrictamente aditivos y normalizan a null cuando se omite el campo; sin impacto en dinero, KDS ni Mobile.
