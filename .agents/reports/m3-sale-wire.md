## Estado
done — los tres puntos de escritura llaman a los envoltorios con inventario y existe el nuevo wrapper de cancelación de línea, con migración y prueba SQL.

## Qué hice
- `20261126000700`: `persist_order_item_cancellation_with_inventory` (SECURITY DEFINER, `search_path=''`, owner `postgres`, ejecuta solo `app_api`); revierte únicamente con `status='saved'` y devuelve `v_result || {inventory}`.
- `captures.ts` (probe y confirm) y `orders.ts` (línea y orden) usan los wrappers; el parseo tolera la clave aditiva `inventory` sin cambiar contratos ni mensajes.
- Registro en `inventory-schema-verification.ts`/`run-inventory-schema-verification.ts` y pruebas API con nombre de función y número de parámetros.

## Archivos tocados
- `supabase/migrations/20261126000700_inventory_line_cancel.sql`, `supabase/tests/inventory_line_cancel_invariants.sql`
- `apps/api/src/captures.ts`, `orders.ts`, `captures.test.ts`, `orders.test.ts`, `order-cancel.test.ts`, `operations/inventory-schema-verification.ts`, `operations/run-inventory-schema-verification.ts`

## Verificación
```powershell
$ pnpm --filter @super-restaurant/api typecheck   # $ tsc --noEmit, sin errores
$ pnpm --filter @super-restaurant/api lint        # $ eslint --max-warnings=0, sin errores
$ pnpm --filter @super-restaurant/api test        # EXIT=0; 80x "ℹ fail 0"; 0x "ℹ fail [1-9]"
✔ PostgreSQL adapter binds app_private.cancel_order and decodes the real { result } row
✔ capture confirmation probes replay and delegates one atomic persistence command
```

## Riesgos / dudas
- NO VERIFICADO: PostgreSQL no se ejecutó (lo prohíbe el brief); `verify:inventory-schema:rollback` queda al orquestador.
- `inventory_sale_consumption_invariants.sql` y `docs/agentic/backlog.json` aparecen modificados por trabajo concurrente; no los toqué.

## Notas propuestas
- Los wrappers con inventario añaden `inventory` al JSON; los parsers estrictos del API deben aceptar esa clave aditiva.