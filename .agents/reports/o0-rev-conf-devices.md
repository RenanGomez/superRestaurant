VEREDICTO: APROBAR

P3 apps/web/src/lib/offline/web-sync-bridge.ts:379 `ensureDeviceRegistered` condiciona TODO `syncNow` (push y pull): un fallo de registro, aunque sea retryable (404/429/5xx), omite `engine.sync` y bloquea también la lectura; fail-closed aceptable, pero acopla pull a un endpoint de escritura. Prueba: línea 379 retorna antes de `engine.sync`.
P3 apps/api/src/sync/sync-device.service.ts:51 mapea SQLSTATE 42501/22P02 que `sync_register_device` nunca emite (devuelve boolean; un 23514 `check_violation` quedaría 500). Inalcanzable por la prevalidación `isSyncId`+lowercase; solo ruido. Prueba: `sync_ledger.sql:138-144`.
P3 apps/web/src/app/api/sync/sync-proxy.ts:26 el docstring sigue diciendo `POST /api/sync/{push|pull|snapshot}` sin `devices`; comentario, no comportamiento.

Invariantes revisados sin P1/P2: dinero/cantidades sin float (no tocado); idempotencia de registro (`on conflict do nothing` + PK restaurant/branch/device, no resetea `last_local_sequence`); scope por Restaurant/Branch y `sync_authorized`; device no se transfiere a otro actor ni resucita tras `revoked_at`; auditoría (`actor_id`/`created_at`/`revoked_by`). El endpoint nuevo conserva la ruta `POST /sync/devices` ya existente (antes en `SyncReviewController`), sin cambio de contrato.

```
$ git grep -n -e "on conflict do nothing" harness/o0-sync-devices -- supabase/migrations/20261123000300_sync_ledger.sql
harness/o0-sync-devices:supabase/migrations/20261123000300_sync_ledger.sql:142: insert into app.sync_devices(...) values(...) on conflict do nothing;

$ git grep -n "revoked device cannot come back over HTTP" harness/o0-sync-devices -- apps/api/src/sync/sync-conflicts.local.test.ts
...sync-conflicts.local.test.ts:572: ...registerSyncDevice(transport, "manager", scopeA1, revokeDevice)).status, 403, "a revoked device cannot come back over HTTP");
```

NO VERIFICADO: ejecución de suites (modo solo-lectura activo: no se creó `.test-dist` ni se copiaron archivos a tmp); hallazgos basados en inspección de fuente y diff.