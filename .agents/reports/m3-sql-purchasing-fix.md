Now let me check the ledger grant context and verify script wiring before editing.
Now editing the migration. First the table columns/constraints:
Now replacing the create-purchase-order function with the idempotent version:
Now the test file. Adding declarations and idempotency keys:
Now running the required gates:
## Estado
done — idempotencia de compras, auditoría de recepción y pruebas P1 completas; gates verdes.

## Qué hice
- Idempotencia por `(restaurant_id, idempotency_key)`: dedupe estructural de `supplierId/currency/líneas`, replay `{orderId,status,replayed:true}`, conflicto `22000 INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT` y carrera resuelta por el unique + un solo reintento de lectura. `unitCostMinor >= 0` explícito en la función.
- Auditoría `received_by`/`received_device_id` en `inventory_receive_purchase_order`; pruebas nuevas de coste negativo/decimal/texto/19 dígitos, moneda `usd`/`US`/`USDD`, clave ausente/vacía/con espacios, proveedor ajeno y actor/device de recepción (orden y movimientos).
- No retiré el `EXECUTE` de `inventory_record_movement` a `app_api`: §3 del brief manda dejarlo (el encabezado/«Hecho cuando» decían lo contrario; prevalece §3).

## Archivos tocados
- `supabase/migrations/20261126000400_inventory_purchasing.sql` — columnas/checks, create idempotente, update de recepción con auditoría.
- `supabase/tests/inventory_purchasing_invariants.sql` — claves en payloads + casos nuevos; `docs/agentic/debt.md` solo normalicé un CRLF ya presente de otro motor.

## Verificación
```
typecheck  $ tsc --noEmit --project tsconfig.json -> TYPECHECK_EXIT=0
lint  $ eslint --max-warnings=0 --config ../../eslint.config.mjs src -> LINT_EXIT=0 ; git diff --check -> DIFFCHECK_EXIT=0
```

## Riesgos / dudas
- Revisar la decisión de no revocar el grant (conflicto encabezado↔§3); `debt.md` ya venía modificado por otro motor. NO VERIFICADO: PostgreSQL/`verify:inventory-schema:rollback` (prohibido en el brief; lo corre el orquestador).
## Notas propuestas
- El replay idéntico no revalida catálogo (proveedor/insumo) a propósito: no debe depender del estado actual.