# Brief debt-device-id

NO escribas archivos fuera del repo ni en `$env:TEMP`: usa `.harness/state/tmp/` y bórralo. NO ejecutes PostgreSQL, psql ni Playwright. NO commitees, NO hagas push, NO instales dependencias.

## Objetivo
Dejar una identidad de dispositivo **estable por equipo** en la UI de compras/inventario y documentar la decisión de validación frente al registro de dispositivos; `x-device-id` queda como dato de auditoría, nunca como autorización.

Tiempo estimado: 20 min

## Alcance (únicos archivos que puedes editar)
- `apps/web/src/app/app/inventario/purchasing-panel.tsx` (hoy `useDeviceId` usa `window.sessionStorage` y rota en cada pestaña/sesión)
- `apps/web/src/lib/inventory-ui.ts` y `apps/web/src/lib/inventory-ui.test.ts` (helper puro nuevo, estilo `captureDeviceId`)
- `docs/agentic/device-identity-decision.md` (nuevo, decisión corta)

Prohibido: migraciones/SQL, `apps/api/**`, `apps/web/package.json`, `packages/**`, otros paneles.

## Contexto mínimo
- `apps/web/src/lib/capture-workspace.ts:123` ya resuelve esto para captura: `captureDeviceId(store, create)` valida UUID canónico, guarda si puede y lanza `CAPTURE_DEVICE_ID_REJECTED` si el generador no produce UUID. Reutiliza el **patrón**, no importes el módulo de captura.
- `apps/web/package.json` ya ejecuta `inventory-ui.test.js`; no hace falta tocar scripts.
- El servidor: `apps/api/src/inventory/movements.controller.ts` toma `x-device-id` del header y `movements.service` lo persiste como `device_id`; el actor siempre sale de la sesión. `purchasing-panel.tsx` manda `deviceId` en el cuerpo de la recepción.
- El registro real es `app.sync_devices` con `app_private.sync_register_device/sync_authorized`, y `app_api` **no** tiene hoy ninguna función de lectura que diga «este deviceId pertenece a este actor/sucursal». Validarlo exige una migración nueva (nivel A, fuera de esta tarea).
- Decisión a documentar: (1) la identidad del dispositivo persiste por perfil de navegador (`localStorage`), no por sesión; (2) el servidor autoriza por actor/RBAC y trata `deviceId` como traza de auditoría; (3) la validación contra `app.sync_devices` queda pendiente con su condición de entrada (función `app_private` de sólo lectura + migración + prueba de rechazo de dispositivo ajeno). Nada de promesas de seguridad que no se cumplan.

## Hecho cuando
- El helper puro decide la identidad con almacenamiento inyectable y se prueba con salida real: valor guardado válido se reutiliza; valor corrupto/no-UUID se reemplaza; almacenamiento bloqueado no rompe el montaje (devuelve el generado para este montaje); dos llamadas devuelven el mismo id.
- `purchasing-panel.tsx` usa `localStorage` (con `try/catch` para modo privado), mantiene la misma clave `super-restaurant.inventory.deviceId`, y no genera un id nuevo en cada montaje si ya existe.
- `docs/agentic/device-identity-decision.md` (≤25 líneas): decisión, por qué, qué falta para validar contra el registro y qué NO garantiza.
- `pnpm --filter @super-restaurant/web run typecheck`, `lint` y `test` en 0 (los puedes correr).

## Pruebas (ahorro de cuota)
- Un ciclo al terminar; máximo 3 probar→corregir. Filtra salida (`Select-Object -Last 30`).

## Reporte
`.agents/reports/debt-device-id.md`: archivos, decisión, comandos y salida real (bloque ```), y qué queda al orquestador. Aplica Ponytail.
