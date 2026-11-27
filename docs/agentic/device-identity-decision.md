# Identidad de dispositivo en inventario

## Decisión (actualizada 2026-11-26, `o0-device-registry`)

1. El perfil de navegador conserva **una** identidad estable (`localStorage`, clave
   `super-restaurant.inventory.deviceId`). `ensureInventoryDeviceId` solo acepta un UUID canónico,
   reemplaza un valor corrupto y no rompe el montaje con un almacenamiento bloqueado.
2. El id que **viaja al API se deriva por actor**: `deviceIdForActor(perfil, actorId)` con el mismo
   hash que usa el puente de sync (`syncDeviceIdForActor`). Así una tablet compartida tiene una fila
   por cajero en `app.sync_devices` en vez de una fila del primer actor que la registró.
3. El panel **registra el equipo antes de escribir** (`POST /api/sync/devices` con
   `{deviceId, scope}`) y no habilita movimientos ni recepción hasta que el servidor lo confirma.
4. El servidor **valida** el `deviceId` contra `app_private.sync_device_state` en movimientos y
   recepción de compras: un dispositivo `unknown` o `revoked` se rechaza con
   `403 INVENTORY_DEVICE_REJECTED` y sin efectos. Sigue sin ser una autorización: el actor sale de la
   sesión y RBAC decide; es defensa en profundidad sobre la traza de auditoría.

## Cómo viaja el identificador

- **Recepción de compras:** en el **cuerpo** del comando (`purchasing-panel.tsx` → `actions.ts`) y se
  persiste como `received_device_id` y `device_id` en el ledger.
- **Movimientos de inventario:** en la cabecera `x-device-id` (`movements.controller.ts`); el panel lo
  envía y `actions.ts` lo coloca en la cabecera tras validarlo como UUID.
- Ausente: la traza sigue siendo opcional en el contrato (clientes antiguos). Un id **presente pero
  ajeno** nunca se acepta.

## Qué NO garantiza

No prueba que el equipo sea legítimo ni impide copiar un id mientras el actor siga autenticado; no
sustituye autenticación, RBAC ni aislamiento por restaurante/sucursal. La historia ya registrada con
ids de perfil (antes de este cambio) se conserva como traza histórica: no se reescribe.

## Riesgo operativo

Si la sesión cambia de actor, el id derivado cambia y la UI registra de nuevo el equipo; el anterior
queda inactivo por uso, no revocado. Una revocación real del dispositivo (`revoked_at`) hace que el
servidor rechace las escrituras hasta que un supervisor lo re-registre o desbloquee.
