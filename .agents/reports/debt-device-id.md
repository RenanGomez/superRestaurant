Estado: DONE a nivel helper/UI (typecheck, lint y test en 0); REVIEW para el orquestador.
Archivos: `apps/web/src/lib/inventory-ui.ts`, `apps/web/src/lib/inventory-ui.test.ts`, `apps/web/src/app/app/inventario/purchasing-panel.tsx`, `docs/agentic/device-identity-decision.md`.
Decisión: id estable por perfil de navegador (`localStorage`, clave `super-restaurant.inventory.deviceId`); `x-device-id` es auditoría y la autorización sigue en la sesión/RBAC; validar contra `app.sync_devices` exige función `app_private` de solo lectura + migración (nivel A).
Helper: `ensureInventoryDeviceId(store, create)` reutiliza un UUID canónico guardado, reemplaza uno corrupto, sobrevive a storage bloqueado (devuelve el generado del montaje) y rechaza un generador sin UUID; 5 pruebas nuevas.
Verificación (comando exacto y salida real):
```
> pnpm --filter @super-restaurant/web run typecheck -> $ tsc --noEmit --project tsconfig.json (EXIT=0, sin errores)
> pnpm --filter @super-restaurant/web run lint      -> $ eslint --max-warnings=0 --config ../../eslint.config.mjs src (EXIT=0)
> pnpm --filter @super-restaurant/web run test      -> # tests 27  # pass 27  # fail 0  # duration_ms 47.6437
ok 23 - inventory device id reuses a stored canonical uuid
ok 25 - inventory device id survives a blocked store
```
Pendiente orquestador: revisión cruzada, smoke §19.5 y commit.
NO VERIFICADO: navegador real (Playwright prohibido por el brief) y validación contra PostgreSQL.