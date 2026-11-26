# Identidad de dispositivo en inventario

## Decisión

1. El `deviceId` de la UI de compras/inventario persiste por **perfil de navegador**
   (`localStorage`, clave `super-restaurant.inventory.deviceId`), no por pestaña ni por sesión.
   Antes vivía en `sessionStorage` y rotaba en cada pestaña.
2. El servidor **no autoriza** por `deviceId`: el actor sale de la sesión y de las reglas RBAC.
   El identificador se guarda como traza de auditoría y no puede ampliar permisos ni alcance de
   sucursal.
3. `ensureInventoryDeviceId` solo acepta un UUID canónico; un valor corrupto se reemplaza y un
   almacenamiento bloqueado no rompe el montaje (devuelve el id generado para ese montaje).

## Cómo viaja el identificador

- **Recepción de compras:** va en el **cuerpo** del comando (`purchasing-panel.tsx` → `actions.ts`)
  y se persiste como `received_device_id` y `device_id` en el ledger.
- **Movimientos de inventario:** va en la cabecera `x-device-id` (`movements.controller.ts`), validada
  como UUID.
- Ninguno de los dos caminos lo usa para autorizar.

## Qué existe ya para validarlo

`app_private.sync_device_state(restaurant_id, branch_id, device_id, actor_id)` ya responde si un
dispositivo está `active`, `revoked` o `unknown` para un actor, y tiene
`grant execute … to app_api` (`20261123000400_sync_api_boundary.sql`). **No hace falta una migración
nueva**: falta cablearla en las escrituras de inventario y que el equipo esté registrado (hoy
devolvería `unknown`). Eso es `o0-device-registry` (nivel B).

## Qué NO garantiza

No prueba que el equipo sea legítimo ni impide reutilizar un id copiado mientras no se cablee esa
validación; no sustituye autenticación, RBAC ni aislamiento por restaurante/sucursal. Tampoco hay hoy
prueba de rechazo de dispositivo ajeno porque esa validación todavía no se ejecuta.
