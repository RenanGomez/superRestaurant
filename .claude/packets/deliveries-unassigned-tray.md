# deliveries-unassigned-tray · «Por asignar» calculado en el servidor

## Tarea
deliveries-unassigned-tray · capa: L1 (`implementer-claude`, razonamiento alto) · riesgo: moderado · **nivel A** por tocar `supabase/migrations` (lector autorizado) y un contrato consumido por web; no toca dinero. §19.3: revisión doble (Sonnet; Codex si hay cuota), corte en la tercera ronda. Deuda de D6 (HANDOFF 2026-10-05).

## Objetivo
Que la lista «Por asignar» de `/app/deliveries` la calcule el servidor: órdenes de canal `delivery` de la sucursal sin entrega activa, **incluidas las prepagadas** (status `paid` por tarjeta/transferencia, que hoy nunca aparecen) y sin depender de un corte de 100 filas filtrado en cliente.

## Hechos verificados (researcher 2026-10-05)
- `apps/web/src/app/app/deliveries/page.tsx:125-139` pide `requestBranchOrderWorkTray(…, scope, null, 100, "delivery")` y filtra en cliente `status in (open, partially_paid)` y `!knownOrderIds` (ids de la lista de entregas). Problemas: prepagadas (`paid`) excluidas; límite 100 sin cursor; estado de entrega inferido por diferencia de listas.
- Lector SQL `app_private.list_branch_order_work_items(p_actor_id, p_request jsonb)` en `supabase/migrations/20261002000100_branch_order_work_tray.sql:8-96`: filtro de canal en 28-29, join a `order_fulfillment_snapshots` en 63-67, **sin join a `order_deliveries`**; cursor durable; `schemaVersion: 1`. Adaptador `apps/api/src/branch-order-work-tray.ts:42-70` (`PostgresBranchOrderWorkTray`, request `{ after, channel, limit, schemaVersion, scope }`); servicio 69-89 sólo auth + parse.
- Contrato `BranchOrderWorkItemV1` en `packages/shared-types/src/branch-order-work-tray.ts:48-64` (channel, status, paymentIntent 42-46, fulfillmentChannel 51); sin estado de entrega.
- `order_deliveries` (`20261006000200_order_deliveries.sql:3-70`): estados `assigned|en_route|delivered|failed|settled`; sin fila = pendiente; prepago = orden `paid` antes del viaje (`settle_prepaid`). Una entrega `failed` vuelve a ser asignable.
- Lista de entregas y assign en `apps/api/src/order-deliveries*.ts`.

## Diseño (seguir salvo razón documentada)
1. **Migración nueva** `20261007000100_branch_order_work_tray_delivery_state.sql`: `create or replace` de `list_branch_order_work_items` con `left join lateral` a la última fila de `order_deliveries` por orden (misma sucursal/restaurante) y dos cambios aditivos: campo `deliveryState` (`null|assigned|en_route|delivered|failed|settled`) en cada ítem y filtro opcional de request `unassignedDeliveriesOnly: boolean` que, cuando es true, fuerza `channel = delivery`, admite status `open|partially_paid|paid` y exige `deliveryState is null or = failed`. Conservar grants (`EXECUTE` sólo `app_api`), `security definer`, `search_path = ''`, cursor y orden actuales. Prueba SQL en `supabase/tests/` (incluidas prepagadas, excluidas asignadas/en ruta/entregadas/liquidadas, incluidas `failed`, aislamiento entre sucursales). Sonda local PG17 (`probe:migration:rollback` o verificador rollback-only existente).
2. **Contrato aditivo**: `BranchOrderWorkItemV1.deliveryState` (opcional en parse, `null` por defecto) y `BranchOrderWorkTrayRequestV1.unassignedDeliveriesOnly?: boolean`; parser fail-closed con prueba.
3. **API**: `branch-order-work-tray.ts` pasa el flag al SQL y proyecta `deliveryState`; prueba del adaptador con la fila real `{ result }` y prueba de que el flag llega al request jsonb.
4. **Web** (mínimo, mismo PR): `deliveries/page.tsx` pide el tray con `unassignedDeliveriesOnly: true` y deja de filtrar por status/`knownOrderIds`; muestra «Pagada» en la tarjeta cuando `status = paid`; «Cargar más» con el cursor si la página ya lo tiene en `/app/orders`, si no, mantener límite 100 y documentarlo.

## Criterios de aceptación
- [ ] Prepagada de canal delivery sin entrega aparece en «Por asignar»; asignada/en ruta/entregada/liquidada no; `failed` sí.
- [ ] Migración candidata con prueba SQL y sonda local ok; contratos aditivos; typecheck web/mobile/kds verde.
- [ ] Puertas: shared-types test; api lint/typecheck/test/build; web lint/typecheck/test/build.
- [ ] Commits por unidad (db, shared-types, api, web); **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\deliveries-unassigned-tray\supabase\migrations\20261002000100_branch_order_work_tray.sql (completo), 20261006000200_order_deliveries.sql (1-120).
- C:\tmp\sr-wt\deliveries-unassigned-tray\apps\api\src\branch-order-work-tray.ts, branch-order-work-tray.test.ts, order-deliveries.ts (lista).
- C:\tmp\sr-wt\deliveries-unassigned-tray\packages\shared-types\src\branch-order-work-tray.ts.
- C:\tmp\sr-wt\deliveries-unassigned-tray\apps\web\src\app\app\deliveries\page.tsx (100-200) y `apps/web/src/lib/branch-order-work-tray.ts`.

## Invariantes
Alcance Restaurant/Branch en SQL; PII sólo con `customers.read` (no cambiar); sin tocar pagos, caja ni `order_deliveries` escrituras; no editar migraciones aplicadas; sin push.

## Fuera de alcance
Asignación automática, orden por promesa, courier sin `/orders/detail`.

## Formato de salida
Resumen, archivos y hashes, puertas y sonda, riesgos.
