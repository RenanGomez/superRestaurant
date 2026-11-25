# Brief m3-int-sale-to-stock (nivel A · integración venta→stock por HTTP + PostgreSQL)

## Objetivo
Probar de punta a punta, contra PostgreSQL local desechable y el API real, que una venta confirmada descuenta inventario y que la cancelación lo repone; cubrir también el caso sin receta y el camino `applied` del envoltorio de confirmación.

Tiempo estimado: 45 min. Escritor único de `apps/api/src/operations/http-flow*` y `apps/api/package.json`.

## Contexto
- El arnés `pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only` levanta PostgreSQL 17 desechable, aplica migraciones, siembra fixtures, arranca Nest en un puerto efímero y ejecuta varios flujos (`http_flow`, `http_flow_delivery`, `http_flow_cancellation`, `http_flow_day_summary`, …). Hoy los flujos pasan 7/7 con el cableado de inventario, pero **sin** almacén por defecto: el consumo se salta.
- `20261126000500_inventory_sale_consumption.sql`: el consumo usa el almacén `is_default` activo de la sucursal; sin él devuelve `skipped`. El envoltorio de confirmación devuelve `{...result, inventory:{status,movements}}`.
- `20261126000400`: tabla de compras (no aplica aquí). `app.inventory_items`, `app.inventory_warehouses`, recetas (`app_private.publish_inventory_recipe`), `app.inventory_movements`/`balances`.

## Qué hacer
1. En el arnés HTTP local, añade un flujo nuevo `http_flow_inventory` (archivo nuevo o rama del harness ya existente, siguiendo su estructura de `runId`, fixtures marcadas y cleanup):
   - Siembra (como postgres o `app_api` con actor fixture): insumo `flour` con saldo inicial por `inventory_record_movement` (`receipt`), almacén de la sucursal con `is_default=true`, y receta activa para el producto del catálogo que usa el flujo de confirmación (reutiliza el producto ya publicado en las fixtures del arnés; no inventes otro catálogo).
   - Confirma una captura real por el API (mismo recorrido que el flujo de confirmación existente) y verifica por SQL: `app.inventory_consumptions` con `cause='sale'`, un `sale_consumption` por insumo con la cantidad de la receta × cantidad de línea, y el saldo descontado.
   - Cancela la línea (o la orden) por el API y verifica `sale_reversal` con `compensates_movement_id`, saldo restaurado y `cause='cancel'`.
   - Reenvía la confirmación (replay) y comprueba que no se duplican movimientos.
   - Caso sin receta: una línea de otro producto no genera movimientos ni fila de consumo.
   - Limpieza total al salir (mismo patrón que los demás flujos: `local_cleanup` con `stopped:true`).
2. Engancha el flujo al script (`test:http:local`) sin romper el modo `--local-disposable-only`; si el arnés filtra por nombre, añade el nuevo al conjunto por defecto.
3. No toques migraciones ni el API de producto; si necesitas un fixture nuevo, va en el arnés (no en `supabase/`).

## Puertas
El orquestador ejecutará `pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only` con `LOCAL_POSTGRES_BIN`. Tú ejecuta solo typecheck y lint del API (no levantes PostgreSQL).

## Hecho cuando
El flujo nuevo pasa (o queda listo con la salida real si el orquestador debe correrlo), typecheck/lint verdes, informe con archivos, decisiones de fixture y `git status --short`. Sin commit ni push. Aplica Ponytail.
