VEREDICTO: APROBAR
P2 apps/web/src/components/offline-runtime-mount.tsx:9 el `deviceId` es único por navegador (localStorage) mientras `sync_register_device` ata el dispositivo a un actor y no lo transfiere ni lo reasigna tras revocarlo; un segundo actor en la misma terminal/sucursal recibe 403, `web-sync-bridge.ts:365-369` fija `sync_blocked` y `:379` aborta push y pull sin recuperación salvo borrar localStorage. Prueba: `sync-conflicts.local.test.ts:570,572` (403 en ambos casos).
P3 apps/web/src/lib/offline/sync-transport.ts:191 no hay prueba de transporte para `registerDevice` (URL/cuerpo); solo se prueba el proxy y el puente con un transporte falso, no que `POST /sync/devices` reciba `{deviceId,scope}`.
P3 apps/api/src/sync/sync-device.service.ts:52 los SQLSTATE no mapeados se relanzan tal cual; un `57014` por `statement_timeout` (`database.ts:111`) sale como 500 con mensaje de Postgres.
P3 apps/web/src/app/api/sync/sync-proxy.ts:31 el doc del proxy sigue enumerando `{push|pull|snapshot}` y omite `devices`.
Invariantes verificados: sin float ni montos nuevos en el diff; registro idempotente y no transferible (`sync_ledger_invariants.sql:25`, `sync-conflicts.local.test.ts:569-570`); scope validado por `sync_authorized` y tenant ajeno 403 (`sync-conflicts.local.test.ts:571`); device revocado no revive (`sync_ledger_invariants.sql:81`, `test:572`); el registro solo inserta en `sync_devices` y no toca ledger ni evidencia.
NO VERIFICADO: ejecución de las suites (modo lectura; no se compiló `.test-dist`); verificación estática vía `git show`/`git grep`.

```powershell
$ git show origin/main:supabase/migrations/20261123000300_sync_ledger.sql | Select-Object -Skip 136 -First 8
-- Registration cannot transfer an existing device to another actor.
create function app_private.sync_register_device(p_actor uuid, p_restaurant uuid, p_branch uuid, p_device text)
returns boolean language plpgsql security definer set search_path = '' as $f$
begin
 if not app_private.sync_authorized(p_actor,p_restaurant,p_branch) or p_device is null or length(p_device) not between 1 and 128 then return false; end if;
 insert into app.sync_devices(restaurant_id,branch_id,device_id,actor_id) values(p_restaurant,p_branch,p_device,p_actor) on conflict do nothing;
 return exists(select 1 from app.sync_devices where restaurant_id=p_restaurant and branch_id=p_branch and device_id=p_device and actor_id=p_actor and revoked_at is null);
end $f$;

$ git grep -n "re-registered to another actor\|cannot come back over HTTP" harness/o0-sync-devices -- apps/api/src/sync/sync-conflicts.local.test.ts
...:570:    assert.equal((await registerSyncDevice(transport, "cashier", scopeA1, httpDevice1)).status, 403, "a device cannot be re-registered to another actor");
...:572:    assert.equal((await registerSyncDevice(transport, "manager", scopeA1, revokeDevice)).status, 403, "a revoked device cannot come back over HTTP");
```