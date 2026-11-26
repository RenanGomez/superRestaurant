**Tarea:** m3-api-wire — rutas de inventario expuestas. Estado: REVIEW (puertas verdes).

**Archivos:** `apps/api/src/app.module.ts` (registra `ItemsController` + `ItemsService`), `apps/api/src/app.smoke.test.ts` (asserts 401 en ambas rutas).

**Decisión:** No importé `ItemsModule`: su `ItemsService` no puede resolver `MembershipAuthorizationService`, `MEMBERSHIP_DIRECTORY` ni `DATABASE_CLIENT` porque `items.module.ts` no importa nada y ese archivo está fuera de alcance (el intento con `imports: [ItemsModule]` rompió `delivery-zones.test.js` con `UnknownDependenciesException`). Registrarlo en `AppModule` sigue el patrón real del repo (no existen otros imports) y monta las rutas sin tocar `items.module.ts`.

**Verificación real:**
```powershell
& $PNPM --filter @super-restaurant/api test   # EXIT=0
✔ HTTP contract: 401, 400 INVENTORY_REQUEST_INVALID, 201 no-store, 403 ACTION_NOT_AUTHORIZED
✔ Nest wiring keeps health public and all other routes authenticated by default
```
`typecheck` (`tsc --noEmit`) y `lint` (`eslint --max-warnings=0`) terminaron sin salida (verdes).

**Rutas comprobadas:** `GET /api/v1/inventory/items` y `GET /api/v1/inventory/warehouses` sin token → 401 `AUTHENTICATION_REQUIRED` (no 404).

**Riesgos:** `items.module.ts` queda sin usar; cablearlo directo evita el fallo de DI. No se ejecutó SQL/PostgreSQL ni commit.

**Git:** `M apps/api/src/app.module.ts`; `M apps/api/src/app.smoke.test.ts`. Siguiente: revisión cruzada e integración.