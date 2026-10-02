# web-order-actions-r12 · envío a cocina atómico con identidad de comando persistida

## Tarea
web-order-actions-r12 · capa: L1 (`implementer-claude`, razonamiento alto) · riesgo: alto · **nivel A** (migración SQL nueva + `apps/api/src/orders.ts` idempotencia de mutaciones de orden). Sin cambio de contrato público (`SendOrderToKitchenCommandV1` se mantiene); web no cambia.

## Por qué
Ocho rondas de `codex exec review` (logs `.claude/runs/web-order-actions/review-r4..r11.log`) demostraron que `sendToKitchen` implementado como N llamadas a `persist_order_mutation` no puede ser a la vez (a) reanudable tras respuesta perdida y (b) seguro frente a comandos obsoletos, porque el payload del comando no se persiste y `persist_order_mutation` sólo replica pasos byte-idénticos (`supabase/migrations/20260902000200_create_orders_realtime.sql:250-262`). Último P1 (r11): un lote parcialmente persistido no se reanuda; el reintento idéntico devuelve `conflict`. Decisión del orquestador: hacer el envío **atómico en SQL** con **idempotencia a nivel de comando**: o se persisten todos los pasos o ninguno, y un reintento byte-idéntico devuelve el resultado almacenado.

## Objetivo
Una función `app_private.send_order_to_kitchen` que aplique en una sola transacción la apertura del borrador (si procede) y la transición `pending→sent` de las líneas listadas, registrando el comando con su `idempotencyKey` y devolviendo el mismo resultado en reintentos; `OrderService.sendToKitchen` la usa y deja de encadenar `persistRaw`.

## Hechos verificados
- `persist_order_mutation(uuid,bigint,jsonb,jsonb)` definida en `20260902000200_create_orders_realtime.sql:169-440` (advisory lock por orden, idempotencia por `(actor, restaurant, branch, idempotency_key)` en `app.order_audit_events`, compara payload y result_order, verifica `version = p_expected_version`, inserta evento y devuelve `{status, order, version, kdsEvent}`). No fue reemplazada por migraciones posteriores (grep en `supabase/migrations`).
- El adaptador `PostgresOrderPersistenceAdapter.persist` (`apps/api/src/orders.ts:134-191`) llama `persistOrderSql`/`cancelOrderItemSql` y valida la respuesta; `OrderService.sendToKitchen` actual (`orders.ts:~430-500`) construye un paso `open` + un paso por línea con claves derivadas (`derivedUuid`, `stepAuditContext`).
- Migración más reciente: `20261002000100_branch_order_work_tray.sql` (patrón de cabecera, owner, revoke/grant a `app_api`, comment). Pruebas SQL en `supabase/tests/*.sql` (p. ej. `branch_order_work_tray_invariants.sql`); runners rollback-only en `apps/api/src/operations/run-*-verification.ts` y `run-migration-rollback-probe.js`.
- `OrderMutationSummaryV1` tiene un único `kdsEvent`; el lote produce varios.

## Diseño (seguir salvo razón documentada)
1. **Migración** `supabase/migrations/20261003000100_send_order_to_kitchen.sql`:
   - Tabla `app.order_command_events` (id uuid pk, restaurant_id, branch_id, order_id, actor_id, device_id, command_kind text check in ('send_to_kitchen'), event_id uuid, idempotency_key text, command_payload jsonb, result jsonb, created_at timestamptz; unique `(actor_id, restaurant_id, branch_id, idempotency_key)`; checks de forma como `order_audit_events`; RLS habilitada sin políticas para `authenticated`; sólo `app_private` escribe).
   - Función `app_private.send_order_to_kitchen(p_actor_id uuid, p_expected_version bigint, p_command jsonb, p_steps jsonb) returns jsonb`, `security definer`, `set search_path = pg_catalog, app, app_private`: valida forma; advisory lock por orden (misma clave que `persist_order_mutation`); busca el comando por clave: si existe y `command_payload = p_command` → devuelve `result` con `status: 'replayed'`; si existe y difiere → `{status:'conflict'}`; si la versión actual de la orden ≠ `p_expected_version` → `{status:'conflict'}`; si `p_steps` está vacío → `{status:'conflict'}`; aplica cada paso llamando `app_private.persist_order_mutation(p_actor_id, v, step->'order', step->'audit')` con `v` encadenada desde `p_expected_version`; si algún paso devuelve `status <> 'saved'` → `raise exception` con SQLSTATE propio capturado en un bloque `begin … exception` que devuelve `{status:'conflict'}` (todo revertido); al terminar inserta el comando con `result = {schemaVersion:1, scope, status:'saved', order, version, kdsEvents:[...]}` y lo devuelve. Owner postgres; revoke public; grant execute sólo a `app_api`; comment.
   - Prueba `supabase/tests/send_order_to_kitchen_invariants.sql` siguiendo el patrón existente: éxito total con 2 líneas (versión +3 desde borrador); reintento byte-idéntico → `replayed` con el mismo resultado y sin eventos nuevos; misma clave con payload distinto → `conflict`; versión obsoleta → `conflict` sin eventos; fallo en el segundo paso (línea ya cancelada) → `conflict` y **cero** eventos persistidos (atomicidad); `authenticated` sin EXECUTE; otro restaurante → forbidden/conflict sin fuga.
   - Verificación local: usar el mismo mecanismo que las pruebas SQL existentes (ver README y runners); si sólo existe verificación contra el remoto, dejar lista la sonda rollback-only (`apps/api/dist/operations/run-migration-rollback-probe.js`) y **no ejecutarla contra el remoto**: eso lo hace el orquestador.
2. **API**: `OrderPersistencePort.sendToKitchen(actorId, expectedVersion, command, steps)` + implementación en el adaptador (`sendOrderToKitchenSql`), validando la respuesta como hace `persist` (orden decodificada, `version === expectedVersion + steps.length` cuando `saved`, `kdsEvents` parseados). `OrderService.sendToKitchen`: lee la orden; si `stored.version !== expectedVersion` llama igualmente a SQL con `steps: []` para obtener `replayed` o `conflict` (la identidad del comando vive en SQL); si coincide, construye los pasos con el dominio (`transitionOrderStatus` open si `draft`, luego `transitionOrderItemStatus` por línea listada aún `pending`, claves derivadas como hoy), aplica la guarda r8 (borrador sin líneas listadas pendientes → conflict) y la de ids ajenos (`not_found`), llama a SQL y notifica cada `kdsEvent` cuando `saved`. `p_command` = el comando parseado tal cual (JSON canónico). Resumen: `OrderMutationSummaryV1` con `kdsEvent` = último evento o `null` (no cambiar el contrato; documentar). Pruebas en `orders.test.ts` con un puerto falso que modele la función (replay por clave, conflict por payload, atomicidad); eliminar `persistRaw` y el puerto falso `fakeConcurrentSendToKitchenPort` si quedan sin uso.
3. **Docs**: comentario de cabecera de `sendToKitchen` con la regla: «atómico; reintento byte-idéntico replica; cualquier otra diferencia es conflict».

## Criterios de aceptación
- [ ] Migración candidata reproducible desde cero, con prueba SQL y sonda rollback-only preparada.
- [ ] `sendToKitchen` nunca deja un lote parcial; reintento byte-idéntico → `replayed: true`; clave reutilizada con payload distinto, versión obsoleta o línea ajena → `conflict`/`not_found` sin efectos.
- [ ] Contratos públicos y Mobile/KDS intactos; web sin cambios (compila contra el mismo endpoint).
- [ ] Puertas: `pnpm --filter @super-restaurant/api test && typecheck && lint && build`; `pnpm --filter @super-restaurant/web typecheck && build`; `pnpm --filter @super-restaurant/mobile typecheck && pnpm --filter @super-restaurant/kds typecheck`.
- [ ] Commits por unidad: `feat(db): …` (migración + test SQL) → `feat(api): …` → `test(api): …`. Informe parcial a los ~35 turnos.

## Archivos de entrada
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.ts (40-215 adaptador; 425-520 servicio).
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.test.ts (560-900).
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\supabase\migrations\20260902000200_create_orders_realtime.sql (30-100 tabla de auditoría; 165-300 función).
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\supabase\migrations\20261002000100_branch_order_work_tray.sql (patrón de migración reciente).
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\supabase\tests\branch_order_work_tray_invariants.sql y supabase\tests\README.md si existe (patrón de pruebas SQL).
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\api\src\operations\run-migration-rollback-probe.ts (sonda).

## Invariantes
Dinero intacto; alcance Restaurant/Branch en SQL y API; auditoría por paso conservada (los pasos siguen pasando por `persist_order_mutation`); registros inmutables; ningún cliente decide; no editar migraciones aplicadas; sin push ni Supabase remoto.

## Fuera de alcance
Replay de `open`/`transitionItem`/`cancelItem` simples (siguen sin reintento automático en web); RBAC `orders.checkout`; `fulfillment` V2.

## Formato de salida
Resumen con la regla final, archivos y hashes, resultado final de cada puerta y de la prueba SQL (cómo se ejecutó), riesgos.
