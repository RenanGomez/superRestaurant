# web-order-actions-r5 (addendum al paquete r4; hallazgos Codex ronda 4)

## Tarea
web-order-actions-r5 · capa: L1 (`implementer-claude`, mismo escritor que r4) · riesgo: moderado · nivel C (sólo `apps/web`), más una prueba en `apps/api` si hace falta documentar la limitación. Sin cambios de contrato ni SQL.

## Objetivo
Cerrar los dos hallazgos de `codex exec review` ronda 4 (log `.claude/runs/web-order-actions/review-r4.log`) sobre HEAD `ecfd15d`:
- [P1] `runAction` reintenta `open`, `transitionItem` y `cancelItem` con los mismos ids tras un `unavailable`, pero esos métodos del API hacen `readExact` (conflict si la versión avanzó) antes de persistir, y `persist_order_mutation` sólo replica si `event_payload` y `result_order` son byte-idénticos (`supabase/migrations/20260902000200_create_orders_realtime.sql:251-256`); además `audit()` en `actions.ts:134-142` regenera `occurredAt` en cada llamada, así que el reintento nunca es byte-idéntico. Conclusión del orquestador: un replay real exige una búsqueda por clave de idempotencia en SQL (migración, nivel A, fuera de este corte). En este corte el reintento automático de mutaciones simples se elimina; sólo «Enviar a cocina» conserva su reintento porque es reanudable (omite líneas ya enviadas).
- [P2] `pendingOrderItemIds(detail)` puede superar `MAX_SEND_ORDER_TO_KITCHEN_ITEM_IDS = 200` y el parser rechaza el comando: el botón fallaría siempre en órdenes muy grandes.

## Criterios de aceptación (verificables)
- [ ] **P1 · occurredAt estable por intento**: `nextAttempt()` en `order-detail-panel.tsx` acuña también `occurredAt` (ISO) junto con `eventId`/`idempotencyKey`; las server actions de `actions.ts` reciben `occurredAt`, lo validan (timestamp ISO válido, no futuro más de 5 min, no más viejo de 24 h) con `parseAttemptIds` o un helper puro nuevo, y `audit()` lo usa en lugar de `new Date()`. Helper puro con prueba en `apps/web/src/lib/order-detail.ts`/`.test.ts`.
- [ ] **P1 · sin reintento ciego**: `runAction` sólo reintenta una vez cuando la acción es `sendToKitchen` y el error es `unavailable`. Para `open`, `transitionItem` y `cancelItem`, ante `unavailable` no se reintenta: se recarga el detalle (que refleja si la mutación quedó aplicada) y se muestra un mensaje explícito, p. ej. «No se pudo confirmar el resultado. Se recargó la orden; revisa el estado antes de repetir.» El siguiente intento del operador parte del detalle recargado (versión nueva, ids nuevos). Documentar en el comentario de `runAction` por qué (replay exige payload idéntico; sin búsqueda por clave en SQL).
- [ ] **P2 · lotes de 200**: «Enviar a cocina» divide `pendingOrderItemIds(detail)` en trozos de como máximo `MAX_SEND_ORDER_TO_KITCHEN_ITEM_IDS` (exportar/importar la constante desde shared-types, no duplicar el número), envía los trozos en secuencia con `expectedVersion` actualizado a partir de la respuesta anterior (`version` del `OrderMutationSummaryV1`; si la server action no la devuelve hoy, devolverla), con ids de intento propios por trozo reutilizados en el reintento de ese trozo; se detiene en el primer fallo, recarga el detalle y muestra el error. Helper puro `chunkOrderItemIds(ids, size)` con prueba.
- [ ] Sin `alert/confirm/prompt`; targets ≥44 px; sin cambios en `apps/api` ni `packages/shared-types` salvo exportar la constante si no estaba exportada en el índice.
- [ ] Commit(s) `fix(web): …` en la rama `claude/web-order-actions`.

## Archivos de entrada
- C:\tmp\sr-wt\web-order-actions\apps\web\src\app\app\orders\order-detail-panel.tsx (completo).
- C:\tmp\sr-wt\web-order-actions\apps\web\src\app\app\orders\actions.ts (completo).
- C:\tmp\sr-wt\web-order-actions\apps\web\src\lib\order-detail.ts y order-detail.test.ts.
- C:\tmp\sr-wt\web-order-actions\packages\shared-types\src\orders.ts (líneas 1-20 y 574-600): constante y parser.
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\supabase\migrations\20260902000200_create_orders_realtime.sql (líneas 250-262): por qué no hay replay.

## Invariantes que NO deben cambiar
- Servidor decide transiciones y permisos; el cliente sólo envía lo que vio.
- Un reintento jamás duplica una mutación: o es byte-idéntico y reanudable (sendToKitchen) o no existe.
- Sin dinero; sin SQL; contratos de Mobile/KDS intactos.

## Fuera de alcance
- Búsqueda por clave de idempotencia en SQL para replay de mutaciones simples (se registra como deuda nivel A); RBAC `orders.checkout`; `fulfillment` V2.

## Verificación
Mismo entorno que r4. Correr:
```bash
pnpm --filter @super-restaurant/web lint && pnpm --filter @super-restaurant/web typecheck && pnpm --filter @super-restaurant/web test && pnpm --filter @super-restaurant/web build
pnpm --filter @super-restaurant/shared-types build
pnpm --filter @super-restaurant/api typecheck
```

## Formato de salida esperado
Resumen (3-6 líneas), archivos y hashes, resultado final de cada comando, riesgos.
