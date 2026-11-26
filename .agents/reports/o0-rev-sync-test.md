VEREDICTO: APROBAR
P2 apps/api/src/sync/sync-merge-executor.ts:41 el `correlationId` es un `randomUUID()` nuevo por evento, no el `x-correlation-id` de la request (app-setup.ts:30) ni el del batch que ya usa `SyncOmissionLogger` (sync-push.service.ts:19); el rechazo no se puede unir a su request y el test (sync-push.test.ts:106) solo valida la forma del UUID, no la correlación.
P3 apps/api/src/sync/sync-merge-executor.ts:119 el log emite `code=DEVICE_REVOKED` cuando `reason=DEVICE_UNKNOWN`; una alerta/panel que filtre por `code` cuenta dispositivos sin registrar como revocados y ninguna prueba fija que ambos campos discrepen a propósito.
P3 apps/api/src/sync/sync-merge-executor.ts:46,49 sin prueba para `reason=AUTH_REVOKED` del token rechazado ni para `INVALID_SCOPE`: renombrar/borrar esas ramas deja la suite en verde (sync-push.test.ts:97 solo compara tres pares code/reason).
P3 apps/api/src/sync/sync-merge-executor.ts:49 `INVALID_SCOPE` sí es alcanzable (isSyncId acepta ULID, packages/shared-types/src/sync.ts:321, y el ejecutor solo UUID) y devuelve `AUTH_REVOKED`, que revoca el scope del cliente; el nuevo log es ahora la única señal de ese caso y no se prueba (lógica pre-existente).
P3 apps/api/src/sync/sync-merge-executor.ts:46 en el camino no autenticado se loguean restaurantId/branchId/deviceId/eventId del sobre sin verificar; un cliente anónimo puede inundar o envenenar paneles con ids arbitrarios, sin prueba ni límite.
P3 apps/web/src/lib/offline/sync-transport.test.ts:258 si el default vuelve a `?? 0` la prueba no falla: se cuelga (node:test sin timeout), verificado abajo contra el mismo bloque de `send`.

Prueba adversarial (foco tests) — transcripción verbatim de `classifyRejection` (executor:27-31) y de `send()` (sync-transport.ts:106-128), ejecutada con `@'…script…'@ | node --input-type=module`:
```
[ok] classifyRejection: 5 razones mapeadas; wire solo AUTH_REVOKED/DEVICE_REVOKED
[ok] sin timeoutMs: setTimeout agendado con 30000 ms
[ok] al disparar 30 s: signal.aborted = true y rechazo TRANSPORT_ERROR retryable
[ok] timeoutMs=0 (equivalente al '?? 0' anterior): 0 timers, promesa sigue 'pending' tras 60 ms -> la prueba del default quedaria COLGADA, no en rojo
```
NO VERIFICADO: ejecución de la suite real y del módulo compilado (plan mode read-only: no puedo escribir `.test-dist` ni compilar); la evidencia anterior sale de la transcripción ejecutada. Sí verifiqué por lectura que el contrato admite los códigos nuevos (`SyncEventResultV1.code: string | null`), por lo que el `shortcut` está permitido por el fallback del brief, y que `REVOCATION_CODES` solo revoca `AUTH_REVOKED`/`DEVICE_REVOKED` (packages/sync-engine/src/engine.ts:717).
No hay P1 abierto: las cuatro invariantes que el autor afirma tienen prueba que falla si se rompen (código en el wire, `reason` en el log, token fuera del log, default de 30 s).