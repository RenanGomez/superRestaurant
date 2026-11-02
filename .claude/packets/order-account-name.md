# order-account-name · nombre opcional de la cuenta de mesa («a nombre de quién»)

Nivel B (contrato + API + SQL de una columna y una función; sin dinero) · Capa L2 Codex (`tools/agentic/codex-task.ps1 -Task order-account-name -Packet .claude/packets/order-account-name.md -Effort medium`) · rama `codex/order-account-name` desde `main` (≥ f749e72, incluye `tables-accounts-r2`). Revisión: una de familia distinta (Gemini o Claude). No tocar `apps/web/src/app/app/menu/**` ni `capture/**`.

## Pedido de Emmanuel (2026-11-01)
Las órdenes de mesa deben poder llevar, opcionalmente, a nombre de quién está la cuenta, para distinguirlas cuando hay varias cuentas en una mesa.

## Alcance
1. **SQL**: migración nueva `supabase/migrations/20261102000200_order_account_label.sql`: columna `app.orders.account_label text null check (account_label is null or (char_length(account_label) between 1 and 60))`; función `app_private.set_order_account_label(…)` con la misma forma que `assign_order_waiter` (scope restaurante/sucursal, bloqueo de fila, `expected_version`, idempotencia por `idempotency_key`, auditoría con actor/dispositivo/timestamp/from/to, versión +1), EXECUTE sólo `app_api`; `read_order`, `list_branch_order_work_items`, `read_table_board` (o equivalentes vigentes: localízalos con grep en la última migración que los define) emiten `accountLabel`. **No aplicar en remoto.** Invariantes en `supabase/tests/order_account_label_invariants.sql` (`begin;` … `rollback;`): set/clear, longitud 61 rechazada, replay idempotente, CAS por versión, otra sucursal rechazada, auditoría registrada.
2. **Contratos** (`packages/shared-types/src/orders.ts`, `branch-order-work-tray.ts`): `accountLabel: string | null` opcional en entrada y `null` normalizado en `OrderDetailV1`, `TableBoardActiveOrderV1`, `BranchOrderWorkItemV1`; comando `SetOrderAccountLabelCommandV1` con parser. Tests runtime.
3. **API**: endpoint `POST /api/v1/orders/account-label` siguiendo el patrón de `assign-waiter` (autorización por rol como el mesero: quien pueda abrir cuenta puede nombrarla), adaptador Postgres, tests.
4. **Web**: en el diálogo de mesa (`tables-board.tsx`, tarjeta de cuenta) botón «Nombre» que abre un input inline (máx. 60, 44 px, Enter guarda, Escape cancela, vacío = quitar); la tarjeta muestra «Cuenta: Juan» cuando existe. En `/app/orders` las tarjetas, el detalle, la comanda y el ticket muestran «Mesa 2 · Juan». `print-documents.ts` recibe el nombre con fallback vacío.
5. **Verificador** `apps/api/src/operations/run-order-account-label-schema-verification.ts` + script `verify:order-account-label-schema:rollback` (`--local-disposable-only`), modelado en los existentes.

## Invariantes
Sin dinero; aislamiento por restaurante/sucursal en la función y en el endpoint; auditoría obligatoria; snapshots inmutables no cambian; sin `any`, LF, español, sin `alert/confirm/prompt`; compatibilidad: campo opcional en entrada.

## Verificación (Node 24, pnpm vía corepack)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/api --filter=@super-restaurant/web`; `pnpm --filter @super-restaurant/mobile typecheck`.
- Verificador local si hay Postgres; si no, brecha (el orquestador ejecuta migración + invariantes en remoto con rollback).

## Formato de salida
Resumen por capa, archivos, salida literal de puertas, brecha, riesgos, hashes. Commits por capa. Sin merge, push ni aplicar.
