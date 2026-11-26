# Brief debt-compras-reads-sql

NO escribas archivos fuera del repo ni en `$env:TEMP`: usa `.harness/state/tmp/` y bórralo. NO ejecutes PostgreSQL, psql ni Playwright (el orquestador los corre). NO commitees, NO hagas push, NO instales dependencias.

## Objetivo
Que `viewer`, `auditor`, `cashier`, `waiter`, `supervisor` puedan **leer** proveedores y órdenes de compra por SQL (hoy el SQL los rechaza con `42501 INVENTORY_ACTOR_FORBIDDEN`), manteniendo las escrituras en `catalog.manage`.

Tiempo estimado: 30 min · Nivel A (SQL) → lo revisará un segundo foco.

## Alcance (únicos archivos que puedes editar)
- `supabase/migrations/20261126001400_inventory_purchasing_reads.sql` (nuevo)
- `supabase/tests/inventory_purchasing_api_invariants.sql`
- `apps/api/src/operations/run-inventory-schema-verification.ts` (solo añadir la guarda de la migración nueva, como las demás)
- `apps/api/src/operations/http-flow-inventory-api.ts` (solo la sección de lecturas del viewer)

Prohibido: tocar migraciones ya aplicadas (`20261126001000` se queda como está), `purchasing.service.ts`, `post-bootstrap-catalog.ts`, cualquier otro test o runner.

## Contexto mínimo
- `20261126001000_inventory_purchasing_api.sql` define las lecturas `list_inventory_suppliers` (:7), `list_inventory_purchase_orders` (:280) y `read_inventory_purchase_order` (:388). Cada una valida membresía/sucursal y luego exige `role_code in ('owner','admin','manager')` (líneas 45, 336, 444) con `42501 INVENTORY_ACTOR_FORBIDDEN`.
- Matriz RBAC vigente (`apps/api/src/auth/rbac-policy.ts` + `packages/shared-types`): tienen `catalog.read` → `owner, admin, manager, supervisor, cashier, waiter, viewer, auditor`; **no** lo tienen `courier` ni `kitchen`.
- El servicio (`purchasing.service.ts`, ya cambiado en otra rama) autoriza las lecturas con `catalog.read`; el SQL tiene que aceptar el mismo conjunto o el usuario real recibe 403.
- `supabase/tests/inventory_purchasing_api_invariants.sql` hoy **codifica la política vieja**: afirma que `cashier` no puede listar proveedores (:117), órdenes (:166) ni leer una orden (:196). Debe invertirse a la política nueva y añadirse la negativa para `kitchen` y `courier`.

## Cómo
1. Migración nueva con `begin; … commit;` que haga `create or replace function` de **solo esas tres** lecturas, copiando el cuerpo actual **literalmente** y cambiando únicamente la lista de roles del gate (los ocho con `catalog.read`), con un comentario que diga que replica `catalog.read` de la matriz RBAC y que si cambia la matriz hay que cambiar esto. Después: `alter function … owner to postgres;` y `revoke all … from public, anon, authenticated, service_role; grant execute … to app_api;` para las tres firmas. No toques `create_inventory_supplier`, `update_inventory_supplier`, `read_inventory_supplier_for_manage` ni las de órdenes de escritura: siguen exigiendo `owner/admin/manager`.
2. Invariantes: `cashier` y `viewer` **leen** las tres; `kitchen` y `courier` reciben `42501` en las tres; las escrituras siguen negadas a `cashier`/`viewer` (conserva esas aserciones) y el actor ajeno sigue viendo 0 filas en proveedores y `missing`/`42501` según corresponda (conserva lo que ya prueba).
3. `http-flow-inventory-api.ts`: en la sección del `viewer` añade que `GET /inventory/suppliers` y `GET /inventory/purchase-orders` responden 200 con datos, y que `GET /inventory/purchase-orders/:id` de una orden sembrada responde 200; deja intactas las escrituras en 403.
4. `run-inventory-schema-verification.ts`: añade `if (!names.includes("20261126001400_inventory_purchasing_reads.sql")) throw new Error("INVENTORY_PURCHASING_READS_MIGRATION_MISSING");` junto a las demás guardas.

## Hecho cuando
- La migración es idempotente en lo posible y no reescribe funciones ajenas.
- `pnpm --filter @super-restaurant/api run typecheck` y `lint` en 0 (puedes correrlos; no usan PostgreSQL).
- Reportas exactamente qué ejecutaste; el verificador `verify:inventory-schema:rollback` y `test:http:local` los corre el orquestador.

## Pruebas (ahorro de cuota)
- Un ciclo typecheck/lint al terminar; máximo 3 probar→corregir. Filtra salida.

## Reporte
`.agents/reports/debt-compras-reads-sql.md`: archivos, lista exacta de roles por función (lectura vs escritura), comandos y salida real (bloque ```), riesgos (duplicación de la matriz RBAC en SQL) y qué queda al orquestador. Aplica Ponytail.
