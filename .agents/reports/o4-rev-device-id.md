VEREDICTO: CAMBIOS

P2 docs/agentic/device-identity-decision.md:16-23 — Afirma que `app_api` no expone lectura de «este deviceId pertenece a este actor/sucursal» y que validarlo exige «una migración nueva (nivel A)». Falso: `app_private.sync_device_state(restaurant,branch,device,actor)` ya resuelve eso (devuelve active/revoked/unknown) y está `grant execute ... to app_api` (aunque hoy daría `unknown` hasta registrar el equipo). Falta registro/wiring, no una migración A.

P3 docs/agentic/device-identity-decision.md:9 — Atribuye la traza al header `x-device-id`; la recepción de compras envía `deviceId` en el body (`purchasing-panel.tsx:858` → `actions.ts:423`), guardado como `received_device_id`/ledger `device_id`. El header solo lo lee `movements.controller.ts:85`.

P3 apps/web/src/lib/inventory-ui.test.ts:360-415 — Las 5 pruebas no reproducen el bug (sessionStorage por pestaña): el helper es agnóstico del storage, así que volver el panel a `sessionStorage` no rompe tests; `memoryDeviceStore` ignora la clave (346,350). Falta test del wiring.

OK — `ensureInventoryDeviceId` no puede devolver `""` (valida el generador; además `actions.ts:1161` y API/DB validan UUID), sobrevive store bloqueado, y el diff no altera el gating `viewer`/`auditor` (`receiveReady` intacto). Diff = 4 archivos, 156+/15-.

```
$ Select-String -Path "supabase/migrations/20261123000400_sync_api_boundary.sql" -Pattern "sync_device_state"
supabase/migrations/20261123000400_sync_api_boundary.sql:22: grant execute on function app_private.sync_device_state(uuid,uuid,text,uuid), app_private.sync_write_allowed(uuid,uuid,uuid,text,text) to app_api;
```

NO VERIFICADO: typecheck/lint/test de web (el brief reporta 27/27 del orquestador; no los re-ejecuté).
NO VERIFICADO: navegador real desktop/390×844; PostgreSQL/Playwright no ejecutados (prohibido por el brief).