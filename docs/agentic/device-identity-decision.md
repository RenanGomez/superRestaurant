# Identidad de dispositivo en inventario

## Decisión

1. El `deviceId` de la UI de compras/inventario persiste por **perfil de navegador**
   (`localStorage`, clave `super-restaurant.inventory.deviceId`), no por pestaña ni sesión.
   Antes vivía en `sessionStorage` y rotaba en cada pestaña.
2. El servidor **no autoriza** por `deviceId`: el actor sale de la sesión y las reglas de
   RBAC. `x-device-id` se guarda como traza de auditoría (`device_id`) y no puede ampliar
   permisos ni alcance de sucursal.
3. `ensureInventoryDeviceId` solo acepta un UUID canónico; un valor corrupto se reemplaza y
   un almacenamiento bloqueado no rompe el montaje (devuelve el id generado para ese montaje).

## Por qué

`app.sync_devices` con `app_private.sync_register_device/sync_authorized` existe, pero
`app_api` no expone ninguna lectura que responda «este `deviceId` pertenece a este
actor/sucursal». Validarlo requiere una migración nueva (nivel A), fuera de este cambio.

## Qué falta para validar contra el registro

Función `app_private` de solo lectura que resuelva el dispositivo por actor/sucursal, una
migración nueva que la exponga a `app_api`, y una prueba de rechazo de dispositivo ajeno.
Hasta entonces el `deviceId` es dato de auditoría, no credencial.

## Qué NO garantiza

No prueba que el equipo sea legítimo ni impide reutilizar un id copiado; no sustituye
autenticación, RBAC ni aislamiento por restaurante/sucursal.
