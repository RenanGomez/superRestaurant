# Brief m3-sql-purchasing-fix (nivel A · SQL dinero: idempotencia de compras y auditoría)

## Objetivo
Cerrar los P1/P2 de PR #91 en `supabase/migrations/20261126000400_inventory_purchasing.sql` y `supabase/tests/inventory_purchasing_invariants.sql`: crear orden de compra idempotente (clave + dedupe), pruebas de dinero/otro proveedor/auditoría de recepción, columnas `received_by`/`received_device_id` y retirada del EXECUTE directo de `app_private.inventory_record_movement` a `app_api`.

Tiempo estimado: 35 min. Eres el único escritor de esos dos archivos.

## Contexto (exacto; no explores)
- Función actual `app_private.inventory_create_purchase_order(p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_payload jsonb) returns jsonb` con payload exact-key `{supplierId, currency, orderedAt?, lines[]}`; líneas exact-key `{itemId, quantity, unitCode, unitCostMinor}`; inserta `app.inventory_purchase_orders` + `..._lines` y devuelve `{orderId, status:'draft'}`.
- Tabla `app.inventory_purchase_orders`: `id`, `restaurant_id`, `branch_id`, `supplier_id`, `status draft|sent|received|cancelled`, `currency`, `ordered_at`, `received_at`, `created_by`, `created_at`, `updated_at`; FK compuesta por restaurante; check de consistencia de `received_at`.
- `inventory_receive_purchase_order(p_actor_id uuid, p_order_id uuid, p_payload jsonb)` soporta `{warehouseId, occurredAt?, receivedAt?, deviceId?}` y ya es idempotente en el replay (probado). Marca `status='received'` y `received_at` pero **no guarda quién ni desde qué dispositivo**.
- `app_private.inventory_record_movement(...)` está `GRANT EXECUTE` a `app_api` desde `20261126000200_inventory_ledger.sql:317`; eso permite insertar un movimiento `receipt` saltándose la recepción (y bloquear la real por el índice único de source). Las funciones de recepción son `SECURITY DEFINER` dueñas de `postgres`, así que quitar el grant a `app_api` no las rompe.
- La prueba existente ya cubre: create válido (dos líneas), cantidades decimal/cero/negativa, unidad que no coincide, insumo de otro restaurante, actor ajeno/otra sucursal/cajero, recepción (saldos, costo, moneda), replay de recepción y segundo `receive` sin movimientos. **No** cubre: idempotencia de creación, `unitCostMinor` inválidos, moneda inválida, proveedor de otro restaurante, ni auditoría (`received_by`/device).

## Qué hacer (todo dentro de 00400 y su test)
1. **Idempotencia de creación**
   - Columna nueva en `app.inventory_purchase_orders`: `idempotency_key text not null` con check `char_length(btrim(idempotency_key)) between 1 and 200` y `<> ''`; `unique (restaurant_id, idempotency_key)`.
   - `p_payload` acepta y **exige** `idempotencyKey` (actualiza el allowlist exact-key y el check de presencia).
   - Al inicio de la función, tras validar actor y forma del payload: `select * from app.inventory_purchase_orders where restaurant_id = p_restaurant_id and idempotency_key = v_key for update`. Si existe, compara estructuralmente el payload guardado (mismo `supplier_id`, misma `currency`, y multiconjunto idéntico de líneas `item_id/quantity/unit_code/unit_cost_minor`) y:
     - idéntico ⇒ devuelve `{"orderId": v_order_id, "status": <status actual>, "replayed": true}` sin insertar nada;
     - distinto ⇒ `raise exception` `22000` `INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT`.
   - La carrera de dos llamadas simultáneas la resuelve el índice único: captura `unique_violation` y reintenta la lectura (una vez) para devolver el replay, o relanza.
   - Guarda `idempotency_key` en el insert.
2. **Auditoría de recepción**
   - Columnas nuevas: `received_by uuid references auth.users (id) on delete restrict` y `received_device_id uuid`.
   - `inventory_receive_purchase_order` escribe `received_by = p_actor_id` y `received_device_id = (p_payload ->> 'deviceId')::uuid` (validando formato si viene; `null` permitido) junto con `status='received'`/`received_at`.
3. **Grant peligroso (deuda, no lo toques aquí)**
   - `app_private.inventory_record_movement` conserva `EXECUTE` para `app_api` (lo fija la prueba `inventory_ledger_invariants.sql` y lo necesitará la API de movimientos). No cambies eso en este corte; queda en `docs/agentic/debt.md`.
4. **Pruebas nuevas** en `inventory_purchasing_invariants.sql` (mismo estilo, dentro de la transacción con `rollback;`):
   - Misma `idempotencyKey` dos veces ⇒ mismo `orderId`, `replayed=true`, y `count(*)` de órdenes y líneas sin cambiar.
   - Misma clave con línea distinta ⇒ excepción `INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT`.
   - `unitCostMinor` negativo, decimal, no numérico o > 18 dígitos ⇒ `INVENTORY_PURCHASE_LINE_INVALID`. (Añade el check de `unitCostMinor >= 0` explícito en la función si hoy solo lo cubre la tabla; que la prueba falle por `22000`, no por `23514`.)
   - `currency` `usd`/`US`/`USDD` ⇒ `INVENTORY_PURCHASE_PAYLOAD_INVALID`.
   - `idempotencyKey` ausente, vacío o con espacios laterales ⇒ `INVENTORY_PURCHASE_PAYLOAD_INVALID`.
   - Proveedor de **otro restaurante** ⇒ `INVENTORY_PURCHASE_SUPPLIER_SCOPE_INVALID` (fixture de dos restaurantes; ya hay helpers en el test).
   - Recepción guarda `received_by = actor` y `received_device_id = deviceId`; actor ajeno no cambia ni `received_by` ni el estado.

## Prohibido
- No ejecutes PostgreSQL (el orquestador corre `verify:inventory-schema:rollback`).
- No toques `20261126000100…00300`, `20261123000500`, `apps/**` ni el verificador (ya está cableado). Sin dependencias, sin commit, sin push.

## Puertas (Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
git diff --check
```

## Hecho cuando
- 00400 con idempotencia, auditoría y revoke; test ampliado con los casos listados.
- `typecheck`, `lint` y `git diff --check` verdes con salida real.
- Informe con archivos, decisiones (dedupe/carrera), bloques comando+salida y `git status --short`.
- Aplica Ponytail: cambio mínimo correcto, sin recortar validación, seguridad ni pruebas.
