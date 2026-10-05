# courier-order-detail · el repartidor ve las líneas y el total de su entrega

## Tarea
courier-order-detail · **API nivel A** (`implementer-claude`, razonamiento alto; autorización por pertenencia de entrega, PII del repartidor, dinero visible) + **web nivel C** (Codex con `-Base claude/courier-order-detail`). §19.3: A revisión doble, C una ronda. Deuda de D6 (HANDOFF 2026-10-04/05 «courier sin /orders/detail»).

## Objetivo
Que un usuario con rol `courier` abra el detalle de una orden **sólo si tiene su entrega asignada** (líneas, cantidades, notas, total, saldo a cobrar, intención de pago, dirección e instrucciones), sin otorgarle `orders.read` general ni exponer órdenes ajenas.

## Hechos verificados (researcher 2026-10-05)
- `apps/api/src/orders.ts:460-493` `POST /orders/detail`: exige `orders.read` (466), lee `deliveryContext.read()` (483), devuelve `OrderDetailV1` (items, totals, fulfillment, delivery, availableActions).
- RBAC `apps/api/src/auth/rbac-policy.ts:123`: courier = `branch.select`, `deliveries.read`, `deliveries.update.own`.
- `apps/api/src/deliveries.ts:154-176` `POST /deliveries/list` (`deliveries.read`): `BranchDeliveryItemV1` con totalMinor, remainingMinor, capturedMinor, delivery, sin líneas. SQL `20261006000200_order_deliveries.sql:672-715` `list_branch_deliveries` filtra `(v_manager or d2.courier_user_id = p_actor_id)` (701); PII del courier sólo en sus filas.
- Web `apps/web/src/app/app/deliveries/page.tsx:257-272` `DeliveryCard`: sin botón de detalle; vista de courier en 88.

## Diseño (seguir salvo razón documentada)
1. **Permiso nuevo** `deliveries.read.own-order` (o reutilizar `deliveries.update.own` como señal de «propio») en `rbac-policy.ts` para `courier` y para los roles que ya tienen `orders.read` no cambia nada.
2. **Endpoint** `POST /deliveries/order-detail` (`deliveries.controller.ts` + `deliveries.ts`): body = `OrderDetailRequestV1` (mismo contrato). Flujo: `authorizeBranch(..., "deliveries.read")` → si el actor tiene `orders.read`, delegar en el detalle normal; si no, verificar pertenencia **en SQL** con una lectura nueva o existente (`order_deliveries.courier_user_id = actor` para ese `restaurant/branch/order` y estado `assigned|en_route|delivered` o `failed` reciente; si `list_branch_deliveries` ya la garantiza, reutilizarla filtrando por `orderId`) → si no es suya: 403 `ACTION_NOT_AUTHORIZED` (no 404 que revele existencia). Luego **lectura interna** del detalle que no vuelva a exigir `orders.read`: refactorizar `OrderService.detail` en `authorize` + `readDetailForActor(actorId, scope, orderId, options)`; `availableActions` vacío para el courier (sus acciones viven en entregas); `delivery` con PII (excepción aprobada 2026-10-04) sólo porque la entrega es suya.
3. **Contrato**: sin cambios en `OrderDetailV1`. Si hace falta un lector SQL nuevo de pertenencia, migración `20261007000300_delivery_order_ownership.sql` con prueba SQL de aislamiento (courier A no ve la entrega de courier B; manager sí) y sonda local PG17; preferir **sin migración** si la lectura existente basta.
4. **Pruebas API**: courier con entrega asignada → 200 con líneas y total; courier sin esa entrega → 403; courier con entrega `settled` → decisión: 200 (historial del día) documentada; manager → delega al detalle normal; adaptador con fila real `{ result }`; contract test HTTP.
5. **Web (Codex, nivel C)**: en la vista de repartidor de `/app/deliveries`, botón «Ver pedido» en cada tarjeta (44 px) que abre un panel/hoja con líneas (cantidad × nombre, tamaño/mitades, nota), total, pagado, **saldo a cobrar** destacado y método previsto; reutilizar el panel de detalle de `/app/orders` si es componible, con las acciones ocultas; cerrar con Esc y foco contenido; sin alert/confirm.

## Criterios de aceptación
- [ ] Courier abre sólo sus entregas; 403 en ajenas; manager intacto.
- [ ] Puertas: api lint/typecheck/test/build; typecheck web/mobile/kds; si hay migración, prueba SQL + sonda local. Web (Codex): lint/typecheck/test/build.
- [ ] Commits por unidad; **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\courier-order-detail\apps\api\src\orders.ts (440-500 y la lectura de detalle), deliveries.ts (120-200), deliveries.controller.ts, auth\rbac-policy.ts (100-140), deliveries.test.ts, orders.test.ts (detalle).
- C:\tmp\sr-wt\courier-order-detail\supabase\migrations\20261006000200_order_deliveries.sql (660-720).
- Web: apps\web\src\app\app\deliveries\page.tsx, apps\web\src\app\app\orders\order-detail-panel.tsx, apps\web\src\lib\order-detail.ts.

## Invariantes
Autorización en servidor por pertenencia; sin fuga entre couriers ni sucursales; PII sólo de entregas propias; sin cambios de dinero; sin push; no editar migraciones aplicadas.

## Fuera de alcance
Acciones de orden para el courier, cobro desde el detalle (sigue en «Liquidar»).

## Formato de salida
Resumen, archivos y hashes, puertas (y sonda si hay SQL), riesgos.
