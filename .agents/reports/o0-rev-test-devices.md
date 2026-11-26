I'll start by inspecting the diff and branch state.
VEREDICTO: CAMBIOS

P1 apps/web/src/components/offline-runtime-mount.tsx:9 — el `deviceId` es una sola clave localStorage del navegador, pero `sync_register_device` ata la fila al **actor** (`on conflict do nothing`; 20261123000300_sync_ledger.sql:142) y `sync_device_state` es por actor: el segundo cajero del mismo tablet queda `unknown` y recibe 403 para siempre; el puente marca `sync_blocked` y bloquea push y pull sin recuperación. Ninguna prueba del diff cubre un segundo actor.
P1 apps/web/src/lib/offline/web-sync-bridge.test.ts:400 — el test afirma "antes del primer push" pero registra en `registered[]` y pushes en `base.keys[]` sin orden: mover la llamada de registro después de `engine.sync` lo deja verde.
P2 apps/web/src/lib/offline/web-sync-bridge.ts:359 — `if (registerDevice === undefined) return true` conserva el camino que revoca el scope de forma permanente (`DEVICE_REVOKED`) para cualquier transporte sin el método opcional; el test "sin registro en el transporte" lo fija.
P2 apps/web/src/lib/offline/web-sync-bridge.ts:400 (docstring) — afirma "retried on the next sync until it succeeds" y solo se prueba el 403 terminal; no hay prueba de fallo retryable→éxito.
P2 apps/api/src/sync/sync-device.service.ts:19 — `registered !== true` mezcla "dispositivo revocado / atado a otro actor" con "sin membresía" y responde `SYNC_SCOPE_FORBIDDEN`.
P3 apps/api/src/sync/sync-device.service.ts:50 — rama `42501` inalcanzable: `sync_register_device` solo retorna false, nunca eleva 42501.
P3 apps/api/src/sync/sync-device.service.ts:22 — devuelve `{status:"active"}` y el brief pide `"registered"`; el código coincide con el test PG existente, el brief está desfasado.

```
$ git show harness/o0-sync-devices:apps/web/src/components/offline-runtime-mount.tsx | Select-String DEVICE_ID_STORAGE_KEY
9:const DEVICE_ID_STORAGE_KEY = "sr-web-device-id";
$ ...:20261123000300_sync_ledger.sql | Select-String 'on conflict do nothing'
142:values(p_restaurant,p_branch,p_device,p_actor) on conflict do nothing;
$ git grep -n sync_device_state ... supabase
supabase/tests/sync_ledger_invariants.sql:26: ... sync_device_state(r,b,'device-1',kitchen) <> 'unknown' ...
```
NO VERIFICADO: prueba adversarial propia escrita/ejecutada — sesión en plan mode de solo lectura, prohibido crear archivos en `.harness/state/tmp/` o compilar; los hallazgos salen de lectura de la rama con `git show`/`git grep`.