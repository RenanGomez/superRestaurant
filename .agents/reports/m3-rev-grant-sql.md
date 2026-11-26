## Estado
VEREDICTO: APROBAR — 0 P1; 1 P2 y 3 P3 a deuda.
## Qué hice
- Cierre real: `01200:86-88` revoca de public/anon/authenticated/service_role/app_api; único grant previo `00200:317`, sin re-grant posterior.
- Wrapper `01200:26-51`: solo adjustment|waste|count_adjustment, source inventory_manual, compensates null, definer+search_path=''; compras/consumo siguen owner postgres (`00800:374`, `00400:630`).
- Pruebas: `api_invariants:276-306` (alta+saldo+replay+receipt+huérfano owner), `ledger:63-67`, `verificador:23`; reset/set role limpio (admin=postgres, `local-postgres.ts:188`).
## Archivos tocados: ninguno (solo lectura).
## Verificación
```
$ git -C "…\superRestaurant" show harness/m3-schema-grant-close:supabase/migrations/20261126001200_inventory_manual_movement_api.sql | Select-String -Pattern 'revoke all on function app_private.inventory_record_movement' -Context 0,2
  ) from public, anon, authenticated, service_role, app_api;
```
## Riesgos / dudas
- P2 `apps/api/src/inventory/movements.service.ts:150-166` ya no envía `compensatesMovementId` (wrapper `01200:50` lo anula) y `shared-types/inventory.ts:242-246` lo sigue aceptando: se ignora en silencio; P3: falta llamada denegada 42501 (`api_invariants:47-54`), asserts no NULL-safe (`:280-289`), `debt.md:139,150` abierto.
## Notas propuestas: actualizar `debt.md:139,150` y probar la denegación como app_api.