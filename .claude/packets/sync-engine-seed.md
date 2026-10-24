# sync-engine-seed · `packages/sync-engine` como semilla de la Fase 3 (offline-first)

## Tarea
sync-engine-seed · capa L1 `implementer-claude` · **nivel A** (contrato de sync y dinero) · riesgo moderado. Rama `claude/sync-engine-seed` desde `main`. Paquete nuevo, puro, sin red ni SQL; nada en `apps/` ni en `packages/shared-types`.

## Objetivo
Crear `packages/sync-engine` en el repo principal: un motor de outbox/pull del lado del dispositivo que implemente **al pie de la letra** `docs/architecture/OFFLINE_SYNC_CONTRACT.md` (§3 envelope, §3.1, §3.2, §5, §5.2, §5.3, §6.1, §6.2, §7.1, §7.2, §10, §11 en lo que toca al cliente, §12 en validación de payload), usando como punto de partida el código de `C:\Users\Emmanuel G\Desktop\superRestaurant\packages\sync-engine\src\index.ts` (443 líneas; lectura externa, no copiar a ciegas) y los tipos de `C:\Users\Emmanuel G\Desktop\superRestaurant\packages\shared-types\src\index.ts` líneas 297-421.

## Hallazgos de la revisión previa (reviewer, 2026-10-22) que el port DEBE corregir
1. Estados del outbox: usar exactamente `pending | sending | retry_wait | accepted | duplicate | rejected | conflict | manual_review` con las transiciones de §7.1. Falta hoy: lease durable en `sending` (`leaseUntil`, `attemptId`), backoff con jitter determinista inyectable en `retry_wait`, recuperación de `sending` a `pending` al vencer el lease, terminales inmutables.
2. Identidades: `eventId`, `deviceId`, `entityId` como UUID (usar un puerto `IdGeneratorPort` inyectado; implementación por defecto con `globalThis.crypto.randomUUID`; **sin** `node:crypto`). Validar formato UUID/ULID en el envelope.
3. `localSequence`: global por `deviceId`, asignada y persistida en la **misma** operación atómica que el envelope y la escritura de réplica local; `enqueue` serializado (cola de promesas interna) para que dos `enqueue` concurrentes nunca repitan secuencia; rechazar al hidratar un estado con secuencia repetida o retrocedida.
4. `idempotencyKey` reutilizada con tipo/entidad/operación/scope/**huella de payload** distinta → error `IDEMPOTENCY_KEY_REUSE`; igual huella → devolver el evento existente.
5. Push por lote: un lote por scope, en orden de `localSequence`, tamaño máximo configurable; exigir **un resultado por evento** (evento sin resultado → `retry_wait` con motivo `MISSING_RESULT`); mapear `accepted|duplicate|rejected|conflict|manual_review` según §5.2; `retryable` explícito en errores de transporte; `retryCount` sólo se incrementa para los eventos del lote que falló.
6. Cursor de pull: `string | null` **opaco**, por scope, persistido sólo junto con el lote aplicado (§6.2, una sola `persist`); `hasMore` → seguir paginando hasta `false` o hasta `maxPagesPerSync`; error de cursor inválido/expirado/de otro scope → estado `resync_required` del scope sin saltos silenciosos. Push jamás avanza el cursor.
7. Pull: rechazar cualquier cambio cuya `restaurantId`/`branchId` no coincida con el scope pedido (error explícito, lote descartado, cursor no avanza). Orden por `canonicalVersion`; igual versión no sobrescribe. Tombstone: un cambio no-tombstone con versión mayor sobre un tombstone **no resucita** la entidad; updates atrasados sobre tombstone se descartan.
8. Conflictos: un evento en `conflict` o `manual_review` **bloquea** el envío de eventos posteriores de la misma `entityId` (quedan `pending` con `blockedBy`).
9. Revocación: resultados o errores `AUTH_REVOKED` / `DEVICE_REVOKED` ponen el scope en `revoked`, impiden `enqueue` y push, y los eventos financieros (`entityType` Payment/CashMovement) pendientes pasan a `manual_review`.
10. Payload: validar objeto plano serializable, profundidad ≤ 8, tamaño ≤ 64 KiB, y **rechazar** claves/valores que parezcan PAN (13-19 dígitos que pasen Luhn), CVV (`cvv|cvc`), `password|secret|token`. Dinero dentro del payload sólo como `{ amountMinor: entero, currency: ISO-4217 }`; cualquier `number` no entero bajo claves `amount*|total*|price*` se rechaza.
11. Inmutabilidad profunda: `deepFreeze` de envelopes, snapshots y estado hidratado; `loadState` valida con parser runtime (sin `as` ciego).
12. Sin textos de UI en el motor: `getStatusSummary` devuelve códigos, no frases en español.
13. Tipos propios en `src/contract.ts` (envelope de 17 campos de §3, `SyncPushRequest/Response`, `SyncPullRequest/Response`, `SyncEventResult`, estados). Reusar sólo `BranchScope`/`parseBranchScope` de `@super-restaurant/shared-types`. **No** modificar `shared-types`.

## Estructura del paquete (copiar de `packages/printing`: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsconfig.test.build.json`, `eslint.config.mjs`)
- `src/contract.ts` tipos + parsers runtime (`parseSyncEnvelope`, `parsePullResponse`, `parsePushResponse`).
- `src/outbox-state.ts` máquina de estados pura (`transitionOutboxState(current, event)`), con tabla de transiciones.
- `src/payload-guard.ts` validación §12 (`assertSafePayload`, Luhn, profundidad, tamaño, dinero).
- `src/engine.ts` `DeviceSyncEngine` con puertos `DurableSyncStoragePort` (`loadState`, `persist(state)` atómico), `SyncTransportPort` (`push`, `pull`), `IdGeneratorPort`, `ClockPort`, `BackoffPolicy`.
- `src/in-memory-storage.ts` implementación de referencia para pruebas (con opción de fallar el commit para probar atomicidad).
- `src/index.ts` re-exports.
- Pruebas `*.test.ts` con `node:test` + `node:assert/strict` (mismo estilo que `packages/printing/src/print-job-queue.test.ts`).

## Pruebas mínimas (una por punto; nombres en español como en el repo)
1. Envelope: campos ausentes, tipos incorrectos, scope inválido, `schemaVersion` desconocida, `occurredAt` no RFC 3339, `baseVersion` negativo → errores de dominio, nunca `TypeError`.
2. `localSequence` global entre dos scopes y tras reinicio (rehidratar y seguir); dos `enqueue` concurrentes (`Promise.all`) → secuencias distintas y consecutivas; estado hidratado con secuencia retrocedida → rechazado.
3. Réplica + outbox + secuencia en una sola `persist`; si `persist` falla, nada queda escrito ni la secuencia avanza.
4. Máquina de estados completa: todas las transiciones de §7.1 permitidas y las prohibidas rechazadas; terminales inmutables.
5. Lease de `sending` vencido → vuelve a `pending`; `retry_wait` con backoff y `retryCount` persistido; límite de reintentos → `manual_review`.
6. Push: resultado por cada evento; evento sin resultado → `retry_wait`/`MISSING_RESULT`; `duplicate` usa el resultado original; timeout tras commit del servidor y reenvío con el mismo `eventId` → `duplicate` sin efecto doble.
7. `accepted`/`duplicate` no avanzan el cursor; pull fallido conserva el cursor.
8. Pull: cursor opaco persistido con el lote; `hasMore` paginado; cambio fuera de scope → lote rechazado y cursor intacto; error de cursor inválido → `resync_required`.
9. Tombstone: bloquea update atrasado; no resucita; `entityId` no se recrea.
10. Aislamiento: dos restaurantes y dos sucursales en el mismo dispositivo: cero lecturas cruzadas en réplica, outbox y resumen; `IDEMPOTENCY_KEY_REUSE` con payload distinto.
11. Revocación: `DEVICE_REVOKED` bloquea `enqueue` y push del scope; evento de pago pendiente → `manual_review`.
12. Payload: PAN que pasa Luhn, `cvv`, `password`, profundidad 9, 65 KiB, `amount: 10.5` → rechazados; `{ amountMinor: 1050, currency: "MXN" }` → aceptado.
13. `conflict` en un evento bloquea el envío de los posteriores de la misma entidad; resolverlo (nuevo evento autorizado) los desbloquea.

## Invariantes
Sin `any`, sin float para dinero, sin `alert/confirm/prompt`, sin dependencias nuevas, sin `node:*` en `src/` salvo en pruebas, sin textos de UI, scope Restaurant/Branch validado en **toda** entrada pública. LF. Nada fuera de `packages/sync-engine/` salvo que turbo/pnpm necesiten registrar el paquete (no debería: `pnpm-workspace.yaml` ya incluye `packages/*`).

## Verificación (Node 24.19.0 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`; si falta `node_modules`: `pnpm install --frozen-lockfile --offline` y `pnpm --filter @super-restaurant/shared-types build`)
- `pnpm install --frozen-lockfile --offline` (registra el workspace nuevo; si el lockfile cambia, commitearlo)
- `pnpm --filter @super-restaurant/sync-engine lint`
- `pnpm --filter @super-restaurant/sync-engine typecheck`
- `pnpm --filter @super-restaurant/sync-engine test`
- `pnpm --filter @super-restaurant/sync-engine build`
- `pnpm typecheck` (global, con turbo)

## Formato de salida esperado
1. Resumen (3-6 líneas) incluyendo qué puntos de §7.1/§5/§6 quedaron fuera si alguno. 2. Archivos tocados. 3. Salida literal de los comandos, incluido el conteo de pruebas. 4. Riesgos o dudas. Commits locales con conventional commits en la rama. Sin merge ni push.
